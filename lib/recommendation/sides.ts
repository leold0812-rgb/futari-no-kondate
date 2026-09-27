/**
 * 副菜・汁物の自動設定（Gate 6、docs/recommendation.md「副菜・汁物」）。AIを使わない決定的な純粋関数。
 *
 * 主菜5品が決まったあと、候補セット全体を見て各主菜に副菜1品・汁物1品を選ぶ。
 *   食材の使い回し +15 / 現在庫の消費 +12 / そろそろ使いたい食材 +14 / 主菜で不足する栄養カテゴリ（野菜）の補完 +8 /
 *   低カロリー +6 / 最近の重複 -6
 * 同じ副菜・汁物の週内重複は原則避け（候補が足りない時だけ許可して理由を残す）、一品料理の主菜には付けない。
 * 主菜の順に貪欲に選んだあと、組み合わせ全体の点（各品の点の合計 − 新しく買う材料の種類数 × 3 − 重複 × 30）が
 * 上がる入れ替えを探して見直す（「食材の合算結果が不自然に増える場合は全体スコアで組み合わせを再評価」）。
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

const NEW_INGREDIENT_PENALTY = 3;
const REPEAT_PENALTY = 30;
const MAX_PASSES = 4;

type Assignment = { side: DishCandidate | null; soup: DishCandidate | null }[];

/** 組み合わせ全体の点。各品は「主菜と他の副菜・汁物の材料」との使い回しで評価する */
function totalScore(mains: MainDish[], assignment: Assignment, context: SideContext): number {
  const chosen = assignment.flatMap((a) => [a.side, a.soup]).filter((d): d is DishCandidate => d !== null);
  const mainIngredients = new Set(mains.flatMap((m) => m.ingredientIds));
  let total = 0;
  assignment.forEach((a, i) => {
    for (const dish of [a.side, a.soup]) {
      if (!dish) continue;
      const others = new Set([...mainIngredients, ...chosen.filter((d) => d !== dish).flatMap((d) => d.ingredientIds)]);
      total += score(dish, mains[i], others, context).points;
    }
  });
  const newIngredients = new Set(
    chosen.flatMap((d) => d.ingredientIds).filter((id) => !mainIngredients.has(id) && !context.inStockIngredientIds.has(id)),
  );
  const counts = new Map<string, number>();
  for (const d of chosen) counts.set(d.id, (counts.get(d.id) ?? 0) + 1);
  const repeats = [...counts.values()].reduce((sum, n) => sum + (n - 1), 0);
  return total - newIngredients.size * NEW_INGREDIENT_PENALTY - repeats * REPEAT_PENALTY;
}

export function chooseSidesAndSoups(mains: MainDish[], dishes: DishCandidate[], context: SideContext): SideChoice[] {
  const sides = [...dishes.filter((d) => d.dishType === "SIDE")].sort((a, b) => a.id.localeCompare(b.id));
  const soups = [...dishes.filter((d) => d.dishType === "SOUP")].sort((a, b) => a.id.localeCompare(b.id));
  const usedDishIds = new Set<string>();
  const usedIngredients = new Set<string>(mains.flatMap((m) => m.ingredientIds));

  // 1. 主菜の順に貪欲に選ぶ
  const assignment: Assignment = mains.map((main) => {
    if (main.oneDish) return { side: null, soup: null };
    const picked: Assignment[number] = { side: null, soup: null };
    for (const [key, list] of [
      ["side", sides],
      ["soup", soups],
    ] as const) {
      const result = pick(list, main, usedDishIds, usedIngredients, context);
      if (!result) continue;
      usedDishIds.add(result.dish.id);
      for (const id of result.dish.ingredientIds) usedIngredients.add(id);
      picked[key] = result.dish;
    }
    return picked;
  });

  // 2. 組み合わせ全体の点が上がる入れ替えを探す（決定的な順序で、改善が無くなるまで）
  const revised = new Set<number>();
  let best = totalScore(mains, assignment, context);
  for (let pass = 0; pass < MAX_PASSES; pass += 1) {
    let improved = false;
    assignment.forEach((current, i) => {
      if (mains[i].oneDish) return;
      for (const [key, list] of [
        ["side", sides],
        ["soup", soups],
      ] as const) {
        if (!current[key]) continue;
        for (const alternative of list) {
          if (alternative.id === current[key]!.id) continue;
          const previous: DishCandidate | null = current[key];
          current[key] = alternative;
          const candidate = totalScore(mains, assignment, context);
          if (candidate > best) {
            best = candidate;
            improved = true;
            revised.add(i);
          } else {
            current[key] = previous;
          }
        }
      }
    });
    if (!improved) break;
  }

  // 3. 理由とメモを最終の組み合わせで作る
  const counts = new Map<string, number>();
  for (const a of assignment) for (const d of [a.side, a.soup]) if (d) counts.set(d.id, (counts.get(d.id) ?? 0) + 1);
  const chosen = assignment.flatMap((a) => [a.side, a.soup]).filter((d): d is DishCandidate => d !== null);
  const mainIngredients = new Set(mains.flatMap((m) => m.ingredientIds));

  return mains.map((main, i) => {
    if (main.oneDish) {
      return { mainRecipeId: main.recipeId, side: null, soup: null, notes: ["一品で完結する料理のため、副菜・汁物は付けません"] };
    }
    const notes: string[] = [];
    const result: SideChoice = { mainRecipeId: main.recipeId, side: null, soup: null, notes };
    for (const [key, label, list] of [
      ["side", "副菜", sides],
      ["soup", "汁物", soups],
    ] as const) {
      const dish = assignment[i][key];
      if (!dish) {
        if (list.length === 0) notes.push(`${label}のレシピが無いため、付けていません`);
        continue;
      }
      const others = new Set([...mainIngredients, ...chosen.filter((d) => d !== dish).flatMap((d) => d.ingredientIds)]);
      result[key] = { recipeId: dish.id, reasons: score(dish, main, others, context).reasons };
      if ((counts.get(dish.id) ?? 0) > 1) notes.push(`${label}の候補が足りないため、同じ週に同じ${label}があります`);
    }
    if (revised.has(i)) notes.push("買う材料が少なくなるよう、組み合わせ全体で見直しました");
    return result;
  });
}

/** 差し替え用：1つの主菜に対する副菜（または汁物）の候補を点の高い順に並べる */
export function rankAlternatives(
  main: MainDish,
  candidates: DishCandidate[],
  usedIngredientIds: ReadonlySet<string>,
  context: SideContext,
): { dish: DishCandidate; points: number; reasons: string[] }[] {
  return candidates
    .map((dish) => ({ dish, ...score(dish, main, usedIngredientIds, context) }))
    .sort((a, b) => b.points - a.points || a.dish.id.localeCompare(b.dish.id));
}
