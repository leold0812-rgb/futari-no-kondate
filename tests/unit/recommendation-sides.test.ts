import { describe, expect, it } from "vitest";
import { chooseSidesAndSoups, type DishCandidate, type MainDish, type SideContext } from "@/lib/recommendation/sides";

const context: SideContext = {
  today: "2026-10-01",
  inStockIngredientIds: new Set(["tofu"]),
  useSoonIngredientIds: new Set(["spinach"]),
};

const dish = (id: string, overrides: Partial<DishCandidate> = {}): DishCandidate => ({
  id,
  name: id,
  dishType: "SIDE",
  ingredientIds: [],
  hasVegetable: false,
  lowCalorie: false,
  lastCookedOn: null,
  ...overrides,
});

const main = (id: string, overrides: Partial<MainDish> = {}): MainDish => ({
  recipeId: id,
  name: id,
  oneDish: false,
  ingredientIds: [],
  hasVegetable: true,
  ...overrides,
});

describe("副菜・汁物の自動設定", () => {
  it("そろそろ使いたい食材・在庫・使い回しを優先し、理由を残す", () => {
    const result = chooseSidesAndSoups(
      [main("m1", { ingredientIds: ["cabbage"] })],
      [
        dish("s-plain"),
        dish("s-spinach", { ingredientIds: ["spinach"] }),
        dish("s-cabbage", { ingredientIds: ["cabbage"] }),
        dish("soup-tofu", { dishType: "SOUP", ingredientIds: ["tofu"] }),
        dish("soup-plain", { dishType: "SOUP" }),
      ],
      context,
    );
    expect(result[0].side).toEqual({ recipeId: "s-cabbage", reasons: ["献立の材料を使い回せる"] });
    expect(result[0].soup?.recipeId).toBe("soup-tofu");
  });

  it("主菜に野菜が少なければ野菜の副菜を優先する", () => {
    const [choice] = chooseSidesAndSoups(
      [main("m1", { hasVegetable: false })],
      [dish("s-a"), dish("s-veg", { hasVegetable: true })],
      context,
    );
    expect(choice.side?.recipeId).toBe("s-veg");
    expect(choice.side?.reasons).toContain("主菜に少ない野菜を補う");
  });

  it("同じ副菜・汁物は週内で重複させず、足りない時だけ重複して理由を残す", () => {
    const result = chooseSidesAndSoups(
      [main("m1"), main("m2"), main("m3")],
      [dish("s1"), dish("s2"), dish("soup1", { dishType: "SOUP" })],
      context,
    );
    expect(result.map((r) => r.side?.recipeId)).toEqual(["s1", "s2", "s1"]);
    expect(result[2].notes.join()).toContain("同じ週に同じ副菜");
    expect(result[1].notes.join()).toContain("同じ週に同じ汁物");
  });

  it("一品料理の主菜には付けない", () => {
    const [choice] = chooseSidesAndSoups([main("don", { oneDish: true })], [dish("s1"), dish("soup1", { dishType: "SOUP" })], context);
    expect(choice.side).toBeNull();
    expect(choice.soup).toBeNull();
  });

  it("最近作った副菜は後回しにし、レシピが無ければ付けない", () => {
    const [choice] = chooseSidesAndSoups(
      [main("m1")],
      [dish("s-recent", { lastCookedOn: "2026-09-29" }), dish("s-other")],
      context,
    );
    expect(choice.side?.recipeId).toBe("s-other");
    expect(choice.soup).toBeNull();
    expect(choice.notes).toContain("汁物のレシピが無いため、付けていません");
  });

  it("同じ入力なら同じ結果（決定的）", () => {
    const dishes = [dish("b"), dish("a"), dish("c", { dishType: "SOUP" })];
    expect(chooseSidesAndSoups([main("m")], dishes, context)).toEqual(chooseSidesAndSoups([main("m")], [...dishes].reverse(), context));
  });
});
