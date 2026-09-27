import "server-only";
import { z } from "zod";
import type { ExtractedRecipe, PageSummary } from "./extract";

/**
 * OpenAIでページ本文からレシピを構造化する（Gate 3、JSON-LDが無い場合だけ）。
 *
 * AGENTS.md の約束:
 *   - 送るのは公開ページのレシピ部分の必要最小限（タイトル・説明・本文の先頭8000文字）。利用者の情報は送らない
 *   - 1回だけ呼び、失敗しても上位モデルへ自動で再試行しない
 *   - 出力はJSON Schemaで制約し、さらにzodで検証する。そのままDBへ保存せず、確認画面へ出す
 */

export const DEFAULT_IMPORT_MODEL = "gpt-5-mini";
const ENDPOINT = "https://api.openai.com/v1/responses";
const TIMEOUT_MS = 30_000;

export class RecipeAiError extends Error {
  constructor(
    message: string,
    readonly kind: "not_configured" | "timeout" | "api" | "invalid_output" | "not_a_recipe",
  ) {
    super(message);
  }
}

const outputSchema = z.object({
  is_recipe: z.boolean(),
  name: z.string().max(80).nullable(),
  servings_text: z.string().max(40).nullable(),
  total_minutes: z.number().int().min(1).max(600).nullable(),
  ingredients: z.array(z.string().max(120)).max(60),
  instructions: z.array(z.string().max(500)).max(50),
});

/** OpenAI Structured Outputs（strict）用のJSON Schema。outputSchemaと同じ形 */
const JSON_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["is_recipe", "name", "servings_text", "total_minutes", "ingredients", "instructions"],
  properties: {
    is_recipe: { type: "boolean", description: "本文に料理の材料と作り方が書かれているか" },
    name: { type: ["string", "null"], description: "料理名" },
    servings_text: { type: ["string", "null"], description: "何人分か（本文の表記のまま。例：2人分）" },
    total_minutes: { type: ["integer", "null"], description: "調理時間（分）。本文に無ければnull" },
    ingredients: {
      type: "array",
      items: { type: "string" },
      description: "材料を1つずつ「材料名 分量」の形で（例：鶏もも肉 300g、醤油 大さじ2、塩 少々）。本文に無い材料を足さない",
    },
    instructions: {
      type: "array",
      items: { type: "string" },
      description: "作り方を1手順ずつ。番号は付けない。本文に無い手順を足さない",
    },
  },
} as const;

const SYSTEM_PROMPT = [
  "あなたは料理レシピのページ本文から、材料と作り方を正確に書き写すアシスタントです。",
  "本文に書かれていることだけを使い、推測で材料・分量・手順・時間を補わないでください。分からない項目はnullまたは空配列にします。",
  "広告・関連記事・コメント・SNSの定型文は無視します。料理のレシピでなければ is_recipe を false にします。",
].join("\n");

type ResponsesApiOutput = {
  status?: string;
  output?: { type: string; content?: { type: string; text?: string }[] }[];
  error?: { message?: string } | null;
};

function outputText(body: ResponsesApiOutput): string | null {
  for (const item of body.output ?? []) {
    if (item.type !== "message") continue;
    for (const content of item.content ?? []) {
      if (content.type === "output_text" && content.text) return content.text;
      if (content.type === "refusal") return null;
    }
  }
  return null;
}

export async function structureRecipeWithAi(
  page: PageSummary,
  options: { apiKey: string; model?: string; fetchImpl?: typeof fetch },
): Promise<ExtractedRecipe> {
  if (!options.apiKey) throw new RecipeAiError("OpenAIの設定がありません。", "not_configured");
  const userContent = [
    page.title ? `タイトル: ${page.title}` : "",
    page.description ? `説明: ${page.description}` : "",
    "本文:",
    page.text,
  ]
    .filter(Boolean)
    .join("\n");

  let response: Response;
  try {
    response = await (options.fetchImpl ?? fetch)(ENDPOINT, {
      method: "POST",
      headers: { Authorization: `Bearer ${options.apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: options.model || DEFAULT_IMPORT_MODEL,
        input: [
          { role: "system", content: SYSTEM_PROMPT },
          { role: "user", content: userContent },
        ],
        text: { format: { type: "json_schema", name: "recipe", strict: true, schema: JSON_SCHEMA } },
        max_output_tokens: 4000,
        // 学習・保存に使わせない（OpenAI側での応答保存を無効化）
        store: false,
      }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch (error) {
    if (error instanceof Error && error.name === "TimeoutError") {
      throw new RecipeAiError("AIの応答が遅すぎます。", "timeout");
    }
    throw new RecipeAiError("AIに接続できませんでした。", "api");
  }

  if (!response.ok) {
    // 応答本文（入力の一部を含み得る）はログにもエラーにも入れない
    throw new RecipeAiError(`AIの呼び出しに失敗しました（HTTP ${response.status}）。`, "api");
  }
  const body = (await response.json().catch(() => ({}))) as ResponsesApiOutput;
  const text = outputText(body);
  if (!text) throw new RecipeAiError("AIの出力を読み取れませんでした。", "invalid_output");

  let parsed: z.infer<typeof outputSchema>;
  try {
    parsed = outputSchema.parse(JSON.parse(text));
  } catch {
    throw new RecipeAiError("AIの出力が想定した形ではありませんでした。", "invalid_output");
  }
  if (!parsed.is_recipe || (parsed.ingredients.length === 0 && parsed.instructions.length === 0)) {
    throw new RecipeAiError("ページからレシピを見つけられませんでした。", "not_a_recipe");
  }
  return {
    name: parsed.name?.trim() || null,
    ingredients: parsed.ingredients.map((s) => s.trim()).filter(Boolean),
    instructions: parsed.instructions.map((s) => s.trim()).filter(Boolean),
    servingsText: parsed.servings_text,
    totalMinutes: parsed.total_minutes,
    imageUrl: null,
    energyKcal: null,
  };
}
