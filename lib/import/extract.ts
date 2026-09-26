/**
 * 取得したHTMLからレシピの材料を取り出す（Gate 3）。副作用のない純粋関数。
 *
 * 1. JSON-LDの schema.org/Recipe があればそれを使う（AIを呼ばない）
 * 2. 無ければ、タイトル・説明・本文テキストを最小限に切り出し、AI構造化（openai.ts）の入力にする
 */

export type ExtractedRecipe = {
  name: string | null;
  ingredients: string[];
  instructions: string[];
  servingsText: string | null;
  totalMinutes: number | null;
  imageUrl: string | null;
  energyKcal: number | null;
};

export type PageSummary = {
  title: string | null;
  description: string | null;
  imageUrl: string | null;
  /** AIへ渡す本文（script・style・navなどを除いたテキスト。上限あり） */
  text: string;
};

const ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " " };

export function decodeEntities(value: string): string {
  return value.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (match, code: string) => {
    if (code[0] === "#") {
      const n = code[1].toLowerCase() === "x" ? parseInt(code.slice(2), 16) : parseInt(code.slice(1), 10);
      return Number.isFinite(n) && n > 0 && n < 0x110000 ? String.fromCodePoint(n) : "";
    }
    return ENTITIES[code.toLowerCase()] ?? match;
  });
}

function cleanText(value: unknown, max = 500): string | null {
  if (typeof value !== "string") return null;
  const text = decodeEntities(value.replace(/<[^>]*>/g, " "))
    .replace(/\s+/g, " ")
    .trim();
  return text ? text.slice(0, max) : null;
}

/** ISO 8601の期間（PT1H20M）を分へ */
export function parseDurationMinutes(value: unknown): number | null {
  if (typeof value !== "string") return null;
  const match = /^P(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:\d+S)?)?$/i.exec(value.trim());
  if (!match) return null;
  const minutes = Number(match[1] ?? 0) * 1440 + Number(match[2] ?? 0) * 60 + Number(match[3] ?? 0);
  return minutes > 0 && minutes <= 600 ? minutes : null;
}

function typeIncludes(node: Record<string, unknown>, type: string): boolean {
  const value = node["@type"];
  return Array.isArray(value) ? value.includes(type) : value === type;
}

function collectNodes(value: unknown, into: Record<string, unknown>[] = []): Record<string, unknown>[] {
  if (Array.isArray(value)) {
    for (const item of value) collectNodes(item, into);
  } else if (value && typeof value === "object") {
    const node = value as Record<string, unknown>;
    into.push(node);
    if (node["@graph"]) collectNodes(node["@graph"], into);
  }
  return into;
}

function imageFrom(value: unknown): string | null {
  if (typeof value === "string") return value;
  if (Array.isArray(value)) return imageFrom(value[0]);
  if (value && typeof value === "object") return imageFrom((value as Record<string, unknown>).url);
  return null;
}

function instructionsFrom(value: unknown): string[] {
  if (typeof value === "string") {
    return value
      .split(/\r?\n|(?<=。)/)
      .map((s) => cleanText(s))
      .filter((s): s is string => Boolean(s));
  }
  if (Array.isArray(value)) return value.flatMap(instructionsFrom);
  if (value && typeof value === "object") {
    const node = value as Record<string, unknown>;
    if (node.itemListElement) return instructionsFrom(node.itemListElement);
    const text = cleanText(node.text ?? node.name);
    return text ? [text] : [];
  }
  return [];
}

function servingsFrom(value: unknown): string | null {
  if (typeof value === "number") return String(value);
  if (Array.isArray(value)) return servingsFrom(value.find((v) => typeof v === "string" && /\d/.test(v)) ?? value[0]);
  return cleanText(value, 40);
}

function kcalFrom(value: unknown): number | null {
  if (!value || typeof value !== "object") return null;
  const calories = (value as Record<string, unknown>).calories;
  const match = typeof calories === "string" ? /([\d.]+)/.exec(calories) : null;
  const n = match ? Number(match[1]) : typeof calories === "number" ? calories : NaN;
  return Number.isFinite(n) && n > 0 && n < 5000 ? Math.round(n) : null;
}

/** JSON-LDのRecipeを探す。材料・手順のどちらも無いものは使わない */
export function extractJsonLdRecipe(html: string): ExtractedRecipe | null {
  const scripts = html.matchAll(/<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi);
  for (const [, body] of scripts) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(body.trim());
    } catch {
      continue;
    }
    const recipe = collectNodes(parsed).find((node) => typeIncludes(node, "Recipe"));
    if (!recipe) continue;
    const ingredients = (Array.isArray(recipe.recipeIngredient) ? recipe.recipeIngredient : [])
      .map((item) => cleanText(item, 120))
      .filter((s): s is string => Boolean(s))
      .slice(0, 60);
    const instructions = instructionsFrom(recipe.recipeInstructions).slice(0, 50);
    if (ingredients.length === 0 && instructions.length === 0) continue;
    return {
      name: cleanText(recipe.name, 80),
      ingredients,
      instructions,
      servingsText: servingsFrom(recipe.recipeYield),
      totalMinutes: parseDurationMinutes(recipe.totalTime) ?? parseDurationMinutes(recipe.cookTime),
      imageUrl: imageFrom(recipe.image),
      energyKcal: kcalFrom(recipe.nutrition),
    };
  }
  return null;
}

function metaContent(html: string, key: string): string | null {
  const pattern = new RegExp(
    `<meta[^>]+(?:property|name)=["']${key}["'][^>]*content=["']([^"']*)["']|<meta[^>]+content=["']([^"']*)["'][^>]*(?:property|name)=["']${key}["']`,
    "i",
  );
  const match = pattern.exec(html);
  return cleanText(match?.[1] ?? match?.[2] ?? null, 2000);
}

const MAX_TEXT = 8000;

/** AIへ渡す最小限の本文。script・style・ヘッダー・フッター・ナビゲーションを除き、上限で切る */
export function summarizePage(html: string): PageSummary {
  const title = metaContent(html, "og:title") ?? cleanText(/<title[^>]*>([\s\S]*?)<\/title>/i.exec(html)?.[1] ?? null, 200);
  const description = metaContent(html, "og:description") ?? metaContent(html, "description");
  const imageUrl = metaContent(html, "og:image");

  const main = /<(main|article)[\s>][\s\S]*?<\/\1>/i.exec(html)?.[0] ?? html;
  const text = decodeEntities(
    main
      .replace(/<(script|style|noscript|svg|nav|header|footer|form|iframe|template)[\s\S]*?<\/\1>/gi, " ")
      .replace(/<!--[\s\S]*?-->/g, " ")
      .replace(/<(br|\/p|\/li|\/h[1-6]|\/div|\/tr)[^>]*>/gi, "\n")
      .replace(/<[^>]+>/g, " "),
  )
    .split("\n")
    .map((line) => line.replace(/\s+/g, " ").trim())
    .filter(Boolean)
    .join("\n")
    .slice(0, MAX_TEXT);

  return { title, description, imageUrl, text };
}

/** 「2人分」「4 servings」などから人数（1〜8）を取り出す */
export function parseServings(text: string | null): number | null {
  if (!text) return null;
  const match = /(\d+)/.exec(text.normalize("NFKC"));
  const n = match ? Number(match[1]) : NaN;
  return Number.isInteger(n) && n >= 1 && n <= 8 ? n : null;
}
