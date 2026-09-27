import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { calculateRecipeNutrition, type NutritionLine, type RecipeNutritionResult } from "@/lib/nutrition/recipe";

/** 食品成分表と栄養計算（Gate 2b）。利用者のsession（RLS）で呼ぶ */

export type FoodItem = { id: string; name: string; foodNumber: string; sourceVersion: string; energyKcal: number };

function sanitize(value: string) {
  return value.replace(/[%_\\,()"*:.]/g, " ").replace(/\s+/g, " ").trim().slice(0, 40);
}

export async function searchFoods(supabase: SupabaseClient, query: string): Promise<FoodItem[]> {
  const q = sanitize(query);
  if (!q) return [];
  const { data, error } = await supabase
    .from("food_composition_items")
    .select("id, name, food_number, source_version, energy_kcal")
    .ilike("name", `%${q}%`)
    .order("food_number")
    .limit(40);
  if (error) throw new Error(`食品を検索できませんでした: ${error.message}`);
  return (data ?? []).map((f) => ({
    id: f.id as string,
    name: f.name as string,
    foodNumber: f.food_number as string,
    sourceVersion: f.source_version as string,
    energyKcal: Number(f.energy_kcal),
  }));
}

export async function hasFoodComposition(supabase: SupabaseClient): Promise<boolean> {
  const { count } = await supabase.from("food_composition_items").select("id", { count: "exact", head: true });
  return (count ?? 0) > 0;
}

type LineRow = {
  raw_name: string;
  quantity: number | null;
  unit: string | null;
  ingredients: {
    grams_per_unit: number | null;
    grams_per_ml: number | null;
    food_composition_items: { energy_kcal: number; protein_g: number; fat_g: number; carbs_g: number; source_version: string } | null;
  } | null;
};

/** レシピの材料と対応付けから1人前の栄養を計算する（保存はしない） */
export async function calculateForRecipe(supabase: SupabaseClient, recipeId: string): Promise<(RecipeNutritionResult & { sourceVersion: string | null }) | null> {
  const [{ data: recipe }, { data: lines, error }] = await Promise.all([
    supabase.from("recipes").select("servings").eq("id", recipeId).maybeSingle(),
    supabase
      .from("recipe_ingredients")
      .select("raw_name, quantity, unit, ingredients(grams_per_unit, grams_per_ml, food_composition_items(energy_kcal, protein_g, fat_g, carbs_g, source_version))")
      .eq("recipe_id", recipeId),
  ]);
  if (!recipe || error) return null;
  const one = <T,>(v: T | T[] | null): T | null => (Array.isArray(v) ? (v[0] ?? null) : v);
  let sourceVersion: string | null = null;
  const input: NutritionLine[] = ((lines ?? []) as unknown as LineRow[]).map((line) => {
    const ingredient = one(line.ingredients);
    const food = ingredient ? one(ingredient.food_composition_items) : null;
    if (food) sourceVersion = food.source_version;
    return {
      name: line.raw_name,
      quantity: line.quantity === null ? null : Number(line.quantity),
      unit: line.unit,
      food: food ? { energyKcal: Number(food.energy_kcal), proteinG: Number(food.protein_g), fatG: Number(food.fat_g), carbsG: Number(food.carbs_g) } : null,
      gramsPerUnit: ingredient?.grams_per_unit === null || ingredient?.grams_per_unit === undefined ? null : Number(ingredient.grams_per_unit),
      gramsPerMl: ingredient?.grams_per_ml === null || ingredient?.grams_per_ml === undefined ? null : Number(ingredient.grams_per_ml),
    };
  });
  return { ...calculateRecipeNutrition(input, Number(recipe.servings)), sourceVersion };
}

/**
 * 手入力の値が無いレシピの栄養を、計算できれば保存する（出典 CALCULATED）。
 * 計算できなくなった場合は古い計算値を消す（手入力の値は変えない）。
 */
export async function refreshCalculatedNutrition(supabase: SupabaseClient, recipeId: string): Promise<void> {
  const { data: recipe } = await supabase.from("recipes").select("nutrition_source").eq("id", recipeId).maybeSingle();
  if (!recipe || recipe.nutrition_source === "MANUAL") return;
  const result = await calculateForRecipe(supabase, recipeId);
  if (!result) return;
  const patch = result.complete
    ? {
        energy_kcal: result.perServing.energyKcal,
        protein_g: result.perServing.proteinG,
        fat_g: result.perServing.fatG,
        carbs_g: result.perServing.carbsG,
        nutrition_source: "CALCULATED",
      }
    : { energy_kcal: null, protein_g: null, fat_g: null, carbs_g: null, nutrition_source: null };
  await supabase.from("recipes").update(patch).eq("id", recipeId);
}

/** 材料の対応付けを変えたら、その材料を使うレシピを計算し直す */
export async function refreshRecipesUsingIngredient(supabase: SupabaseClient, ingredientId: string): Promise<void> {
  const { data } = await supabase.from("recipe_ingredients").select("recipe_id").eq("ingredient_id", ingredientId).limit(500);
  for (const recipeId of new Set((data ?? []).map((r) => r.recipe_id as string))) {
    await refreshCalculatedNutrition(supabase, recipeId);
  }
}

export async function setIngredientNutrition(
  supabase: SupabaseClient,
  ingredientId: string,
  patch: { foodItemId?: string | null; gramsPerUnit?: number | null; gramsPerMl?: number | null },
): Promise<void> {
  const update: Record<string, unknown> = {};
  if (patch.foodItemId !== undefined) update.food_item_id = patch.foodItemId;
  if (patch.gramsPerUnit !== undefined) update.grams_per_unit = patch.gramsPerUnit;
  if (patch.gramsPerMl !== undefined) update.grams_per_ml = patch.gramsPerMl;
  const { error } = await supabase.from("ingredients").update(update).eq("id", ingredientId);
  if (error) throw new Error(`材料の栄養設定を保存できませんでした: ${error.message}`);
  await refreshRecipesUsingIngredient(supabase, ingredientId);
}
