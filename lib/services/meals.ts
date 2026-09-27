import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { CurrentMember } from "@/lib/auth/session";
import { tokyoDate } from "@/lib/dates";
import { freshnessOf, freshnessPriority } from "@/lib/inventory/status";
import { personNutrition, type Nutrition, type PersonNutrition } from "@/lib/nutrition/meal";
import { rankAlternatives, type DishCandidate } from "@/lib/recommendation/sides";
import { formatQuantity, scaleQuantity } from "@/lib/units";
import { getPartner } from "./members";
import { signImagePaths } from "./recipes";

/** 平日の献立（Gate 7）。利用者のsession（RLS）で呼ぶ。書き込みはDB関数だけ */

export type DishView = {
  recipeId: string;
  kind: "MAIN" | "SIDE" | "SOUP";
  name: string;
  imageUrl: string | null;
  cookingMinutes: number | null;
  nutrition: Nutrition;
  ingredients: { name: string; amount: string }[];
};

export type MealSetDetail = {
  id: string;
  planId: string;
  weekStart: string;
  status: "PLANNED" | "COOKED";
  servings: number;
  version: number;
  dishes: DishView[];
  people: { userId: string; name: string; isMe: boolean; nutrition: PersonNutrition }[];
};

const num = (v: unknown) => (v === null || v === undefined ? null : Number(v));

/** ご飯100g当たりの栄養（食品成分表を取り込んでいれば。Gate 2bで設定。無ければnull） */
export async function getRiceNutrition(supabase: SupabaseClient): Promise<Nutrition | null> {
  const { data, error } = await supabase.rpc("rice_nutrition_per_100g");
  if (error || !data || (Array.isArray(data) && data.length === 0)) return null;
  const row = Array.isArray(data) ? data[0] : data;
  return { energyKcal: num(row.energy_kcal), proteinG: num(row.protein_g), fatG: num(row.fat_g), carbsG: num(row.carbs_g) };
}

export async function getRicePortions(supabase: SupabaseClient): Promise<Map<string, number>> {
  const { data } = await supabase.from("rice_portions").select("user_id, grams");
  return new Map((data ?? []).map((r) => [r.user_id as string, r.grams as number]));
}

export async function getMealSetDetail(supabase: SupabaseClient, me: CurrentMember, mealSetId: string): Promise<MealSetDetail | null> {
  const { data: set } = await supabase
    .from("meal_sets")
    .select("id, weekly_plan_id, main_recipe_id, side_recipe_id, soup_recipe_id, servings, status, version, weekly_plans(week_start)")
    .eq("id", mealSetId)
    .maybeSingle();
  if (!set) return null;
  const plan = (Array.isArray(set.weekly_plans) ? set.weekly_plans[0] : set.weekly_plans) as { week_start: string } | null;
  const refs = [
    { id: set.main_recipe_id as string, kind: "MAIN" as const },
    { id: set.side_recipe_id as string | null, kind: "SIDE" as const },
    { id: set.soup_recipe_id as string | null, kind: "SOUP" as const },
  ].filter((r): r is { id: string; kind: "MAIN" | "SIDE" | "SOUP" } => Boolean(r.id));

  const [{ data: recipes }, { data: lines }, partner, portions, rice] = await Promise.all([
    supabase
      .from("recipes")
      .select("id, name, image_path, cooking_minutes, servings, energy_kcal, protein_g, fat_g, carbs_g")
      .in("id", refs.map((r) => r.id)),
    supabase
      .from("recipe_ingredients")
      .select("recipe_id, raw_name, quantity, unit")
      .in("recipe_id", refs.map((r) => r.id))
      .order("sort_order"),
    getPartner(supabase, me),
    getRicePortions(supabase),
    getRiceNutrition(supabase),
  ]);
  const images = await signImagePaths(supabase, (recipes ?? []).map((r) => r.image_path as string | null));
  const servings = set.servings as number;

  const dishes: DishView[] = refs.map((ref) => {
    const recipe = recipes?.find((r) => r.id === ref.id);
    const factor = servings / Math.max(1, (recipe?.servings as number | undefined) ?? 2);
    return {
      recipeId: ref.id,
      kind: ref.kind,
      name: (recipe?.name as string | undefined) ?? "（削除されたレシピ）",
      imageUrl: recipe?.image_path ? (images.get(recipe.image_path as string) ?? null) : null,
      cookingMinutes: (recipe?.cooking_minutes as number | null | undefined) ?? null,
      nutrition: {
        energyKcal: num(recipe?.energy_kcal),
        proteinG: num(recipe?.protein_g),
        fatG: num(recipe?.fat_g),
        carbsG: num(recipe?.carbs_g),
      },
      ingredients: (lines ?? [])
        .filter((l) => l.recipe_id === ref.id)
        .map((l) => ({
          name: l.raw_name as string,
          amount: formatQuantity(scaleQuantity(num(l.quantity), factor, l.unit as string | null), l.unit as string | null),
        })),
    };
  });

  const members = [{ userId: me.userId, name: me.displayName, isMe: true }, ...(partner ? [{ userId: partner.userId, name: partner.displayName, isMe: false }] : [])];
  return {
    id: set.id as string,
    planId: set.weekly_plan_id as string,
    weekStart: plan?.week_start ?? "",
    status: set.status as "PLANNED" | "COOKED",
    servings,
    version: set.version as number,
    dishes,
    people: members.map((m) => ({
      ...m,
      nutrition: personNutrition(
        dishes.map((d) => ({ name: d.name, nutrition: d.nutrition })),
        portions.get(m.userId) ?? 0,
        rice,
      ),
    })),
  };
}

/** 副菜・汁物の差し替え候補（READY・もう作らないを除く）を、献立との相性順に */
export async function listAlternatives(supabase: SupabaseClient, detail: MealSetDetail, kind: "SIDE" | "SOUP") {
  const today = tokyoDate();
  const [{ data: recipes }, { data: never }, { data: lines }, { data: stock }] = await Promise.all([
    supabase.from("recipes").select("id, name, tags").eq("dish_type", kind).eq("status", "READY").is("deleted_at", null).limit(500),
    supabase.from("recipe_ratings").select("recipe_id").eq("rating", "NEVER_AGAIN"),
    supabase.from("recipe_ingredients").select("recipe_id, ingredient_id, ingredients(category)").not("ingredient_id", "is", null).limit(20000),
    supabase.from("inventory_items").select("ingredient_id, purchased_on, ingredients(storage_days)").gt("quantity", 0),
  ]);
  const excluded = new Set((never ?? []).map((r) => r.recipe_id as string));
  const byRecipe = new Map<string, { ids: string[]; vegetable: boolean }>();
  for (const l of (lines ?? []) as unknown as { recipe_id: string; ingredient_id: string; ingredients: { category: string } | { category: string }[] | null }[]) {
    const ing = Array.isArray(l.ingredients) ? l.ingredients[0] : l.ingredients;
    const entry = byRecipe.get(l.recipe_id) ?? { ids: [], vegetable: false };
    entry.ids.push(l.ingredient_id);
    if (ing?.category === "VEGETABLE") entry.vegetable = true;
    byRecipe.set(l.recipe_id, entry);
  }
  const useSoon = new Set<string>();
  for (const s of (stock ?? []) as unknown as { ingredient_id: string; purchased_on: string; ingredients: { storage_days: number | null } | { storage_days: number | null }[] | null }[]) {
    const ing = Array.isArray(s.ingredients) ? s.ingredients[0] : s.ingredients;
    const f = freshnessOf(s.purchased_on, ing?.storage_days ?? null, today).status;
    if (f === "USE_SOON" || f === "PAST_ESTIMATE") useSoon.add(s.ingredient_id);
  }
  const main = detail.dishes.find((d) => d.kind === "MAIN")!;
  const current = detail.dishes.find((d) => d.kind === kind)?.recipeId ?? null;
  const candidates: DishCandidate[] = (recipes ?? [])
    .filter((r) => !excluded.has(r.id as string) && r.id !== current)
    .map((r) => ({
      id: r.id as string,
      name: r.name as string,
      dishType: kind,
      ingredientIds: byRecipe.get(r.id as string)?.ids ?? [],
      hasVegetable: byRecipe.get(r.id as string)?.vegetable ?? false,
      lowCalorie: ((r.tags as string[]) ?? []).includes("低カロリー"),
      lastCookedOn: null,
    }));
  const mainIngredients = byRecipe.get(main.recipeId)?.ids ?? [];
  return rankAlternatives(
    { recipeId: main.recipeId, name: main.name, oneDish: false, ingredientIds: mainIngredients, hasVegetable: byRecipe.get(main.recipeId)?.vegetable ?? false },
    candidates,
    new Set(mainIngredients),
    { today, inStockIngredientIds: new Set((stock ?? []).map((s) => s.ingredient_id as string)), useSoonIngredientIds: useSoon },
  ).slice(0, 8);
}

export type HomeMealCard = {
  id: string;
  mainRecipeId: string;
  name: string;
  sideName: string | null;
  soupName: string | null;
  imageUrl: string | null;
  cooked: boolean;
  useSoon: boolean;
};

/** ホームの献立（未調理を「そろそろ使いたい」食材を使う順に前へ、作ったものは後ろ） */
export async function getHomeMeals(supabase: SupabaseClient, planId: string, today: string = tokyoDate()): Promise<HomeMealCard[]> {
  const { data: sets } = await supabase
    .from("meal_sets")
    .select("id, position, main_recipe_id, side_recipe_id, soup_recipe_id, status")
    .eq("weekly_plan_id", planId)
    .order("position");
  if (!sets || sets.length === 0) return [];
  const ids = [...new Set(sets.flatMap((s) => [s.main_recipe_id, s.side_recipe_id, s.soup_recipe_id]).filter(Boolean))] as string[];
  const [{ data: recipes }, { data: lines }, { data: stock }] = await Promise.all([
    supabase.from("recipes").select("id, name, image_path").in("id", ids),
    supabase.from("recipe_ingredients").select("recipe_id, ingredient_id").in("recipe_id", ids).not("ingredient_id", "is", null),
    supabase.from("inventory_items").select("ingredient_id, purchased_on, ingredients(storage_days)").gt("quantity", 0),
  ]);
  const priority = new Map<string, number>();
  for (const s of (stock ?? []) as unknown as { ingredient_id: string; purchased_on: string; ingredients: { storage_days: number | null } | { storage_days: number | null }[] | null }[]) {
    const ing = Array.isArray(s.ingredients) ? s.ingredients[0] : s.ingredients;
    const p = freshnessPriority(freshnessOf(s.purchased_on, ing?.storage_days ?? null, today));
    priority.set(s.ingredient_id, Math.min(priority.get(s.ingredient_id) ?? 9, p));
  }
  const images = await signImagePaths(supabase, (recipes ?? []).map((r) => r.image_path as string | null));
  const nameOf = (id: string | null) => (id ? ((recipes?.find((r) => r.id === id)?.name as string | undefined) ?? null) : null);
  const cards = sets.map((s) => {
    const dishIds = [s.main_recipe_id, s.side_recipe_id, s.soup_recipe_id].filter(Boolean) as string[];
    const best = Math.min(9, ...(lines ?? []).filter((l) => dishIds.includes(l.recipe_id as string)).map((l) => priority.get(l.ingredient_id as string) ?? 9));
    const main = recipes?.find((r) => r.id === s.main_recipe_id);
    return {
      card: {
        id: s.id as string,
        mainRecipeId: s.main_recipe_id as string,
        name: (main?.name as string | undefined) ?? "（削除されたレシピ）",
        sideName: nameOf(s.side_recipe_id as string | null),
        soupName: nameOf(s.soup_recipe_id as string | null),
        imageUrl: main?.image_path ? (images.get(main.image_path as string) ?? null) : null,
        cooked: s.status === "COOKED",
        useSoon: best <= 1,
      },
      order: [s.status === "COOKED" ? 1 : 0, best, s.position as number] as const,
    };
  });
  return cards
    .sort((a, b) => a.order[0] - b.order[0] || a.order[1] - b.order[1] || a.order[2] - b.order[2])
    .map((c) => c.card);
}
