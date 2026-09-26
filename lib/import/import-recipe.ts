import "server-only";
import { splitIngredientLine } from "@/lib/ingredients";
import { parseAmount } from "@/lib/units";
import { extractJsonLdRecipe, parseServings, summarizePage, type ExtractedRecipe } from "./extract";
import { RecipeAiError, structureRecipeWithAi } from "./openai";
import { decodeHtml, safeFetch, SafeFetchError } from "./safe-fetch";
import { checkImportUrl } from "./url-safety";

/**
 * URL取り込みの流れ（Gate 3）：
 *   URL検証 → 制限付き取得 → JSON-LD抽出（AIなし） → 無ければAI構造化 → 下書き（確認画面へ）
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
  | { ok: true; method: "JSON_LD" | "AI"; draft: ImportDraft; host: string }
  | { ok: false; method: "JSON_LD" | "AI" | "NONE"; reason: string; title: string | null; sourceUrl: string; host: string | null };

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

export async function importRecipeFromUrl(
  input: string,
  options: { aiAllowed: boolean; apiKey: string | null; model?: string },
): Promise<ImportResult> {
  const checked = checkImportUrl(input);
  if (!checked.ok) return { ok: false, method: "NONE", reason: checked.reason, title: null, sourceUrl: input, host: null };
  const sourceUrl = checked.url.toString();
  const host = checked.url.hostname;

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
  if (summary.text.length + (summary.description?.length ?? 0) < MIN_TEXT_FOR_AI) {
    return {
      ok: false,
      method: "NONE",
      reason: "ページから本文を読み取れませんでした（ログインが必要なページの可能性があります）。",
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
