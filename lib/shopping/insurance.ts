/**
 * 保険食材の提案（Gate 6、仕様「任意で保険食材1〜3品を追加する」）。副作用のない純粋関数。
 * 予定が崩れた日（余裕日・予定外）でも1品作れるよう、日持ちする材料のうち在庫に無く、登録済みのレシピでよく使うものを提案する。
 */
import type { IngredientCategory } from "@/lib/ingredients";

export type InsuranceIngredient = {
  id: string;
  name: string;
  category: IngredientCategory;
  storageDays: number | null;
  defaultUnit: string | null;
  /** この材料を使う（READYの）レシピの数 */
  recipeCount: number;
};

export type InsuranceSuggestion = { ingredientId: string; name: string; reason: string };

const LONG_KEEPING_CATEGORIES: IngredientCategory[] = ["FROZEN", "DRY_CANNED", "GRAIN"];
export const MAX_INSURANCE = 3;

export function isLongKeeping(ingredient: Pick<InsuranceIngredient, "category" | "storageDays">): boolean {
  if (ingredient.category === "SEASONING") return false;
  return LONG_KEEPING_CATEGORIES.includes(ingredient.category) || (ingredient.storageDays ?? 0) >= 14;
}

export function suggestInsurance(
  ingredients: InsuranceIngredient[],
  excludedIngredientIds: ReadonlySet<string>,
): InsuranceSuggestion[] {
  return ingredients
    .filter((i) => i.recipeCount > 0 && isLongKeeping(i) && !excludedIngredientIds.has(i.id))
    .sort((a, b) => b.recipeCount - a.recipeCount || a.name.localeCompare(b.name, "ja") || a.id.localeCompare(b.id))
    .slice(0, MAX_INSURANCE)
    .map((i) => ({ ingredientId: i.id, name: i.name, reason: `日持ちし、登録済みの${i.recipeCount}品のレシピで使えます` }));
}
