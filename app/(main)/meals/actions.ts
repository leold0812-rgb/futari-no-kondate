"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireMember } from "@/lib/auth/session";
import { getMealSetDetail } from "@/lib/services/meals";
import { createSupabaseServerClient } from "@/lib/supabase/server";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const KEY_PATTERN = /^[A-Za-z0-9-]{8,80}$/;

export type CompleteResult = {
  error?: string;
  already?: boolean;
  unconsumed?: { name: string; quantity: number; unit: string | null }[];
  firstTimeRecipes?: { id: string; name: string }[];
};

type RpcResult = { already: boolean; unconsumed: { name: string; quantity: number; unit: string | null }[]; first_time_recipe_ids: string[] };

async function firstTimeNames(recipeIds: string[]) {
  if (recipeIds.length === 0) return [];
  const { data } = await (await createSupabaseServerClient()).from("recipes").select("id, name").in("id", recipeIds);
  return (data ?? []).map((r) => ({ id: r.id as string, name: r.name as string }));
}

/** 作った（献立セット）。同じ画面からの再送はidempotency keyで1回だけ処理される */
export async function completeMealSetAction(mealSetId: string, idempotencyKey: string): Promise<CompleteResult> {
  const member = await requireMember();
  if (!UUID_PATTERN.test(mealSetId) || !KEY_PATTERN.test(idempotencyKey)) return { error: "記録できませんでした。" };
  const supabase = await createSupabaseServerClient();
  const detail = await getMealSetDetail(supabase, member, mealSetId);
  if (!detail) return { error: "献立が見つかりません。" };
  const nutrition = Object.fromEntries(detail.people.map((p) => [p.userId, p.nutrition]));
  const { data, error } = await supabase.rpc("complete_meal_set", {
    p_meal_set_id: mealSetId,
    p_idempotency_key: idempotencyKey,
    p_nutrition: nutrition,
  });
  if (error || !data) return { error: "記録できませんでした（在庫・履歴は変わっていません）。通信状態を確認して、もう一度押してください。" };
  const result = data as RpcResult;
  revalidatePath("/");
  revalidatePath("/inventory");
  revalidatePath("/records");
  return { already: result.already, unconsumed: result.unconsumed, firstTimeRecipes: await firstTimeNames(result.first_time_recipe_ids) };
}

export async function completeFreeMealAction(recipeId: string, idempotencyKey: string): Promise<CompleteResult> {
  const member = await requireMember();
  if (!UUID_PATTERN.test(recipeId) || !KEY_PATTERN.test(idempotencyKey)) return { error: "記録できませんでした。" };
  const supabase = await createSupabaseServerClient();
  const { data: recipe } = await supabase.from("recipes").select("name, energy_kcal, protein_g, fat_g, carbs_g").eq("id", recipeId).maybeSingle();
  if (!recipe) return { error: "レシピが見つかりません。" };
  const { getRicePortions, getRiceNutrition } = await import("@/lib/services/meals");
  const { personNutrition } = await import("@/lib/nutrition/meal");
  const { getPartner } = await import("@/lib/services/members");
  const [portions, rice, partner] = await Promise.all([getRicePortions(supabase), getRiceNutrition(supabase), getPartner(supabase, member)]);
  const dish = { name: recipe.name as string, nutrition: { energyKcal: recipe.energy_kcal === null ? null : Number(recipe.energy_kcal), proteinG: recipe.protein_g === null ? null : Number(recipe.protein_g), fatG: recipe.fat_g === null ? null : Number(recipe.fat_g), carbsG: recipe.carbs_g === null ? null : Number(recipe.carbs_g) } };
  const nutrition = Object.fromEntries(
    [member.userId, ...(partner ? [partner.userId] : [])].map((id) => [id, personNutrition([dish], portions.get(id) ?? 0, rice)]),
  );
  const { data, error } = await supabase.rpc("complete_free_meal", {
    p_recipe_id: recipeId,
    p_servings: 2,
    p_idempotency_key: idempotencyKey,
    p_nutrition: nutrition,
  });
  if (error || !data) return { error: "記録できませんでした（在庫・履歴は変わっていません）。通信状態を確認して、もう一度押してください。" };
  const result = data as RpcResult;
  revalidatePath("/");
  revalidatePath("/inventory");
  revalidatePath("/records");
  return { already: result.already, unconsumed: result.unconsumed, firstTimeRecipes: await firstTimeNames(result.first_time_recipe_ids) };
}

export async function swapDishAction(mealSetId: string, kind: "SIDE" | "SOUP", recipeId: string | null, expectedVersion: number): Promise<void> {
  await requireMember();
  if (!UUID_PATTERN.test(mealSetId) || (recipeId !== null && !UUID_PATTERN.test(recipeId)) || !["SIDE", "SOUP"].includes(kind)) {
    redirect(`/meals/${mealSetId}?error=swap`);
  }
  const { error } = await (await createSupabaseServerClient()).rpc("swap_meal_set_dish", {
    p_meal_set_id: mealSetId,
    p_kind: kind,
    p_recipe_id: recipeId,
    p_expected_version: expectedVersion,
  });
  revalidatePath("/");
  redirect(`/meals/${mealSetId}?${error ? (error.code === "40001" ? "error=conflict" : "error=swap") : "notice=swapped"}`);
}

export async function setRiceAction(_previous: { error?: string; ok?: string }, formData: FormData): Promise<{ error?: string; ok?: string }> {
  const member = await requireMember();
  const grams = Number(String(formData.get("grams") ?? "").normalize("NFKC"));
  if (!Number.isInteger(grams) || grams < 0 || grams > 600) return { error: "ご飯の量は0〜600gの整数で入力してください。" };
  const { error } = await (await createSupabaseServerClient())
    .from("rice_portions")
    .upsert({ user_id: member.userId, grams }, { onConflict: "user_id" });
  if (error) return { error: "保存できませんでした。もう一度お試しください。" };
  revalidatePath("/settings");
  return { ok: `ご飯の量を${grams}gにしました。` };
}
