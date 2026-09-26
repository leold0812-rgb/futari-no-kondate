/**
 * 副菜・汁物の自動設定（Gate 6、docs/recommendation.md「副菜・汁物」）。AIを使わない決定的な純粋関数。
 *
 * 主菜5品が決まったあと、候補セット全体を見て各主菜に副菜1品・汁物1品を選ぶ。
 *   食材の使い回し +15 / 現在庫の消費 +12 / そろそろ使いたい食材 +14 / 主菜で不足する栄養カテゴリ（野菜）の補完 +8 /
 *   低カロリー +6 / 最近の重複 -6
 * 同じ副菜・汁物の週内重複は原則避け（候補が足りない時だけ許可して理由を残す）、一品料理の主菜には付けない。
 */
import { daysBetween } from "@/lib/dates";

export const SIDES_ALGORITHM_VERSION = "sides-v0.1";

export type DishCandidate = {
  id: string;
  name: string;
  dishType: "SIDE" | "SOUP";
  ingredientIds: string[];
  /** 野菜・きのこ・海藻など「野菜」カテゴリの材料を使うか */
  hasVegetable: boolean;
  lowCalorie: boolean;
  lastCookedOn: string | null;
};

export type MainDish = {
  recipeId: string;
  name: string;
  oneDish: boolean;
  ingredientIds: string[];
  hasVegetable: boolean;
};

export type SideContext = {
  today: string;
  inStockIngredientIds: ReadonlySet<string>;
  useSoonIngredientIds: ReadonlySet<string>;
};

export type SideChoice = {
  mainRecipeId: string;
  side: { recipeId: string; reasons: string[] } | null;
  soup: { recipeId: string; reasons: string[] } | null;
  notes: string[];
};

const RECENT_DAYS = 14;

function score(dish: DishCandidate, main: MainDish, usedIngredients: ReadonlySet<string>, context: SideContext) {
  const reasons: string[] = [];
  let points = 0;
  const shares = dish.ingredientIds.filter((id) => usedIngredients.has(id) || main.ingredientIds.includes(id));
  if (shares.length > 0) {
    points += 15;
    reasons.push("献立の材料を使い回せる");
  }
  if (dish.ingredientIds.some((id) => context.inStockIngredientIds.has(id))) {
    points += 12;
    reasons.push("在庫を使える");
  }
  if (dish.ingredientIds.some((id) => context.useSoonIngredientIds.has(id))) {
    points += 14;
    reasons.push("そろそろ使いたい食材を使う");
  }
  if (!main.hasVegetable && dish.hasVegetable) {
    points += 8;
    reasons.push("主菜に少ない野菜を補う");
  }
  if (dish.lowCalorie) {
    points += 6;
    reasons.push("低カロリー");
  }
  if (dish.lastCookedOn && daysBetween(dish.lastCookedOn, context.today) < RECENT_DAYS) {
    points -= 6;
    reasons.push("最近作った");
  }
  return { points, reasons };
}

function pick(
  candidates: DishCandidate[],
  main: MainDish,
  usedDishIds: Set<string>,
  usedIngredients: Set<string>,
  context: SideContext,
): { dish: DishCandidate; reasons: string[]; repeated: boolean } | null {
  let best: { dish: DishCandidate; reasons: string[]; points: number; repeated: boolean } | null = null;
  for (const allowRepeat of [false, true]) {
    for (const dish of candidates) {
      const repeated = usedDishIds.has(dish.id);
      if (repeated && !allowRepeat) continue;
      const { points, reasons } = score(dish, main, usedIngredients, context);
      if (!best || points > best.points || (points === best.points && dish.id < best.dish.id)) {
        best = { dish, reasons, points, repeated };
      }
    }
    if (best) break;
  }
  return best ? { dish: best.dish, reasons: best.reasons, repeated: best.repeated } : null;
}

export function chooseSidesAndSoups(mains: MainDish[], dishes: DishCandidate[], context: SideContext): SideChoice[] {
  const sides = [...dishes.filter((d) => d.dishType === "SIDE")].sort((a, b) => a.id.localeCompare(b.id));
  const soups = [...dishes.filter((d) => d.dishType === "SOUP")].sort((a, b) => a.id.localeCompare(b.id));
  const usedDishIds = new Set<string>();
  const usedIngredients = new Set<string>(mains.flatMap((m) => m.ingredientIds));

  return mains.map((main) => {
    if (main.oneDish) {
      return { mainRecipeId: main.recipeId, side: null, soup: null, notes: ["一品で完結する料理のため、副菜・汁物は付けません"] };
    }
    const notes: string[] = [];
    const chosen: Pick<SideChoice, "side" | "soup"> = { side: null, soup: null };
    for (const [key, list, label] of [
      ["side", sides, "副菜"],
      ["soup", soups, "汁物"],
    ] as const) {
      const result = pick(list, main, usedDishIds, usedIngredients, context);
      if (!result) {
        notes.push(`${label}のレシピが無いため、付けていません`);
        continue;
      }
      if (result.repeated) notes.push(`${label}の候補が足りないため、同じ週に同じ${label}があります`);
      usedDishIds.add(result.dish.id);
      for (const id of result.dish.ingredientIds) usedIngredients.add(id);
      chosen[key] = { recipeId: result.dish.id, reasons: result.reasons };
    }
    return { mainRecipeId: main.recipeId, ...chosen, notes };
  });
}
