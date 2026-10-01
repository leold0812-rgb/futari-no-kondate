import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { tokyoDate } from "@/lib/dates";
import { INGREDIENT_CATEGORIES, type IngredientCategory } from "@/lib/ingredients";
import { freshnessOf } from "@/lib/inventory/status";
import { chooseSidesAndSoups, type DishCandidate, type MainDish } from "@/lib/recommendation/sides";
import { aggregateShopping, type ShoppingDish } from "@/lib/shopping/aggregate";
import { suggestInsurance, type InsuranceSuggestion } from "@/lib/shopping/insurance";
import { unitGroup } from "@/lib/units";

/** 買い物のユースケース（Gate 6）。利用者のsession（RLS）で呼ぶ。書き込みはDB関数だけ */

export type ShoppingItemView = {
  id: string;
  ingredientId: string | null;
  name: string;
  category: IngredientCategory;
  required: number | null;
  inStock: number | null;
  toBuy: number | null;
  unit: string | null;
  group: string;
  source: "PLAN" | "INSURANCE" | "MANUAL";
  recipeNames: string[];
  homeChecked: boolean;
  purchased: boolean;
};

export type ShoppingListView = {
  id: string;
  planId: string | null;
  status: "DRAFT" | "CONFIRMED";
  items: ShoppingItemView[];
  categoryOrder: IngredientCategory[];
};

type RecipeRow = {
  id: string;
  name: string;
  dish_type: "MAIN" | "SIDE" | "SOUP";
  status: string;
  servings: number;
  one_dish: boolean;
  tags: string[];
};

type LineRow = {
  recipe_id: string;
  ingredient_id: string | null;
  raw_name: string;
  quantity: number | null;
  unit: string | null;
  ingredients: { name: string; category: IngredientCategory; storage_days: number | null } | null;
};

async function loadRecipes(supabase: SupabaseClient, ids: string[]) {
  const unique = [...new Set(ids)];
  if (unique.length === 0) return { recipes: new Map<string, RecipeRow>(), lines: new Map<string, LineRow[]>() };
  const [{ data: recipes, error: recipeError }, { data: lines, error: lineError }] = await Promise.all([
    supabase.from("recipes").select("id, name, dish_type, status, servings, one_dish, tags").in("id", unique),
    supabase
      .from("recipe_ingredients")
      .select("recipe_id, ingredient_id, raw_name, quantity, unit, ingredients(name, category, storage_days)")
      .in("recipe_id", unique)
      .order("sort_order"),
  ]);
  if (recipeError || lineError) throw new Error(`レシピを読み込めませんでした: ${(recipeError ?? lineError)!.message}`);
  const byRecipe = new Map<string, LineRow[]>();
  for (const row of (lines ?? []) as unknown as LineRow[]) {
    const ingredient = Array.isArray(row.ingredients) ? row.ingredients[0] : row.ingredients;
    byRecipe.set(row.recipe_id, [...(byRecipe.get(row.recipe_id) ?? []), { ...row, ingredients: ingredient ?? null }]);
  }
  return { recipes: new Map(((recipes ?? []) as RecipeRow[]).map((r) => [r.id, r])), lines: byRecipe };
}

/** 在庫（材料IDごと）と「そろそろ使いたい」の材料ID */
async function loadStock(supabase: SupabaseClient, today: string) {
  const { data, error } = await supabase
    .from("inventory_items")
    .select("ingredient_id, quantity, unit, purchased_on, ingredients(storage_days)")
    .gt("quantity", 0)
    .limit(5000);
  // 在庫を読めないまま作ると、在庫を差し引かない（買いすぎる）リストになるため止める
  if (error) throw new Error(`在庫を読み込めませんでした: ${error.message}`);
  const rows = (data ?? []) as unknown as {
    ingredient_id: string;
    quantity: number;
    unit: string | null;
    purchased_on: string;
    ingredients: { storage_days: number | null } | { storage_days: number | null }[] | null;
  }[];
  const useSoon = new Set<string>();
  for (const row of rows) {
    const ingredient = Array.isArray(row.ingredients) ? row.ingredients[0] : row.ingredients;
    const status = freshnessOf(row.purchased_on, ingredient?.storage_days ?? null, today).status;
    if (status === "USE_SOON" || status === "PAST_ESTIMATE") useSoon.add(row.ingredient_id);
  }
  return {
    stock: rows.map((r) => ({ ingredientId: r.ingredient_id, quantity: Number(r.quantity), unit: r.unit })),
    inStock: new Set(rows.map((r) => r.ingredient_id)),
    useSoon,
  };
}

const hasVegetable = (lines: LineRow[] | undefined) => (lines ?? []).some((l) => l.ingredients?.category === "VEGETABLE");

/**
 * 確定した計画に副菜・汁物を設定し（未設定の献立だけ）、全献立の材料を合算して買い物リストの下書きを作る。
 * 下書き（DRAFT）なら何度呼んでも最新の在庫で作り直す。確定済みのリストは変えない。
 */
export async function prepareShoppingForPlan(supabase: SupabaseClient, planId: string, today: string = tokyoDate()) {
  const { data: sets, error } = await supabase
    .from("meal_sets")
    .select("id, main_recipe_id, side_recipe_id, soup_recipe_id, servings, status")
    .eq("weekly_plan_id", planId)
    .order("position");
  if (error) throw new Error(`献立を読み込めませんでした: ${error.message}`);
  const mealSets = sets ?? [];
  const { stock, inStock, useSoon } = await loadStock(supabase, today);

  // 1. 副菜・汁物（まだ一度も設定していない計画だけ自動で選ぶ）
  const needsSides = mealSets.length > 0 && mealSets.every((s) => !s.side_recipe_id && !s.soup_recipe_id);
  if (needsSides) {
    const { data: candidates, error: candidateError } = await supabase
      .from("recipes")
      .select("id, name, dish_type, tags")
      .in("dish_type", ["SIDE", "SOUP"])
      .eq("status", "READY")
      .is("deleted_at", null)
      .limit(1000);
    const { data: never, error: neverError } = await supabase.from("recipe_ratings").select("recipe_id").eq("rating", "NEVER_AGAIN");
    if (candidateError || neverError) throw new Error(`副菜・汁物の候補を読み込めませんでした: ${(candidateError ?? neverError)!.message}`);
    const excluded = new Set((never ?? []).map((r) => r.recipe_id as string));
    const dishIds = (candidates ?? []).filter((c) => !excluded.has(c.id)).map((c) => c.id as string);
    const mainIds = mealSets.map((s) => s.main_recipe_id as string);
    const { recipes, lines } = await loadRecipes(supabase, [...mainIds, ...dishIds]);
    const { data: histories, error: historyError } = await supabase
      .from("recipe_histories")
      .select("recipe_id, cooked_on")
      .in("recipe_id", dishIds.length ? dishIds : ["00000000-0000-0000-0000-000000000000"]);
    if (historyError) throw new Error(`調理履歴を読み込めませんでした: ${historyError.message}`);
    const lastCooked = new Map<string, string>();
    for (const h of histories ?? []) {
      if ((lastCooked.get(h.recipe_id) ?? "") < h.cooked_on) lastCooked.set(h.recipe_id, h.cooked_on);
    }
    const dishes: DishCandidate[] = dishIds.map((id) => {
      const recipe = recipes.get(id)!;
      return {
        id,
        name: recipe.name,
        dishType: recipe.dish_type as "SIDE" | "SOUP",
        ingredientIds: (lines.get(id) ?? []).map((l) => l.ingredient_id).filter((x): x is string => Boolean(x)),
        hasVegetable: hasVegetable(lines.get(id)) || recipe.tags.includes("野菜たっぷり"),
        lowCalorie: recipe.tags.includes("低カロリー"),
        lastCookedOn: lastCooked.get(id) ?? null,
      };
    });
    const mains: MainDish[] = mainIds.map((id) => {
      const recipe = recipes.get(id);
      return {
        recipeId: id,
        name: recipe?.name ?? "",
        oneDish: recipe?.one_dish ?? false,
        ingredientIds: (lines.get(id) ?? []).map((l) => l.ingredient_id).filter((x): x is string => Boolean(x)),
        hasVegetable: hasVegetable(lines.get(id)),
      };
    });
    const choices = chooseSidesAndSoups(mains, dishes, { today, inStockIngredientIds: inStock, useSoonIngredientIds: useSoon });
    const { error: sidesError } = await supabase.rpc("set_meal_set_sides", {
      p_plan_id: planId,
      p_sets: mealSets.map((set, i) => ({
        meal_set_id: set.id,
        side_recipe_id: choices[i]?.side?.recipeId ?? null,
        soup_recipe_id: choices[i]?.soup?.recipeId ?? null,
      })),
    });
    if (sidesError) throw new Error(`副菜・汁物を設定できませんでした: ${sidesError.message}`);
  }

  // 2. 材料の合算（最新の献立セットを読み直す）
  const { data: latest, error: latestError } = await supabase
    .from("meal_sets")
    .select("main_recipe_id, side_recipe_id, soup_recipe_id, servings, status")
    .eq("weekly_plan_id", planId)
    .eq("status", "PLANNED");
  if (latestError) throw new Error(`献立を読み込めませんでした: ${latestError.message}`);
  const dishRefs = (latest ?? []).flatMap((s) =>
    [s.main_recipe_id, s.side_recipe_id, s.soup_recipe_id]
      .filter((id): id is string => Boolean(id))
      .map((recipeId) => ({ recipeId, servings: s.servings as number })),
  );
  const { recipes, lines } = await loadRecipes(
    supabase,
    dishRefs.map((d) => d.recipeId),
  );
  const shoppingDishes: ShoppingDish[] = dishRefs.map((ref) => {
    const recipe = recipes.get(ref.recipeId);
    return {
      recipeName: recipe?.name ?? "",
      factor: ref.servings / Math.max(1, recipe?.servings ?? 2),
      lines: (lines.get(ref.recipeId) ?? []).map((l) => ({
        ingredientId: l.ingredient_id,
        name: l.ingredients?.name ?? l.raw_name,
        category: l.ingredients?.category ?? "OTHER",
        quantity: l.quantity === null ? null : Number(l.quantity),
        unit: l.unit,
      })),
    };
  });
  const items = aggregateShopping(shoppingDishes, stock);

  const { data: listId, error: listError } = await supabase.rpc("prepare_shopping_list", {
    p_plan_id: planId,
    p_items: items.map((item) => ({
      ingredient_id: item.ingredientId,
      name: item.name,
      category: item.category,
      required_quantity: item.required,
      inventory_quantity: item.uncounted ? null : item.inStock,
      buy_quantity: item.toBuy,
      unit: item.unit,
      recipe_names: item.recipes,
    })),
  });
  if (listError || !listId) throw new Error(`買い物リストを作れませんでした: ${listError?.message ?? "不明なエラー"}`);
  return listId as string;
}

const SHOPPING_ITEM_COLUMNS =
  "id, ingredient_id, name, category, required_quantity, inventory_quantity, buy_quantity, unit, source, recipe_names, home_checked, purchased_at, position";

type ShoppingItemRow = Record<string, unknown>;

function toShoppingListView(
  list: { id: unknown; weekly_plan_id: unknown; status: unknown },
  items: ShoppingItemRow[],
  categoryOrder: IngredientCategory[],
): ShoppingListView {
  const num = (v: unknown) => (v === null || v === undefined ? null : Number(v));
  return {
    id: list.id as string,
    planId: list.weekly_plan_id as string | null,
    status: list.status as "DRAFT" | "CONFIRMED",
    categoryOrder,
    items: [...items]
      .sort((a, b) => Number(a.position) - Number(b.position))
      .map((i) => ({
        id: i.id as string,
        ingredientId: i.ingredient_id as string | null,
        name: i.name as string,
        category: i.category as IngredientCategory,
        required: num(i.required_quantity),
        inStock: num(i.inventory_quantity),
        toBuy: num(i.buy_quantity),
        unit: i.unit as string | null,
        group: i.buy_quantity === null && i.required_quantity === null ? "none" : unitGroup(i.unit as string | null),
        source: i.source as ShoppingItemView["source"],
        recipeNames: (i.recipe_names as string[]) ?? [],
        homeChecked: Boolean(i.home_checked),
        purchased: Boolean(i.purchased_at),
      })),
  };
}

/**
 * 複数の週の計画の買い物リストを、項目・カテゴリ順ごと1往復で読む（計画ID → リスト。無い計画は入らない）。
 * 読み込みに失敗した場合は例外（「無い」と区別し、空として表示・確定させない）
 */
export async function getShoppingListsForPlans(supabase: SupabaseClient, planIds: string[]): Promise<Map<string, ShoppingListView>> {
  const result = new Map<string, ShoppingListView>();
  if (planIds.length === 0) return result;
  const [{ data: lists, error: listError }, { data: orders, error: ordersError }] = await Promise.all([
    supabase
      .from("shopping_lists")
      .select(`id, weekly_plan_id, status, shopping_items(${SHOPPING_ITEM_COLUMNS})`)
      .in("weekly_plan_id", planIds),
    supabase.from("shopping_category_orders").select("category, position").order("position"),
  ]);
  if (listError || ordersError) {
    throw new Error(`買い物リストを読み込めませんでした: ${(listError ?? ordersError)!.message}`);
  }
  const ordered = (orders ?? []).map((o) => o.category as IngredientCategory);
  const categoryOrder = [...ordered, ...INGREDIENT_CATEGORIES.filter((c) => !ordered.includes(c))];
  for (const list of lists ?? []) {
    const items = (list.shopping_items as ShoppingItemRow[] | null) ?? [];
    result.set(list.weekly_plan_id as string, toShoppingListView(list, items, categoryOrder));
  }
  return result;
}

/** 週の計画の買い物リスト。まだ無ければnull。読み込みに失敗した場合は例外（「無い」と区別する） */
export async function getShoppingListForPlan(supabase: SupabaseClient, planId: string): Promise<ShoppingListView | null> {
  return (await getShoppingListsForPlans(supabase, [planId])).get(planId) ?? null;
}

/** 保険食材の候補（在庫・リストにある材料を除く） */
export async function insuranceSuggestionsFor(supabase: SupabaseClient, list: ShoppingListView): Promise<InsuranceSuggestion[]> {
  const [{ data: ingredients }, { data: uses }, { data: stock }] = await Promise.all([
    supabase.from("ingredients").select("id, name, category, storage_days, default_unit").limit(2000),
    supabase.from("recipe_ingredients").select("recipe_id, ingredient_id, recipes!inner(status, deleted_at)").not("ingredient_id", "is", null).limit(20000),
    supabase.from("inventory_items").select("ingredient_id").gt("quantity", 0),
  ]);
  const recipeCount = new Map<string, Set<string>>();
  for (const u of (uses ?? []) as unknown as { recipe_id: string; ingredient_id: string; recipes: { status: string; deleted_at: string | null } | { status: string; deleted_at: string | null }[] }[]) {
    const recipe = Array.isArray(u.recipes) ? u.recipes[0] : u.recipes;
    if (!recipe || recipe.status !== "READY" || recipe.deleted_at) continue;
    recipeCount.set(u.ingredient_id, (recipeCount.get(u.ingredient_id) ?? new Set()).add(u.recipe_id));
  }
  const excluded = new Set<string>([
    ...(stock ?? []).map((s) => s.ingredient_id as string),
    ...list.items.map((i) => i.ingredientId).filter((x): x is string => Boolean(x)),
  ]);
  return suggestInsurance(
    (ingredients ?? []).map((i) => ({
      id: i.id as string,
      name: i.name as string,
      category: i.category as IngredientCategory,
      storageDays: i.storage_days as number | null,
      defaultUnit: i.default_unit as string | null,
      recipeCount: recipeCount.get(i.id as string)?.size ?? 0,
    })),
    excluded,
  );
}

export async function rpcOrThrow(supabase: SupabaseClient, fn: string, args: Record<string, unknown>, message: string) {
  const { error } = await supabase.rpc(fn, args);
  if (error) throw new Error(`${message}: ${error.message}`);
}
