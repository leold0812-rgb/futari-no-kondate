import { describe, expect, it } from "vitest";
import { aggregateShopping, describeAmount, type ShoppingDish } from "@/lib/shopping/aggregate";

const dishes: ShoppingDish[] = [
  {
    recipeName: "照り焼き",
    factor: 1,
    lines: [
      { ingredientId: "chicken", name: "鶏もも肉", category: "MEAT", quantity: 300, unit: "g" },
      { ingredientId: "soy", name: "醤油", category: "SEASONING", quantity: 2, unit: "大さじ" },
      { ingredientId: "salt", name: "塩", category: "SEASONING", quantity: null, unit: "少々" },
    ],
  },
  {
    recipeName: "親子丼（4人分を2人で）",
    factor: 0.5,
    lines: [
      { ingredientId: "chicken", name: "鶏もも肉", category: "MEAT", quantity: 0.4, unit: "kg" },
      { ingredientId: "egg", name: "卵", category: "EGG_DAIRY", quantity: 6, unit: "個" },
      { ingredientId: "soy", name: "醤油", category: "SEASONING", quantity: 3, unit: "小さじ" },
      { ingredientId: "chicken", name: "鶏もも肉", category: "MEAT", quantity: 1, unit: "パック" },
    ],
  },
  {
    recipeName: "サラダ",
    factor: 1,
    lines: [
      { ingredientId: "salt", name: "塩", category: "SEASONING", quantity: 1, unit: "小さじ" },
      { ingredientId: null, name: "ドレッシング", category: "SEASONING", quantity: null, unit: "適量" },
    ],
  },
];

describe("買い物の材料合算", () => {
  const items = aggregateShopping(dishes, [
    { ingredientId: "chicken", quantity: 100, unit: "g" },
    { ingredientId: "chicken", quantity: 2, unit: "個" },
    { ingredientId: "egg", quantity: 1, unit: "個" },
  ]);
  const find = (name: string, group?: string) => items.find((i) => i.name === name && (!group || i.group === group))!;

  it("互換単位は人数換算してから合計し、在庫を差し引く", () => {
    expect(find("鶏もも肉", "mass")).toMatchObject({ required: 500, inStock: 100, toBuy: 400, unit: "g", recipes: ["照り焼き", "親子丼（4人分を2人で）"] });
    expect(find("醤油")).toMatchObject({ group: "volume", required: 37.5, toBuy: 37.5, unit: "ml" });
    expect(find("卵")).toMatchObject({ group: "count:個", required: 3, inStock: 1, toBuy: 2 });
  });

  it("互換でない単位（パックとg、個の在庫）は混ぜない", () => {
    expect(find("鶏もも肉", "count:パック")).toMatchObject({ required: 0.5, inStock: 0, toBuy: 0.5 });
  });

  it("数量のある行があれば「少々」は合算に含め、数量のない材料だけ「家にあるか確認」にする", () => {
    expect(items.filter((i) => i.name === "塩")).toHaveLength(1);
    expect(find("塩")).toMatchObject({ uncounted: false, toBuy: 5, recipes: ["サラダ", "照り焼き"] });
    expect(find("ドレッシング")).toMatchObject({ uncounted: true, toBuy: null, required: null });
  });

  it("在庫で足りていれば買う量は0", () => {
    const [item] = aggregateShopping([{ recipeName: "x", factor: 1, lines: [dishes[1].lines[1]] }], [{ ingredientId: "egg", quantity: 10, unit: "個" }]);
    expect(item.toBuy).toBe(0);
  });

  it("表示は読みやすい単位にする", () => {
    expect(describeAmount(1500, "mass")).toBe("1.5kg");
    expect(describeAmount(37.5, "volume")).toBe("大さじ2と1/2");
    expect(describeAmount(2, "count:個")).toBe("2個");
    expect(describeAmount(null, "none")).toBe("");
  });
});
