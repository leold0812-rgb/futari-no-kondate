import { describe, expect, it } from "vitest";
import { calculateRecipeNutrition, gramsOf, type NutritionLine } from "@/lib/nutrition/recipe";

// テスト用の架空の値（実在の食品の値ではない）
const food = { energyKcal: 200, proteinG: 20, fatG: 10, carbsG: 5 };
const line = (overrides: Partial<NutritionLine>): NutritionLine => ({
  name: "材料",
  quantity: 100,
  unit: "g",
  food,
  gramsPerUnit: null,
  gramsPerMl: null,
  ...overrides,
});

describe("材料の重さへの換算", () => {
  it("質量はそのまま、体積は1ml当たりg、個数は1個当たりgで換算する", () => {
    expect(gramsOf(line({ quantity: 0.3, unit: "kg" }))).toBe(300);
    expect(gramsOf(line({ quantity: 1, unit: "大さじ", gramsPerMl: 1.2 }))).toBeCloseTo(18);
    expect(gramsOf(line({ quantity: 2, unit: "個", gramsPerUnit: 50 }))).toBe(100);
  });

  it("換算の情報が無ければnull（推測しない）", () => {
    expect(gramsOf(line({ quantity: 1, unit: "大さじ" }))).toBeNull();
    expect(gramsOf(line({ quantity: 2, unit: "個" }))).toBeNull();
    expect(gramsOf(line({ quantity: null, unit: "少々" }))).toBeNull();
  });
});

describe("レシピの1人前の栄養", () => {
  it("食品成分表の値と重さから合計し、人数で割る", () => {
    const result = calculateRecipeNutrition(
      [line({ quantity: 300, unit: "g" }), line({ quantity: 2, unit: "個", gramsPerUnit: 50 }), line({ name: "塩", quantity: null, unit: "少々", food: null })],
      2,
    );
    expect(result.perServing).toEqual({ energyKcal: 400, proteinG: 40, fatG: 20, carbsG: 10 });
    expect(result.complete).toBe(true);
    expect(result.uncounted).toEqual(["塩"]);
  });

  it("未対応・換算できない材料があれば不完全として示す", () => {
    const result = calculateRecipeNutrition(
      [line({ name: "鶏肉" }), line({ name: "謎の粉", food: null }), line({ name: "卵", quantity: 1, unit: "個" })],
      1,
    );
    expect(result.complete).toBe(false);
    expect(result.unmapped).toEqual(["謎の粉"]);
    expect(result.unconvertible).toEqual(["卵"]);
    expect(result.perServing.energyKcal).toBe(200);
  });
});
