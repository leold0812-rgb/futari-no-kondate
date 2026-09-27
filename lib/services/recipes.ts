import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { DEFAULT_STORAGE_DAYS, guessIngredientCategory, normalizeIngredientName } from "@/lib/ingredients";
import type { Cuisine, DishType, MainCategory, Rating, RecipeSort, RecipeStatus } from "@/lib/recipes/constants";
import { normalizeUnit } from "@/lib/units";
import { deriveRecipeStatus, type RecipeInput } from "@/lib/validation/recipe";

/**
 * レシピのユースケース（Gate 2）。利用者のsessionのSupabase client（RLS適用）だけを受け取る。
 * 複数テーブルの更新は public.save_recipe（1 transaction）で行う。
 */

export const RECIPE_IMAGE_BUCKET = "recipe-images";
const SIGNED_URL_SECONDS = 60 * 60;

export type RecipeSummary = {
  id: string;
  name: string;
  status: RecipeStatus;
  dishType: DishType;
  mainCategory: MainCategory | null;
  cuisine: Cuisine | null;
  cookingMinutes: number | null;
  tags: string[];
  imagePath: string | null;
  imageUrl: string | null;
  createdAt: string;
  myRating: Rating | null;
  partnerRating: Rating | null;
  myFavorite: boolean;
  partnerFavorite: boolean;
};

export type RecipeIngredient = {
  id: string;
  ingredientId: string | null;
  rawName: string;
  quantity: number | null;
  unit: string | null;
  note: string | null;
  isMain: boolean;
};

export type RecipeDetail = RecipeSummary & {
  sourceUrl: string | null;
  servings: number;
  instructions: string[];
  highCost: boolean;
  specialSeasoning: boolean;
  oneDish: boolean;
  memo: string | null;
  nutrition: {
    energyKcal: number | null;
    proteinG: number | null;
    fatG: number | null;
    carbsG: number | null;
    source: "MANUAL" | "CALCULATED" | null;
  };
  ingredients: RecipeIngredient[];
};

export type RecipeFilters = {
  q?: string;
  dishType?: DishType;
  mainCategory?: MainCategory;
  cuisine?: Cuisine;
  tag?: string;
  favoriteOnly?: boolean;
  sort?: RecipeSort;
};

type RecipeRow = {
  id: string;
  name: string;
  status: RecipeStatus;
  dish_type: DishType;
  main_category: MainCategory | null;
  cuisine: Cuisine | null;
  cooking_minutes: number | null;
  tags: string[];
  image_path: string | null;
  created_at: string;
};

const SUMMARY_COLUMNS = "id, name, status, dish_type, main_category, cuisine, cooking_minutes, tags, image_path, created_at";

const RATING_SCORE: Record<Rating, number> = { MAKE_AGAIN: 2, NORMAL: 1, NEVER_AGAIN: -2 };

function toNumber(value: unknown): number | null {
  if (value === null || value === undefined) return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

/** 画像の一時URL（private bucket）。まとめて発行する */
export async function signImagePaths(supabase: SupabaseClient, paths: (string | null)[]): Promise<Map<string, string>> {
  const unique = [...new Set(paths.filter((p): p is string => Boolean(p)))];
  const result = new Map<string, string>();
  if (unique.length === 0) return result;
  const { data } = await supabase.storage.from(RECIPE_IMAGE_BUCKET).createSignedUrls(unique, SIGNED_URL_SECONDS);
  for (const item of data ?? []) {
    if (item.signedUrl && item.path) result.set(item.path, item.signedUrl);
  }
  return result;
}

async function loadPreferences(supabase: SupabaseClient, recipeIds: string[], userId: string) {
  const ratings = new Map<string, { mine: Rating | null; partner: Rating | null }>();
  const favorites = new Map<string, { mine: boolean; partner: boolean }>();
  if (recipeIds.length === 0) return { ratings, favorites };

  const [{ data: ratingRows }, { data: favoriteRows }] = await Promise.all([
    supabase.from("recipe_ratings").select("recipe_id, user_id, rating").in("recipe_id", recipeIds),
    supabase.from("recipe_favorites").select("recipe_id, user_id").in("recipe_id", recipeIds),
  ]);
  for (const row of ratingRows ?? []) {
    const entry = ratings.get(row.recipe_id) ?? { mine: null, partner: null };
    if (row.user_id === userId) entry.mine = row.rating as Rating;
    else entry.partner = row.rating as Rating;
    ratings.set(row.recipe_id, entry);
  }
  for (const row of favoriteRows ?? []) {
    const entry = favorites.get(row.recipe_id) ?? { mine: false, partner: false };
    if (row.user_id === userId) entry.mine = true;
    else entry.partner = true;
    favorites.set(row.recipe_id, entry);
  }
  return { ratings, favorites };
}

function toSummary(
  row: RecipeRow,
  prefs: Awaited<ReturnType<typeof loadPreferences>>,
  images: Map<string, string>,
): RecipeSummary {
  const rating = prefs.ratings.get(row.id);
  const favorite = prefs.favorites.get(row.id);
  return {
    id: row.id,
    name: row.name,
    status: row.status,
    dishType: row.dish_type,
    mainCategory: row.main_category,
    cuisine: row.cuisine,
    cookingMinutes: row.cooking_minutes,
    tags: row.tags ?? [],
    imagePath: row.image_path,
    imageUrl: row.image_path ? (images.get(row.image_path) ?? null) : null,
    createdAt: row.created_at,
    myRating: rating?.mine ?? null,
    partnerRating: rating?.partner ?? null,
    myFavorite: favorite?.mine ?? false,
    partnerFavorite: favorite?.partner ?? false,
  };
}

/** 検索語からLIKEのワイルドカードとPostgRESTのfilter構文で特別な意味を持つ文字を除く */
export function sanitizeSearchTerm(value: string): string {
  return value.replace(/[%_\\,()"*:.]/g, " ").replace(/\s+/g, " ").trim().slice(0, 40);
}

export async function listRecipes(
  supabase: SupabaseClient,
  userId: string,
  filters: RecipeFilters = {},
): Promise<RecipeSummary[]> {
  let query = supabase.from("recipes").select(SUMMARY_COLUMNS).is("deleted_at", null).limit(500);
  if (filters.dishType) query = query.eq("dish_type", filters.dishType);
  if (filters.mainCategory) query = query.eq("main_category", filters.mainCategory);
  if (filters.cuisine) query = query.eq("cuisine", filters.cuisine);
  if (filters.tag) query = query.contains("tags", [filters.tag]);

  const q = sanitizeSearchTerm(filters.q ?? "");
  if (q) {
    // 料理名 または 材料名 に含まれる
    const pattern = `%${q}%`;
    const { data: byIngredient } = await supabase
      .from("recipe_ingredients")
      .select("recipe_id")
      .ilike("raw_name", pattern)
      .limit(500);
    const ids = [...new Set((byIngredient ?? []).map((r) => r.recipe_id as string))];
    query = ids.length > 0 ? query.or(`name.ilike."${pattern}",id.in.(${ids.join(",")})`) : query.ilike("name", pattern);
  }

  const { data, error } = await query;
  if (error) throw new Error(`レシピを読み込めませんでした: ${error.message}`);
  const rows = (data ?? []) as RecipeRow[];

  const [prefs, images] = await Promise.all([
    loadPreferences(
      supabase,
      rows.map((r) => r.id),
      userId,
    ),
    signImagePaths(
      supabase,
      rows.map((r) => r.image_path),
    ),
  ]);
  let recipes = rows.map((row) => toSummary(row, prefs, images));
  if (filters.favoriteOnly) recipes = recipes.filter((r) => r.myFavorite);
  return sortRecipes(recipes, filters.sort ?? "new");
}

export function ratingScore(recipe: Pick<RecipeSummary, "myRating" | "partnerRating">): number {
  return (recipe.myRating ? RATING_SCORE[recipe.myRating] : 0) + (recipe.partnerRating ? RATING_SCORE[recipe.partnerRating] : 0);
}

export function sortRecipes(recipes: RecipeSummary[], sort: RecipeSort): RecipeSummary[] {
  const byNew = (a: RecipeSummary, b: RecipeSummary) => b.createdAt.localeCompare(a.createdAt) || a.id.localeCompare(b.id);
  const sorted = [...recipes];
  switch (sort) {
    case "rating":
      return sorted.sort((a, b) => ratingScore(b) - ratingScore(a) || byNew(a, b));
    case "quick":
      return sorted.sort(
        (a, b) => (a.cookingMinutes ?? Number.MAX_SAFE_INTEGER) - (b.cookingMinutes ?? Number.MAX_SAFE_INTEGER) || byNew(a, b),
      );
    case "name":
      return sorted.sort((a, b) => a.name.localeCompare(b.name, "ja") || byNew(a, b));
    default:
      return sorted.sort(byNew);
  }
}

export async function getRecipeDetail(supabase: SupabaseClient, userId: string, recipeId: string): Promise<RecipeDetail | null> {
  const { data: row, error } = await supabase
    .from("recipes")
    .select(
      `${SUMMARY_COLUMNS}, source_url, servings, instructions, high_cost, special_seasoning, one_dish, memo, energy_kcal, protein_g, fat_g, carbs_g, nutrition_source`,
    )
    .eq("id", recipeId)
    .is("deleted_at", null)
    .maybeSingle();
  if (error) throw new Error(`レシピを読み込めませんでした: ${error.message}`);
  if (!row) return null;

  const [{ data: ingredientRows }, prefs, images] = await Promise.all([
    supabase
      .from("recipe_ingredients")
      .select("id, ingredient_id, raw_name, quantity, unit, note, is_main")
      .eq("recipe_id", recipeId)
      .order("sort_order"),
    loadPreferences(supabase, [recipeId], userId),
    signImagePaths(supabase, [row.image_path as string | null]),
  ]);

  return {
    ...toSummary(row as RecipeRow, prefs, images),
    sourceUrl: row.source_url as string | null,
    servings: row.servings as number,
    instructions: Array.isArray(row.instructions) ? (row.instructions as unknown[]).map(String) : [],
    highCost: Boolean(row.high_cost),
    specialSeasoning: Boolean(row.special_seasoning),
    oneDish: Boolean(row.one_dish),
    memo: row.memo as string | null,
    nutrition: {
      energyKcal: toNumber(row.energy_kcal),
      proteinG: toNumber(row.protein_g),
      fatG: toNumber(row.fat_g),
      carbsG: toNumber(row.carbs_g),
      source: (row.nutrition_source as "MANUAL" | "CALCULATED" | null) ?? null,
    },
    ingredients: (ingredientRows ?? []).map((r) => ({
      id: r.id as string,
      ingredientId: r.ingredient_id as string | null,
      rawName: r.raw_name as string,
      quantity: toNumber(r.quantity),
      unit: r.unit as string | null,
      note: r.note as string | null,
      isMain: Boolean(r.is_main),
    })),
  };
}

/** save_recipe RPCへ渡す形へ。材料名は正規化して材料マスタへ対応付ける（カテゴリ・保存目安は新規作成時の初期値） */
export function toSavePayload(input: RecipeInput, extra: { imagePath?: string | null; status?: RecipeStatus } = {}) {
  const recipe: Record<string, unknown> = {
    name: input.name,
    status: extra.status ?? deriveRecipeStatus(input),
    source_url: input.sourceUrl,
    dish_type: input.dishType,
    main_category: input.mainCategory,
    cuisine: input.cuisine,
    servings: input.servings,
    cooking_minutes: input.cookingMinutes,
    instructions: input.instructions,
    high_cost: input.highCost,
    special_seasoning: input.specialSeasoning,
    one_dish: input.oneDish,
    tags: [...new Set(input.tags)],
    memo: input.memo,
    energy_kcal: input.nutrition.energyKcal,
    protein_g: input.nutrition.proteinG,
    fat_g: input.nutrition.fatG,
    carbs_g: input.nutrition.carbsG,
    nutrition_source: Object.values(input.nutrition).some((v) => v !== null) ? "MANUAL" : null,
  };
  // 画像を変えない更新では image_path を送らない（save_recipeは既存値を保つ）
  if (extra.imagePath !== undefined) recipe.image_path = extra.imagePath;

  const ingredients = input.ingredients.map((line) => {
    const ingredientName = normalizeIngredientName(line.rawName);
    const category = ingredientName ? guessIngredientCategory(ingredientName) : "OTHER";
    return {
      raw_name: line.rawName,
      quantity: line.quantity,
      unit: normalizeUnit(line.unit) ?? line.unit,
      note: line.note,
      is_main: line.isMain,
      ingredient_name: ingredientName,
      category,
      storage_days: DEFAULT_STORAGE_DAYS[category],
    };
  });
  return { recipe, ingredients };
}

export async function saveRecipe(
  supabase: SupabaseClient,
  recipeId: string | null,
  input: RecipeInput,
  extra: { imagePath?: string | null; status?: RecipeStatus } = {},
): Promise<string> {
  const payload = toSavePayload(input, extra);
  const { data, error } = await supabase.rpc("save_recipe", {
    p_recipe_id: recipeId,
    p_recipe: payload.recipe,
    p_ingredients: payload.ingredients,
  });
  if (error || !data) throw new Error(`レシピを保存できませんでした: ${error?.message ?? "不明なエラー"}`);
  return data as string;
}

export async function softDeleteRecipe(supabase: SupabaseClient, recipeId: string): Promise<void> {
  const { error } = await supabase
    .from("recipes")
    .update({ deleted_at: new Date().toISOString() })
    .eq("id", recipeId)
    .is("deleted_at", null);
  if (error) throw new Error(`レシピを削除できませんでした: ${error.message}`);
}

export async function setRating(supabase: SupabaseClient, userId: string, recipeId: string, rating: Rating | null) {
  if (rating === null) {
    const { error } = await supabase.from("recipe_ratings").delete().eq("recipe_id", recipeId).eq("user_id", userId);
    if (error) throw new Error(`評価を取り消せませんでした: ${error.message}`);
    return;
  }
  const { error } = await supabase
    .from("recipe_ratings")
    .upsert({ recipe_id: recipeId, user_id: userId, rating }, { onConflict: "recipe_id,user_id" });
  if (error) throw new Error(`評価を保存できませんでした: ${error.message}`);
}

export async function setFavorite(supabase: SupabaseClient, userId: string, recipeId: string, favorite: boolean) {
  if (favorite) {
    const { error } = await supabase
      .from("recipe_favorites")
      .upsert({ recipe_id: recipeId, user_id: userId }, { onConflict: "recipe_id,user_id", ignoreDuplicates: true });
    if (error) throw new Error(`お気に入りに追加できませんでした: ${error.message}`);
    return;
  }
  const { error } = await supabase.from("recipe_favorites").delete().eq("recipe_id", recipeId).eq("user_id", userId);
  if (error) throw new Error(`お気に入りを外せませんでした: ${error.message}`);
}
