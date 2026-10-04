import "server-only";
import { splitIngredientLine } from "@/lib/ingredients";
import { parseAmount } from "@/lib/units";
import { extractJsonLdRecipe, parseServings, summarizePage, type ExtractedRecipe } from "./extract";
import { extractInstagramCaption, instagramEmbedUrl } from "./instagram";
import { RecipeAiError, structureRecipeWithAi } from "./openai";
import { hasIngredientHeading, parseRecipeText } from "./recipe-text";
import { decodeHtml, safeFetch, SafeFetchError } from "./safe-fetch";
import { checkImportUrl } from "./url-safety";

/**
 * URL取り込みの流れ（Gate 3）：
 *   URL検証 → 制限付き取得 → JSON-LD抽出（AIなし） → 無ければAI構造化 → 下書き（確認画面へ）
 *   Instagramの投稿は、埋め込み用ページから投稿の文章を取り、文章の「材料」「作り方」を読む（AIなし → 読めなければAI）
 *   貼り付けた文章（importRecipeFromText）も同じ読み方をする
 * どの段階で失敗しても「URLだけ保存」「手入力で続ける」を選べるよう、理由とページタイトルを返す。
 */

export type ImportDraft = {
  name: string;
  servings: number;
  cookingMinutes: number | null;
  sourceUrl: string;
  ingredients: { rawName: string; quantity: number | null; unit: string | null; note: null; isMain: false }[];
  instructions: string[];
  energyKcal: number | null;
  imageUrl: string | null;
};

export type ImportResult =
  | { ok: true; method: "JSON_LD" | "AI" | "TEXT"; draft: ImportDraft; host: string }
  | { ok: false; method: "JSON_LD" | "AI" | "NONE"; reason: string; title: string | null; sourceUrl: string; host: string | null };

export const NO_RECIPE_IN_TEXT =
  "この投稿の文章にはレシピ（「材料」の見出し）が書かれていません。動画や画像の中だけにあるレシピは読み取れません。レシピの文章が別にある場合は「文章を貼り付けて取り込む」を使ってください。";

/**
 * 上限（DB関数 begin_recipe_import で判定。supabase/migrations/20260930090000_create_recipe_import_logs.sql）
 *   AI：1 spaceあたり日本時間の1日20回 / 取り込み：1 spaceあたり直近1時間30回
 */

const PAGE_LIMIT = { maxBytes: 3 * 1024 * 1024, timeoutMs: 10_000 };
const MIN_TEXT_FOR_AI = 40;

function absoluteUrl(value: string | null, base: string): string | null {
  if (!value) return null;
  try {
    const url = new URL(value, base);
    return url.protocol === "https:" || url.protocol === "http:" ? url.toString() : null;
  } catch {
    return null;
  }
}

export function toDraft(extracted: ExtractedRecipe, sourceUrl: string, fallbackName: string | null): ImportDraft {
  return {
    name: (extracted.name || fallbackName || new URL(sourceUrl).hostname).slice(0, 80),
    servings: parseServings(extracted.servingsText) ?? 2,
    cookingMinutes: extracted.totalMinutes,
    sourceUrl,
    ingredients: extracted.ingredients
      .map(splitIngredientLine)
      .filter((line): line is { rawName: string; amount: string } => line !== null)
      .map((line) => {
        const amount = parseAmount(line.amount);
        return {
          rawName: line.rawName,
          quantity: amount.quantity !== null && amount.quantity > 0 && amount.quantity < 99999 ? amount.quantity : null,
          unit: amount.unit ? amount.unit.slice(0, 20) : null,
          note: null,
          isMain: false as const,
        };
      })
      .slice(0, 60),
    instructions: extracted.instructions.map((s) => s.slice(0, 500)).slice(0, 50),
    energyKcal: extracted.energyKcal,
    imageUrl: absoluteUrl(extracted.imageUrl, sourceUrl),
  };
}

type TextImportOptions = { aiAllowed: boolean; apiKey: string | null; model?: string };

/**
 * 文章（投稿のキャプション・貼り付けたテキスト）からレシピを読む。
 * まずAIなしで「材料」「作り方」の見出しを読み、読めないときだけ（「材料」の語がある文章に限り）AIを使う。
 */
export async function importRecipeFromText(
  text: string,
  source: { sourceUrl: string; host: string; fallbackName: string },
  options: TextImportOptions,
): Promise<ImportResult> {
  const failed = (reason: string, method: "AI" | "NONE" = "NONE"): ImportResult => ({
    ok: false,
    method,
    reason,
    title: null,
    sourceUrl: source.sourceUrl,
    host: source.sourceUrl ? source.host : null,
  });
  const parsed = parseRecipeText(text);
  if (parsed) {
    return { ok: true, method: "TEXT", draft: toDraft(parsed, source.sourceUrl, parsed.name ?? source.fallbackName), host: source.host };
  }
  // 「材料」の語が無い文章はAIへ送らない（レシピでない文章を外部へ送らない）
  if (!hasIngredientHeading(text) && !/材料|ingredients/i.test(text)) return failed(NO_RECIPE_IN_TEXT);
  if (!options.apiKey) {
    return failed("文章の「材料」の部分を読み取れませんでした（AIでの読み取りは未設定です）。材料を1行に1つずつ書いた形にすると読み取れます。");
  }
  if (!options.aiAllowed) return failed("今日のAIでの読み取り回数の上限に達しました。明日もう一度試すか、手入力で続けてください。");
  try {
    const extracted = await structureRecipeWithAi(
      { title: null, description: null, imageUrl: null, text: text.slice(0, 6000) },
      { apiKey: options.apiKey, model: options.model },
    );
    return { ok: true, method: "AI", draft: toDraft({ ...extracted, imageUrl: null }, source.sourceUrl, extracted.name ?? source.fallbackName), host: source.host };
  } catch (error) {
    return failed(error instanceof RecipeAiError ? error.message : "AIでの読み取りに失敗しました。", "AI");
  }
}

export async function importRecipeFromUrl(
  input: string,
  options: TextImportOptions,
): Promise<ImportResult> {
  const checked = checkImportUrl(input);
  if (!checked.ok) return { ok: false, method: "NONE", reason: checked.reason, title: null, sourceUrl: input, host: null };
  const sourceUrl = checked.url.toString();
  const host = checked.url.hostname;

  // Instagramの投稿：埋め込み用ページから投稿の文章を取って読む
  const embedUrl = instagramEmbedUrl(checked.url);
  if (embedUrl) {
    let caption: string | null = null;
    try {
      const page = await safeFetch(embedUrl, { accept: ["text/html", "application/xhtml+xml"], ...PAGE_LIMIT });
      caption = extractInstagramCaption(decodeHtml(page.body, page.contentType));
    } catch {
      caption = null;
    }
    if (!caption) {
      return {
        ok: false,
        method: "NONE",
        reason: "Instagramの投稿の文章を取得できませんでした（非公開の投稿か、Instagram側で制限されています）。投稿の文章をコピーして「文章を貼り付けて取り込む」を使ってください。",
        title: null,
        sourceUrl,
        host,
      };
    }
    return importRecipeFromText(caption, { sourceUrl, host, fallbackName: "Instagramのレシピ" }, options);
  }

  let html: string;
  let finalUrl = sourceUrl;
  try {
    const page = await safeFetch(sourceUrl, { accept: ["text/html", "application/xhtml+xml"], ...PAGE_LIMIT });
    finalUrl = page.finalUrl;
    html = decodeHtml(page.body, page.contentType);
  } catch (error) {
    const reason = error instanceof SafeFetchError ? error.message : "ページを取得できませんでした。";
    return { ok: false, method: "NONE", reason, title: null, sourceUrl, host };
  }

  const summary = summarizePage(html);
  const jsonLd = extractJsonLdRecipe(html);
  if (jsonLd) {
    const draft = toDraft({ ...jsonLd, imageUrl: jsonLd.imageUrl ?? summary.imageUrl }, sourceUrl, summary.title);
    return { ok: true, method: "JSON_LD", draft: { ...draft, imageUrl: absoluteUrl(draft.imageUrl, finalUrl) }, host };
  }

  if (!options.apiKey) {
    return {
      ok: false,
      method: "NONE",
      reason: "このページには読み取れるレシピ情報がありませんでした（AIでの読み取りは未設定です）。",
      title: summary.title,
      sourceUrl,
      host,
    };
  }
  if (!options.aiAllowed) {
    return {
      ok: false,
      method: "NONE",
      reason: "今日のAIでの読み取り回数の上限に達しました。明日もう一度試すか、手入力で続けてください。",
      title: summary.title,
      sourceUrl,
      host,
    };
  }
  if (summary.text.length < MIN_TEXT_FOR_AI) {
    return {
      ok: false,
      method: "NONE",
      reason: "ページの中に材料の記載を見つけられませんでした（ログインが必要なページの可能性があります。AIには送っていません）。",
      title: summary.title,
      sourceUrl,
      host,
    };
  }

  try {
    const extracted = await structureRecipeWithAi(summary, { apiKey: options.apiKey, model: options.model });
    const draft = toDraft({ ...extracted, imageUrl: summary.imageUrl }, sourceUrl, summary.title);
    return { ok: true, method: "AI", draft: { ...draft, imageUrl: absoluteUrl(draft.imageUrl, finalUrl) }, host };
  } catch (error) {
    const reason =
      error instanceof RecipeAiError ? error.message : "AIでの読み取りに失敗しました。";
    return { ok: false, method: "AI", reason, title: summary.title, sourceUrl, host };
  }
}
