import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
const { structureRecipeWithAi, RecipeAiError, DEFAULT_IMPORT_MODEL } = await import("@/lib/import/openai");

const page = { title: "豚汁", description: "具だくさん", imageUrl: null, text: "材料\n豚こま 150g\n大根 1/4本\n作り方\n煮る" };

function fakeFetch(status: number, body: unknown) {
  return vi.fn<typeof fetch>(async () =>
    new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } }),
  );
}

const okBody = (output: unknown) => ({
  status: "completed",
  output: [{ type: "message", content: [{ type: "output_text", text: JSON.stringify(output) }] }],
});

describe("AIによるレシピ構造化", () => {
  it("構造化出力を検証してレシピへ変換し、store:falseと既定モデルで1回だけ呼ぶ", async () => {
    const fetchImpl = fakeFetch(
      200,
      okBody({
        is_recipe: true,
        name: "豚汁",
        servings_text: "2人分",
        total_minutes: 25,
        ingredients: ["豚こま 150g", " 大根 1/4本 ", ""],
        instructions: ["煮る"],
      }),
    );
    const result = await structureRecipeWithAi(page, { apiKey: "test-key", fetchImpl });
    expect(result).toEqual({
      name: "豚汁",
      ingredients: ["豚こま 150g", "大根 1/4本"],
      instructions: ["煮る"],
      servingsText: "2人分",
      totalMinutes: 25,
      imageUrl: null,
      energyKcal: null,
    });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const request = JSON.parse(String(fetchImpl.mock.calls[0][1]?.body));
    expect(request.model).toBe(DEFAULT_IMPORT_MODEL);
    expect(request.store).toBe(false);
    expect(request.text.format.strict).toBe(true);
    expect(request.input[1].content).toContain("豚こま 150g");
  });

  it("レシピでないと判定されたら not_a_recipe", async () => {
    const fetchImpl = fakeFetch(200, okBody({ is_recipe: false, name: null, servings_text: null, total_minutes: null, ingredients: [], instructions: [] }));
    await expect(structureRecipeWithAi(page, { apiKey: "k", fetchImpl })).rejects.toMatchObject({ kind: "not_a_recipe" });
  });

  it("想定外の出力は invalid_output（DBへ入れない）", async () => {
    const fetchImpl = fakeFetch(200, okBody({ is_recipe: true, name: "x", ingredients: "not array" }));
    await expect(structureRecipeWithAi(page, { apiKey: "k", fetchImpl })).rejects.toMatchObject({ kind: "invalid_output" });
  });

  it("HTTPエラーは api。応答本文をエラーに含めず、再試行しない", async () => {
    const fetchImpl = fakeFetch(429, { error: { message: "secret detail" } });
    const error = await structureRecipeWithAi(page, { apiKey: "k", fetchImpl }).catch((e) => e);
    expect(error).toBeInstanceOf(RecipeAiError);
    expect(error.kind).toBe("api");
    expect(error.message).not.toContain("secret detail");
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("APIキーが無ければ呼ばずに not_configured", async () => {
    const fetchImpl = fakeFetch(200, {});
    await expect(structureRecipeWithAi(page, { apiKey: "", fetchImpl })).rejects.toMatchObject({ kind: "not_configured" });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("拒否（refusal）は invalid_output", async () => {
    const fetchImpl = fakeFetch(200, { output: [{ type: "message", content: [{ type: "refusal", refusal: "no" }] }] });
    await expect(structureRecipeWithAi(page, { apiKey: "k", fetchImpl })).rejects.toMatchObject({ kind: "invalid_output" });
  });
});
