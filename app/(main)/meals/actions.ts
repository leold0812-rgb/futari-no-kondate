"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireMember } from "@/lib/auth/session";
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

/** 作った（献立セット）。同じ画面からの再送はidempotency keyで1回だけ処理される。栄養の写しはDBが算出する */
export async function completeMealSetAction(mealSetId: string, idempotencyKey: string): Promise<CompleteResult> {
  await requireMember();
  if (!UUID_PATTERN.test(mealSetId) || !KEY_PATTERN.test(idempotencyKey)) return { error: "記録できませんでした。" };
  const { data, error } = await (await createSupabaseServerClient()).rpc("complete_meal_set", {
    p_meal_set_id: mealSetId,
    p_idempotency_key: idempotencyKey,
  });
  if (error || !data) return { error: "記録できませんでした（在庫・履歴は変わっていません）。通信状態を確認して、もう一度押してください。" };
  const result = data as RpcResult;
  revalidatePath("/");
  revalidatePath("/inventory");
  revalidatePath("/records");
  return { already: result.already, unconsumed: result.unconsumed, firstTimeRecipes: await firstTimeNames(result.first_time_recipe_ids) };
}

/** 作った（余裕日、2人分）。栄養の写しと人数はDBが決める */
export async function completeFreeMealAction(recipeId: string, idempotencyKey: string): Promise<CompleteResult> {
  await requireMember();
  if (!UUID_PATTERN.test(recipeId) || !KEY_PATTERN.test(idempotencyKey)) return { error: "記録できませんでした。" };
  const { data, error } = await (await createSupabaseServerClient()).rpc("complete_free_meal", {
    p_recipe_id: recipeId,
    p_idempotency_key: idempotencyKey,
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
