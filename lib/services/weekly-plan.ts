import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Rating } from "@/lib/recipes/constants";
import { recommendWeekly, type RecommendationRecipe, type ScoreItem } from "@/lib/recommendation/weekly";
import { signImagePaths } from "./recipes";

/** 週間計画のユースケース（Gate 5）。利用者のsession（RLS）で呼ぶ。書き込みはDB関数（1 transaction）だけ */

export const MAIN_DISHES_PER_WEEK = 5;

/** 相手の操作と競合した（確定済み・候補の出し直し・版の違い） */
export class PlanConflictError extends Error {}

export type PlanStatus = "DRAFT" | "CONFIRMED" | "COMPLETED";
export type Decision = "PENDING" | "ACCEPTED" | "SKIPPED";

export type CandidateView = {
  id: string;
  recipeId: string;
  name: string;
  imageUrl: string | null;
  cookingMinutes: number | null;
  tags: string[];
  position: number;
  score: number;
  breakdown: ScoreItem[];
  notes: string[];
  manual: boolean;
  decision: Decision;
  decidedAt: string | null;
};

export type MealSetView = {
  id: string;
  position: number;
  mainRecipeId: string;
  sideRecipeId: string | null;
  soupRecipeId: string | null;
  servings: number;
  status: "PLANNED" | "COOKED";
  cookedAt: string | null;
  version: number;
};

export type WeeklyPlanView = {
  id: string;
  weekStart: string;
  status: PlanStatus;
  version: number;
  runId: string | null;
  runNotes: string[];
  candidates: CandidateView[];
  mealSets: MealSetView[];
};

export async function ensureWeeklyPlan(supabase: SupabaseClient, weekStart: string): Promise<string> {
  const { data, error } = await supabase.rpc("ensure_weekly_plan", { p_week_start: weekStart });
  if (error || !data) throw new Error(`週の計画を用意できませんでした: ${error?.message ?? "不明なエラー"}`);
  return data as string;
}

export async function findWeeklyPlan(supabase: SupabaseClient, weekStart: string): Promise<{ id: string; status: PlanStatus } | null> {
  const { data } = await supabase.from("weekly_plans").select("id, status").eq("week_start", weekStart).maybeSingle();
  return data ? { id: data.id as string, status: data.status as PlanStatus } : null;
}

export async function getWeeklyPlan(supabase: SupabaseClient, planId: string): Promise<WeeklyPlanView | null> {
  const { data: plan } = await supabase.from("weekly_plans").select("id, week_start, status, version").eq("id", planId).maybeSingle();
  if (!plan) return null;

  const [{ data: run }, { data: sets }] = await Promise.all([
    supabase
      .from("recommendation_runs")
      .select("id, notes")
      .eq("weekly_plan_id", planId)
      .order("seq", { ascending: false })
      .limit(1)
      .maybeSingle(),
    supabase
      .from("meal_sets")
      .select("id, position, main_recipe_id, side_recipe_id, soup_recipe_id, servings, status, cooked_at, version")
      .eq("weekly_plan_id", planId)
      .order("position"),
  ]);

  let candidates: CandidateView[] = [];
  if (run) {
    const { data: rows } = await supabase
      .from("recommendation_candidates")
      .select("id, recipe_id, position, score, score_breakdown, notes, manual, decision, decided_at, recipes(name, image_path, cooking_minutes, tags)")
      .eq("run_id", run.id)
      .order("position");
    const recipeOf = (row: Record<string, unknown>) =>
      (Array.isArray(row.recipes) ? row.recipes[0] : row.recipes) as
        | { name: string; image_path: string | null; cooking_minutes: number | null; tags: string[] }
        | null;
    const images = await signImagePaths(
      supabase,
      (rows ?? []).map((row) => recipeOf(row)?.image_path ?? null),
    );
    candidates = (rows ?? []).map((row) => {
      const recipe = recipeOf(row);
      return {
        id: row.id as string,
        recipeId: row.recipe_id as string,
        name: recipe?.name ?? "（削除されたレシピ）",
        imageUrl: recipe?.image_path ? (images.get(recipe.image_path) ?? null) : null,
        cookingMinutes: recipe?.cooking_minutes ?? null,
        tags: recipe?.tags ?? [],
        position: row.position as number,
        score: Number(row.score),
        breakdown: (row.score_breakdown as ScoreItem[]) ?? [],
        notes: (row.notes as string[]) ?? [],
        manual: Boolean(row.manual),
        decision: row.decision as Decision,
        decidedAt: row.decided_at as string | null,
      };
    });
  }

  return {
    id: plan.id as string,
    weekStart: plan.week_start as string,
    status: plan.status as PlanStatus,
    version: plan.version as number,
    runId: (run?.id as string | undefined) ?? null,
    runNotes: (run?.notes as string[] | undefined) ?? [],
    candidates,
    mealSets: (sets ?? []).map((s) => ({
      id: s.id as string,
      position: s.position as number,
      mainRecipeId: s.main_recipe_id as string,
      sideRecipeId: s.side_recipe_id as string | null,
      soupRecipeId: s.soup_recipe_id as string | null,
      servings: s.servings as number,
      status: s.status as "PLANNED" | "COOKED",
      cookedAt: s.cooked_at as string | null,
      version: s.version as number,
    })),
  };
}

/** 推薦の入力をDBから集める（全レシピ・2人の評価・お気に入り・調理履歴・主な材料・在庫） */
export async function loadRecommendationInput(supabase: SupabaseClient) {
  const [recipesRes, ratingsRes, favoritesRes, historiesRes, ingredientsRes, inventoryRes] = await Promise.all([
    supabase
      .from("recipes")
      .select("id, name, dish_type, status, main_category, created_at, tags, high_cost, special_seasoning")
      .is("deleted_at", null)
      .limit(2000),
    supabase.from("recipe_ratings").select("recipe_id, rating").limit(5000),
    supabase.from("recipe_favorites").select("recipe_id").limit(5000),
    supabase.from("recipe_histories").select("recipe_id, cooked_on").limit(10000),
    supabase.from("recipe_ingredients").select("recipe_id, ingredient_id, is_main").not("ingredient_id", "is", null).limit(20000),
    supabase.from("inventory_items").select("ingredient_id").gt("quantity", 0).limit(5000),
  ]);
  for (const res of [recipesRes, ratingsRes, favoritesRes, historiesRes, ingredientsRes, inventoryRes]) {
    if (res.error) throw new Error(`推薦の材料を読み込めませんでした: ${res.error.message}`);
  }

  const ratings = new Map<string, Rating[]>();
  for (const r of ratingsRes.data ?? []) ratings.set(r.recipe_id, [...(ratings.get(r.recipe_id) ?? []), r.rating as Rating]);
  const favorites = new Map<string, number>();
  for (const f of favoritesRes.data ?? []) favorites.set(f.recipe_id, (favorites.get(f.recipe_id) ?? 0) + 1);
  const cooked = new Map<string, { last: string; count: number }>();
  for (const h of historiesRes.data ?? []) {
    const entry = cooked.get(h.recipe_id) ?? { last: "", count: 0 };
    cooked.set(h.recipe_id, { last: h.cooked_on > entry.last ? h.cooked_on : entry.last, count: entry.count + 1 });
  }
  const mainIngredients = new Map<string, string[]>();
  const allIngredients = new Map<string, string[]>();
  for (const row of ingredientsRes.data ?? []) {
    const target = row.is_main ? mainIngredients : allIngredients;
    target.set(row.recipe_id, [...(target.get(row.recipe_id) ?? []), row.ingredient_id as string]);
  }

  const recipes: RecommendationRecipe[] = (recipesRes.data ?? []).map((r) => ({
    id: r.id,
    name: r.name,
    dishType: r.dish_type,
    status: r.status,
    mainCategory: r.main_category,
    createdAt: r.created_at,
    tags: r.tags ?? [],
    highCost: r.high_cost,
    specialSeasoning: r.special_seasoning,
    ratings: ratings.get(r.id) ?? [],
    favoriteCount: favorites.get(r.id) ?? 0,
    lastCookedOn: cooked.get(r.id)?.last ?? null,
    cookCount: cooked.get(r.id)?.count ?? 0,
    // 主な材料の指定が無いレシピは全材料で在庫の賄い具合を見る
    mainIngredientIds: [...new Set(mainIngredients.get(r.id) ?? allIngredients.get(r.id) ?? [])],
  }));
  const inStock = new Set((inventoryRes.data ?? []).map((i) => i.ingredient_id as string));
  return { recipes, inStock };
}

/** 10候補を計算して保存する（DRAFTの計画だけ） */
export async function generateCandidates(supabase: SupabaseClient, planId: string, today: string): Promise<string> {
  const { recipes, inStock } = await loadRecommendationInput(supabase);
  const result = recommendWeekly(recipes, { today, inStockIngredientIds: inStock });
  const { data, error } = await supabase.rpc("save_recommendation_run", {
    p_plan_id: planId,
    p_algorithm_version: result.algorithmVersion,
    p_input_snapshot: {
      today,
      recipeCount: recipes.length,
      eligibleMainCount: recipes.filter((r) => r.dishType === "MAIN" && r.status === "READY").length,
      inStockIngredientCount: inStock.size,
    },
    p_notes: result.notes,
    p_candidates: result.candidates.map((c) => ({
      recipe_id: c.recipeId,
      score: c.score,
      breakdown: c.breakdown,
      notes: c.notes,
      manual: false,
    })),
  });
  if (error || !data) throw new Error(`候補を保存できませんでした: ${error?.message ?? "不明なエラー"}`);
  return data as string;
}

/** 判断を保存する（DB関数が計画をロックし、DRAFT・最新の候補であることを確かめて版を進める） */
export async function decideCandidate(
  supabase: SupabaseClient,
  candidateId: string,
  decision: Decision,
  expectedVersion: number,
): Promise<number> {
  const { data, error } = await supabase.rpc("decide_candidate", {
    p_candidate_id: candidateId,
    p_decision: decision,
    p_expected_version: expectedVersion,
  });
  if (error?.code === "55000" || error?.code === "40001") {
    throw new PlanConflictError("相手が先に候補を選んだか、献立が決まりました。画面を開き直してください。");
  }
  if (error) throw new Error(`判断を保存できませんでした: ${error.message}`);
  return data as number;
}

export async function addManualCandidate(supabase: SupabaseClient, runId: string, recipeId: string): Promise<void> {
  const { error } = await supabase.rpc("add_manual_candidate", { p_run_id: runId, p_recipe_id: recipeId });
  if (error) throw new Error(`候補に追加できませんでした: ${error.message}`);
}

/** 最新の候補で「作る」を選んだ5品で確定する（DB側で5品ちょうど・採用済みの候補だけを使う） */
export async function confirmWeeklyPlan(supabase: SupabaseClient, planId: string, expectedVersion: number): Promise<number> {
  const { data, error } = await supabase.rpc("confirm_weekly_plan", { p_plan_id: planId, p_expected_version: expectedVersion });
  if (error?.code === "40001") {
    throw new PlanConflictError("相手が同時に候補を選び直しました。画面を開き直して、5品を確認してから決めてください。");
  }
  if (error?.code === "22023") {
    throw new PlanConflictError(`主菜はちょうど${MAIN_DISHES_PER_WEEK}品にしてください。まだ確定していません。`);
  }
  if (error) throw new Error(`献立を確定できませんでした: ${error.message}`);
  return data as number;
}
