import { describe, expect, it } from "vitest";
import { isLongKeeping, suggestInsurance, type InsuranceIngredient } from "@/lib/shopping/insurance";

const ing = (id: string, overrides: Partial<InsuranceIngredient>): InsuranceIngredient => ({
  id,
  name: id,
  category: "OTHER",
  storageDays: null,
  defaultUnit: null,
  recipeCount: 1,
  ...overrides,
});

describe("保険食材の提案", () => {
  it("日持ちする材料（冷凍・乾物・缶詰・米麺、保存目安14日以上）だけを対象にし、調味料は除く", () => {
    expect(isLongKeeping({ category: "FROZEN", storageDays: null })).toBe(true);
    expect(isLongKeeping({ category: "EGG_DAIRY", storageDays: 14 })).toBe(true);
    expect(isLongKeeping({ category: "VEGETABLE", storageDays: 5 })).toBe(false);
    expect(isLongKeeping({ category: "SEASONING", storageDays: 365 })).toBe(false);
  });

  it("在庫・リストにあるものを除き、使うレシピの多い順に最大3品", () => {
    const result = suggestInsurance(
      [
        ing("tuna", { category: "DRY_CANNED", recipeCount: 2 }),
        ing("udon", { category: "FROZEN", recipeCount: 5 }),
        ing("rice", { category: "GRAIN", recipeCount: 9 }),
        ing("pasta", { category: "GRAIN", recipeCount: 3 }),
        ing("unused", { category: "FROZEN", recipeCount: 0 }),
        ing("lettuce", { category: "VEGETABLE", storageDays: 4, recipeCount: 8 }),
      ],
      new Set(["rice"]),
    );
    expect(result.map((r) => r.ingredientId)).toEqual(["udon", "pasta", "tuna"]);
    expect(result[0].reason).toContain("5品");
  });
});
