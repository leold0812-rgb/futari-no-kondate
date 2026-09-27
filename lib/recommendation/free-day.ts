/**
 * 余裕日の候補（Gate 7、docs/recommendation.md「余裕日」）。AIを使わない決定的な純粋関数。
 * 在庫（そろそろ使いたい食材・保険食材を含む）で作れる割合を最優先し、15〜20分で作れる・追加購入0〜2品の料理を優先する。
 */
import { daysBetween } from "@/lib/dates";
import { toBaseQuantity, unitGroup } from "@/lib/units";

export type FreeDayRecipe = {
  id: string;
  name: string;
  cookingMinutes: number | null;
  servings: number;
  neverAgain: boolean;
  lastCookedOn: string | null;
  lines: { ingredientId: string | null; name: string; quantity: number | null; unit: string | null }[];
};

export type FreeDayContext = {
  today: string;
  /** 材料ID → 単位グループ → 基準単位の在庫量 */
  stock: ReadonlyMap<string, ReadonlyMap<string, number>>;
  useSoonIngredientIds: ReadonlySet<string>;
  /** 作る人数 */
  servings: number;
};

export type FreeDayCandidate = {
  recipeId: string;
  name: string;
  score: number;
  coverage: number;
  missing: string[];
  reasons: string[];
};

export const FREE_DAY_COUNT = 5;

export function scoreFreeDay(recipe: FreeDayRecipe, context: FreeDayContext): FreeDayCandidate {
  const factor = context.servings / Math.max(1, recipe.servings);
  // 同じ食材・同じ単位グループの行は必要量を合算してから在庫と比べる
  const needs = new Map<string, { name: string; ingredientId: string | null; group: string; amount: number }>();
  for (const line of recipe.lines) {
    if (line.quantity === null) continue;
    const group = unitGroup(line.unit);
    const key = `${line.ingredientId ?? `name:${line.name}`}|${group}`;
    const entry = needs.get(key) ?? { name: line.name, ingredientId: line.ingredientId, group, amount: 0 };
    entry.amount += (toBaseQuantity(line.quantity, line.unit) ?? line.quantity) * factor;
    needs.set(key, entry);
  }
  const counted = [...needs.values()];
  const missing: string[] = [];
  let covered = 0;
  for (const need of counted) {
    const have = need.ingredientId ? (context.stock.get(need.ingredientId)?.get(need.group) ?? 0) : 0;
    if (have >= need.amount - 1e-9) covered += 1;
    else if (!missing.includes(need.name)) missing.push(need.name);
  }
  const coverage = counted.length === 0 ? 0 : covered / counted.length;
  const reasons: string[] = [];
  let score = Math.round(50 * coverage);
  if (counted.length > 0) reasons.push(`在庫で材料の${Math.round(coverage * 100)}%を賄える`);

  const useSoon = new Set(recipe.lines.map((l) => l.ingredientId).filter((id): id is string => Boolean(id && context.useSoonIngredientIds.has(id))));
  if (useSoon.size > 0) {
    score += Math.min(20, useSoon.size * 10);
    reasons.push("そろそろ使いたい食材を使う");
  }
  if (recipe.cookingMinutes !== null && recipe.cookingMinutes <= 20) {
    score += 10;
    reasons.push(`${recipe.cookingMinutes}分で作れる`);
  } else if (recipe.cookingMinutes !== null && recipe.cookingMinutes <= 30) {
    score += 5;
  } else if (recipe.cookingMinutes === null) {
    score += 2;
  }
  score += missing.length === 0 ? 15 : missing.length === 1 ? 8 : missing.length === 2 ? 3 : -20;
  if (missing.length === 0 && counted.length > 0) reasons.push("買い足しなしで作れる");
  if (recipe.lastCookedOn && daysBetween(recipe.lastCookedOn, context.today) < 7) {
    score -= 10;
    reasons.push("最近作った");
  }
  return { recipeId: recipe.id, name: recipe.name, score, coverage, missing, reasons };
}

export function recommendFreeDay(recipes: FreeDayRecipe[], context: FreeDayContext): FreeDayCandidate[] {
  const scored = recipes
    .filter((r) => !r.neverAgain && r.lines.length > 0)
    .map((r) => scoreFreeDay(r, context))
    .sort((a, b) => b.score - a.score || b.coverage - a.coverage || a.recipeId.localeCompare(b.recipeId));
  // 追加購入が3品以上の料理は、ほかに候補が足りない時だけ出す
  const preferred = scored.filter((c) => c.missing.length <= 2);
  return (preferred.length >= FREE_DAY_COUNT ? preferred : [...preferred, ...scored.filter((c) => c.missing.length > 2)]).slice(0, FREE_DAY_COUNT);
}
