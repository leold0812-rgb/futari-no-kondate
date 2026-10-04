/**
 * 投稿の文章（Instagramのキャプション・貼り付けたテキスト）からレシピを読み取る。AIを使わない純粋関数。
 * 「材料」の見出しから「作り方」の見出しまでを材料、その後を作り方として読む。
 * 「材料」の見出しが無い文章は読み取らない（null）。推測で材料を作らない。
 */
import type { ExtractedRecipe } from "./extract";

const DECORATION = /^[\s【\[［《〈<＜■□◆◇●○◎▼▽▶︎▷☆★✔︎✅🔸🔹▪️・*＊#-]+/u;
const INGREDIENT_HEADING = /^(材料|ざいりょう|ingredients?)/i;
const STEP_HEADING = /^(作り方|つくり方|作りかた|つくりかた|手順|調理手順|レシピ|how\s*to|directions?|instructions?|method)/i;
const END_OF_RECIPE = /^(ポイント|コツ|メモ|memo|point|保存方法|栄養|カロリー|----|ーーー|＿＿＿|___)/i;

/** 手順の番号（「1.」「2)」「①」。NFKCで①は「1 」になるため、数字＋空白も番号として扱う） */
const STEP_NUMBER = /^(\d{1,2}[.．)）、:：]\s*|\d{1,2}\s+(?=\D)|[①-⑳]\s*)/;

function clean(line: string): string {
  return line.normalize("NFKC").replace(/​/g, "").trim();
}

function withoutDecoration(line: string): string {
  return line.replace(DECORATION, "").trim();
}

/** ハッシュタグ・メンションだけの行、URLの行 */
function isNoise(line: string): boolean {
  return /^([#＃@＠]\S+\s*)+$/.test(line) || /^https?:\/\//.test(line);
}

export function hasIngredientHeading(text: string): boolean {
  return text.split(/\r?\n/).some((line) => INGREDIENT_HEADING.test(withoutDecoration(clean(line))));
}

export function parseRecipeText(text: string): ExtractedRecipe | null {
  const lines = text.split(/\r?\n/).map(clean);
  const start = lines.findIndex((line) => INGREDIENT_HEADING.test(withoutDecoration(line)));
  if (start < 0) return null;

  // 料理名：見出しより前の、短くて飾りを除いた最初の行（ハッシュタグ・アカウント名だけの行は除く）
  const name =
    lines
      .slice(0, start)
      .filter((line) => line && !isNoise(line))
      .map((line) => withoutDecoration(line).replace(/[】\]］》〉>＞]+$/u, "").trim())
      .find((line) => line.length >= 2 && line.length <= 40) ?? null;

  const heading = withoutDecoration(lines[start]);
  const servingsText = /(\d+\s*(?:〜|~|-)?\s*\d*\s*(?:人分|人前|人|皿分|個分|枚分))/.exec(heading)?.[1] ?? null;

  const ingredients: string[] = [];
  const instructions: string[] = [];
  let section: "ingredients" | "instructions" = "ingredients";
  // 見出しと同じ行に続く材料（「材料：鶏肉 200g」）は扱わず、次の行から読む
  for (const raw of lines.slice(start + 1)) {
    if (!raw) continue;
    if (isNoise(raw)) {
      if (section === "instructions" && instructions.length > 0) break;
      continue;
    }
    const line = withoutDecoration(raw).replace(/[】\]］》〉>＞:：]+$/u, "").trim();
    if (!line) continue;
    if (STEP_HEADING.test(line)) {
      section = "instructions";
      continue;
    }
    if (END_OF_RECIPE.test(line) && (section === "instructions" ? instructions.length > 0 : ingredients.length > 0)) break;
    if (section === "ingredients") {
      // 見出しが無いまま手順が始まる書き方（「1. 鶏肉を切る」「①…」）
      if (ingredients.length > 0 && STEP_NUMBER.test(line) && line.length > 12) {
        section = "instructions";
      } else {
        // 小見出し（「A」「調味料」など、分量のない短い行で末尾が区切り）は材料にしない
        if (line.length <= 60 && !/^[(（]?[A-Za-z][)）]?$/.test(line)) ingredients.push(line.slice(0, 80));
        continue;
      }
    }
    instructions.push(line.replace(STEP_NUMBER, "").slice(0, 500));
  }
  if (ingredients.length === 0) return null;
  return {
    name,
    ingredients: ingredients.slice(0, 60),
    instructions: instructions.slice(0, 50),
    servingsText,
    totalMinutes: null,
    imageUrl: null,
    energyKcal: null,
  };
}
