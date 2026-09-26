import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const fetchMock = vi.fn();
vi.mock("@/lib/import/safe-fetch", async () => {
  class SafeFetchError extends Error {
    constructor(
      message: string,
      readonly kind: string,
    ) {
      super(message);
    }
  }
  return {
    SafeFetchError,
    safeFetch: (...args: unknown[]) => fetchMock(...args),
    decodeHtml: (body: Buffer) => body.toString("utf8"),
  };
});

const aiMock = vi.fn();
vi.mock("@/lib/import/openai", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/lib/import/openai")>();
  return { ...original, structureRecipeWithAi: (...args: unknown[]) => aiMock(...args) };
});

const { importRecipeFromUrl, toDraft } = await import("@/lib/import/import-recipe");
const { SafeFetchError } = await import("@/lib/import/safe-fetch");
const { RecipeAiError } = await import("@/lib/import/openai");

function page(html: string, finalUrl = "https://recipes.example.com/r/1") {
  return { finalUrl, contentType: "text/html; charset=utf-8", body: Buffer.from(html) };
}

const JSON_LD_HTML = `<html><head><meta property="og:image" content="/img/og.jpg">
<script type="application/ld+json">{"@type":"Recipe","name":"豚の生姜焼き","recipeYield":"2人分","totalTime":"PT15M",
"recipeIngredient":["豚ロース薄切り 200g","生姜 1片","醤油 大さじ1と1/2","塩 少々"],
"recipeInstructions":[{"@type":"HowToStep","text":"豚肉を焼く"},{"@type":"HowToStep","text":"タレを絡める"}]}</script></head></html>`;

const PLAIN_HTML = `<html><head><title>ブログ</title></head><body><article>今日は豚汁を作りました。材料は豚こま150g、大根1/4本。まず野菜を切って煮ます。</article></body></html>`;

beforeEach(() => {
  fetchMock.mockReset();
  aiMock.mockReset();
});

describe("URL取り込みの流れ", () => {
  it("JSON-LDがあればAIを呼ばずに下書きを作る（材料の分量を数量と単位へ分ける）", async () => {
    fetchMock.mockResolvedValue(page(JSON_LD_HTML));
    const result = await importRecipeFromUrl("https://recipes.example.com/r/1", { aiAllowed: true, apiKey: "k" });
    expect(aiMock).not.toHaveBeenCalled();
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.method).toBe("JSON_LD");
    expect(result.draft).toMatchObject({
      name: "豚の生姜焼き",
      servings: 2,
      cookingMinutes: 15,
      instructions: ["豚肉を焼く", "タレを絡める"],
      imageUrl: "https://recipes.example.com/img/og.jpg",
    });
    expect(result.draft.ingredients.map((i) => [i.rawName, i.quantity, i.unit])).toEqual([
      ["豚ロース薄切り", 200, "g"],
      ["生姜", 1, "片"],
      ["醤油", 1.5, "大さじ"],
      ["塩", null, "少々"],
    ]);
  });

  it("JSON-LDが無ければAIで構造化する（1回だけ）", async () => {
    fetchMock.mockResolvedValue(page(PLAIN_HTML));
    aiMock.mockResolvedValue({
      name: "豚汁",
      ingredients: ["豚こま 150g", "大根 1/4本"],
      instructions: ["野菜を切る", "煮る"],
      servingsText: null,
      totalMinutes: null,
      imageUrl: null,
      energyKcal: null,
    });
    const result = await importRecipeFromUrl("https://blog.example.com/p", { aiAllowed: true, apiKey: "k" });
    expect(aiMock).toHaveBeenCalledTimes(1);
    expect(result).toMatchObject({ ok: true, method: "AI" });
  });

  it("AI未設定・上限到達ではAIを呼ばず、理由とページタイトルを返す", async () => {
    fetchMock.mockResolvedValue(page(PLAIN_HTML));
    const noKey = await importRecipeFromUrl("https://blog.example.com/p", { aiAllowed: true, apiKey: null });
    expect(noKey).toMatchObject({ ok: false, method: "NONE", title: "ブログ" });
    const limited = await importRecipeFromUrl("https://blog.example.com/p", { aiAllowed: false, apiKey: "k" });
    expect(limited).toMatchObject({ ok: false, method: "NONE" });
    if (!limited.ok) expect(limited.reason).toContain("上限");
    expect(aiMock).not.toHaveBeenCalled();
  });

  it("AIがレシピでないと判断したら失敗として返す（URLだけ保存・手入力へ進める）", async () => {
    fetchMock.mockResolvedValue(page(PLAIN_HTML));
    aiMock.mockRejectedValue(new RecipeAiError("ページからレシピを見つけられませんでした。", "not_a_recipe"));
    const result = await importRecipeFromUrl("https://blog.example.com/p", { aiAllowed: true, apiKey: "k" });
    expect(result).toMatchObject({ ok: false, method: "AI", host: "blog.example.com", title: "ブログ" });
  });

  it("内部向けURLは取得せずに拒否し、取得失敗は理由を返す", async () => {
    const blocked = await importRecipeFromUrl("http://169.254.169.254/latest", { aiAllowed: true, apiKey: "k" });
    expect(blocked).toMatchObject({ ok: false, host: null });
    expect(fetchMock).not.toHaveBeenCalled();

    fetchMock.mockRejectedValue(new SafeFetchError("ページの応答が遅すぎます。", "timeout"));
    const timeout = await importRecipeFromUrl("https://slow.example.com/", { aiAllowed: true, apiKey: "k" });
    expect(timeout).toMatchObject({ ok: false, reason: "ページの応答が遅すぎます。", host: "slow.example.com" });
  });

  it("下書きの料理名はページのタイトル→ホスト名の順で補う", () => {
    const extracted = { name: null, ingredients: [], instructions: [], servingsText: "12人分", totalMinutes: null, imageUrl: "javascript:x", energyKcal: null };
    const draft = toDraft(extracted, "https://a.example.com/x", null);
    expect(draft.name).toBe("a.example.com");
    expect(draft.servings).toBe(2);
    expect(draft.imageUrl).toBeNull();
  });
});
