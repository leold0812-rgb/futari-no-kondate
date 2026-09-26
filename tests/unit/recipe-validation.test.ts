import { describe, expect, it, vi } from "vitest";
import { deriveRecipeStatus, describeIssues, recipeInputSchema, type RecipeInput } from "@/lib/validation/recipe";

vi.mock("server-only", () => ({}));
const { toSavePayload, sortRecipes, sanitizeSearchTerm, ratingScore } = await import("@/lib/services/recipes");

const valid: RecipeInput = {
  name: "鶏の照り焼き",
  dishType: "MAIN",
  mainCategory: "MEAT",
  cuisine: "JAPANESE",
  servings: 2,
  cookingMinutes: 20,
  sourceUrl: null,
  instructions: ["鶏肉を焼く", "タレを絡める"],
  ingredients: [
    { rawName: "鶏もも肉", quantity: 300, unit: "g", note: null, isMain: true },
    { rawName: "★醤油", quantity: 2, unit: "大匙", note: null, isMain: false },
    { rawName: "塩", quantity: null, unit: "少々", note: null, isMain: false },
  ],
  highCost: false,
  specialSeasoning: false,
  oneDish: false,
  tags: ["高タンパク", "高タンパク"],
  memo: null,
  nutrition: { energyKcal: null, proteinG: null, fatG: null, carbsG: null },
};

describe("レシピ入力の検証", () => {
  it("正しい入力を受け付ける", () => {
    expect(recipeInputSchema.safeParse(valid).success).toBe(true);
  });

  it("料理名が空・長すぎる場合は日本語の理由を返す", () => {
    const result = recipeInputSchema.safeParse({ ...valid, name: "  " });
    expect(result.success).toBe(false);
    if (!result.success) expect(describeIssues(result.error)).toContain("料理名：料理名を入力してください");
  });

  it("材料の行番号つきで理由を返す", () => {
    const result = recipeInputSchema.safeParse({
      ...valid,
      ingredients: [valid.ingredients[0], { ...valid.ingredients[0], quantity: -1 }],
    });
    expect(result.success).toBe(false);
    if (!result.success) expect(describeIssues(result.error).join()).toContain("材料：2行目の分量は0より大きい数にしてください");
  });

  it.each([
    ["javascript:alert(1)"],
    ["ftp://example.com/a"],
    ["not a url"],
  ])("http(s)以外のURL %s は拒否する", (sourceUrl) => {
    expect(recipeInputSchema.safeParse({ ...valid, sourceUrl }).success).toBe(false);
  });

  it("空文字のURLはnullとして扱う", () => {
    const result = recipeInputSchema.safeParse({ ...valid, sourceUrl: "" });
    expect(result.success && result.data.sourceUrl).toBeNull();
  });

  it("人数・栄養の範囲外は拒否する", () => {
    expect(recipeInputSchema.safeParse({ ...valid, servings: 0 }).success).toBe(false);
    expect(recipeInputSchema.safeParse({ ...valid, servings: 9 }).success).toBe(false);
    expect(
      recipeInputSchema.safeParse({ ...valid, nutrition: { ...valid.nutrition, energyKcal: 6000 } }).success,
    ).toBe(false);
  });

  it("材料と手順がそろえばREADY、欠ければDRAFT", () => {
    expect(deriveRecipeStatus(valid)).toBe("READY");
    expect(deriveRecipeStatus({ ...valid, ingredients: [] })).toBe("DRAFT");
    expect(deriveRecipeStatus({ ...valid, instructions: [] })).toBe("DRAFT");
  });
});

describe("保存用データへの変換", () => {
  it("材料名を正規化して材料マスタへ対応付け、単位の表記ゆれをそろえる", () => {
    const { ingredients } = toSavePayload(valid);
    expect(ingredients[1]).toMatchObject({
      raw_name: "★醤油",
      ingredient_name: "醤油",
      category: "SEASONING",
      storage_days: null,
      unit: "大さじ",
    });
    expect(ingredients[0]).toMatchObject({ ingredient_name: "鶏もも肉", category: "MEAT", storage_days: 2, is_main: true });
  });

  it("タグの重複を除き、栄養が空なら出典もnull", () => {
    const { recipe } = toSavePayload(valid);
    expect(recipe.tags).toEqual(["高タンパク"]);
    expect(recipe.nutrition_source).toBeNull();
    expect(recipe.status).toBe("READY");
    expect("image_path" in recipe).toBe(false);
  });

  it("栄養を1つでも入れたら手入力として保存する", () => {
    const { recipe } = toSavePayload({ ...valid, nutrition: { ...valid.nutrition, energyKcal: 450 } });
    expect(recipe.nutrition_source).toBe("MANUAL");
  });

  it("画像を外す更新では image_path に null を送る", () => {
    expect(toSavePayload(valid, { imagePath: null }).recipe.image_path).toBeNull();
  });
});

describe("一覧の並べ替えと検索語", () => {
  const base = {
    status: "READY" as const,
    dishType: "MAIN" as const,
    mainCategory: null,
    cuisine: null,
    tags: [],
    imagePath: null,
    imageUrl: null,
    myFavorite: false,
    partnerFavorite: false,
  };
  const recipes = [
    { ...base, id: "a", name: "さばの味噌煮", cookingMinutes: 30, createdAt: "2026-09-01", myRating: "NORMAL" as const, partnerRating: null },
    { ...base, id: "b", name: "親子丼", cookingMinutes: 15, createdAt: "2026-09-03", myRating: "MAKE_AGAIN" as const, partnerRating: "MAKE_AGAIN" as const },
    { ...base, id: "c", name: "カレー", cookingMinutes: null, createdAt: "2026-09-02", myRating: "NEVER_AGAIN" as const, partnerRating: null },
  ];

  it("新しい順・評価順・時間順", () => {
    expect(sortRecipes(recipes, "new").map((r) => r.id)).toEqual(["b", "c", "a"]);
    expect(sortRecipes(recipes, "rating").map((r) => r.id)).toEqual(["b", "a", "c"]);
    expect(sortRecipes(recipes, "quick").map((r) => r.id)).toEqual(["b", "a", "c"]);
    expect(ratingScore(recipes[1])).toBe(4);
  });

  it("検索語からフィルター構文の特別な文字を除く", () => {
    expect(sanitizeSearchTerm("鶏%_,(肉)")).toBe("鶏 肉");
    expect(sanitizeSearchTerm('name.eq."x"')).toBe("name eq x");
  });
});

describe("画像の実データ検査", () => {
  it("先頭の署名から形式を判定し、申告と違えば拒否する", async () => {
    const { sniffImageType, verifyImageContent } = await import("@/lib/services/recipe-images");
    const png = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0]);
    const jpeg = Uint8Array.from([0xff, 0xd8, 0xff, 0xe0]);
    const webp = Uint8Array.from([0x52, 0x49, 0x46, 0x46, 1, 2, 3, 4, 0x57, 0x45, 0x42, 0x50]);
    expect(sniffImageType(png)).toBe("image/png");
    expect(sniffImageType(jpeg)).toBe("image/jpeg");
    expect(sniffImageType(webp)).toBe("image/webp");
    expect(sniffImageType(new TextEncoder().encode("<svg>"))).toBeNull();
    expect(await verifyImageContent(new Blob([jpeg], { type: "image/jpeg" }))).toBeNull();
    expect(await verifyImageContent(new Blob([new TextEncoder().encode("<html>")], { type: "image/jpeg" }))).not.toBeNull();
    expect(await verifyImageContent(new Blob([png], { type: "image/jpeg" }))).not.toBeNull();
  });
});
