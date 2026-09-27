import { describe, expect, it } from "vitest";
import { personNutrition } from "@/lib/nutrition/meal";
import { recommendFreeDay, type FreeDayContext, type FreeDayRecipe } from "@/lib/recommendation/free-day";

describe("献立セットの1人分の栄養", () => {
  const dishes = [
    { name: "照り焼き", nutrition: { energyKcal: 450, proteinG: 30, fatG: 20, carbsG: 15 } },
    { name: "味噌汁", nutrition: { energyKcal: 50, proteinG: 3, fatG: 1.5, carbsG: 5 } },
  ];
  it("料理とご飯の栄養を合計する", () => {
    const n = personNutrition(dishes, 150, { energyKcal: 100, proteinG: 2, fatG: 0.2, carbsG: 30 });
    expect(n).toEqual({ energyKcal: 650, proteinG: 36, fatG: 21.8, carbsG: 65, riceGrams: 150, complete: true, missing: [] });
  });
  it("値の無い料理やご飯の栄養が分からない場合は推測せず、未登録として示す", () => {
    const n = personNutrition([...dishes, { name: "おひたし", nutrition: { energyKcal: null, proteinG: null, fatG: null, carbsG: null } }], 150, null);
    expect(n.complete).toBe(false);
    expect(n.missing).toEqual(["おひたし", "ご飯"]);
    expect(n.energyKcal).toBe(500);
  });
  it("エネルギーだけ登録されPFCが未登録の料理は、0として合算せず未登録にする", () => {
    const n = personNutrition([{ name: "一部だけ", nutrition: { energyKcal: 300, proteinG: null, fatG: 5, carbsG: 10 } }], 0, null);
    expect(n.complete).toBe(false);
    expect(n.missing).toEqual(["一部だけ"]);
    expect(n.energyKcal).toBe(0);
  });

  it("ご飯なし（0g）ならご飯の栄養は不要", () => {
    expect(personNutrition(dishes, 0, null).complete).toBe(true);
  });
});

describe("余裕日の候補", () => {
  const context: FreeDayContext = {
    today: "2026-10-01",
    stock: new Map([
      ["egg", new Map([["count:個", 4]])],
      ["rice", new Map([["mass", 1000]])],
      ["spinach", new Map([["count:束", 1]])],
    ]),
    useSoonIngredientIds: new Set(["spinach"]),
    servings: 2,
  };
  const recipe = (id: string, overrides: Partial<FreeDayRecipe>): FreeDayRecipe => ({
    id,
    name: id,
    cookingMinutes: 15,
    servings: 2,
    neverAgain: false,
    lastCookedOn: null,
    lines: [],
    ...overrides,
  });

  it("在庫で作れる・そろそろ使いたい食材を使う・短時間の料理を優先し、足りない材料を示す", () => {
    const result = recommendFreeDay(
      [
        recipe("omurice", { lines: [{ ingredientId: "egg", name: "卵", quantity: 2, unit: "個" }, { ingredientId: "rice", name: "ご飯", quantity: 300, unit: "g" }] }),
        recipe("ohitashi", { cookingMinutes: 10, lines: [{ ingredientId: "spinach", name: "ほうれん草", quantity: 1, unit: "束" }, { ingredientId: null, name: "醤油", quantity: null, unit: "少々" }] }),
        recipe("curry", { cookingMinutes: 60, lines: [{ ingredientId: "pork", name: "豚肉", quantity: 200, unit: "g" }, { ingredientId: "onion", name: "玉ねぎ", quantity: 1, unit: "個" }, { ingredientId: "carrot", name: "人参", quantity: 1, unit: "本" }] }),
        recipe("never", { neverAgain: true, lines: [{ ingredientId: "egg", name: "卵", quantity: 1, unit: "個" }] }),
      ],
      context,
    );
    expect(result.map((c) => c.recipeId)).toEqual(["ohitashi", "omurice", "curry"]);
    expect(result[0].reasons).toContain("そろそろ使いたい食材を使う");
    expect(result[1].missing).toEqual([]);
    expect(result[2].missing).toEqual(["豚肉", "玉ねぎ", "人参"]);
  });

  it("人数に合わせて在庫の足りる・足りないを判定する", () => {
    const [candidate] = recommendFreeDay(
      [recipe("omurice4", { servings: 1, lines: [{ ingredientId: "egg", name: "卵", quantity: 3, unit: "個" }] })],
      context,
    );
    expect(candidate.missing).toEqual(["卵"]);
  });

  it("同じ食材の行は必要量を合算して判定する", () => {
    const [candidate] = recommendFreeDay(
      [recipe("double-egg", { lines: [{ ingredientId: "egg", name: "卵", quantity: 3, unit: "個" }, { ingredientId: "egg", name: "卵", quantity: 2, unit: "個" }] })],
      context,
    );
    expect(candidate.missing).toEqual(["卵"]);
  });
});
