"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireMember } from "@/lib/auth/session";
import { INGREDIENT_CATEGORIES, type IngredientCategory } from "@/lib/ingredients";
import { resolvePlanWeek } from "@/lib/plan-week";
import { findOrCreateIngredient } from "@/lib/services/inventory";
import { prepareShoppingForPlan, rpcOrThrow } from "@/lib/services/shopping";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { normalizeUnit, parseAmount, toBaseQuantity, unitGroup, unitKind } from "@/lib/units";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const prepPath = (week: string) => `/plan/shopping?week=${resolvePlanWeek(week)}`;

export async function prepareShoppingAction(planId: string, week: string): Promise<void> {
  await requireMember();
  if (!UUID_PATTERN.test(planId)) redirect("/");
  try {
    await prepareShoppingForPlan(await createSupabaseServerClient(), planId);
  } catch {
    redirect(`${prepPath(week)}&error=prepare`);
  }
  redirect(prepPath(week));
}

export async function homeCheckAction(itemId: string, checked: boolean, week: string): Promise<void> {
  await requireMember();
  if (!UUID_PATTERN.test(itemId)) redirect(prepPath(week));
  try {
    await rpcOrThrow(await createSupabaseServerClient(), "set_home_check", { p_item_id: itemId, p_checked: checked }, "家にあるチェックを保存できませんでした");
  } catch {
    redirect(`${prepPath(week)}&error=save`);
  }
  revalidatePath("/plan/shopping");
  redirect(prepPath(week));
}

export async function addInsuranceAction(
  listId: string,
  ingredientId: string,
  name: string,
  category: IngredientCategory,
  defaultUnit: string | null,
  week: string,
): Promise<void> {
  await requireMember();
  if (!UUID_PATTERN.test(listId) || !UUID_PATTERN.test(ingredientId) || !INGREDIENT_CATEGORIES.includes(category)) {
    redirect(`${prepPath(week)}&error=save`);
  }
  // 数えられる単位（個・袋など）なら1つ、そうでなければ量は決めずに追加する
  const unit = normalizeUnit(defaultUnit);
  const counted = unit && unitKind(unit) === "count";
  try {
    await rpcOrThrow(
      await createSupabaseServerClient(),
      "add_shopping_item",
      { p_list_id: listId, p_ingredient_id: ingredientId, p_name: name.slice(0, 60), p_category: category, p_quantity: counted ? 1 : null, p_unit: counted ? unit : null, p_source: "INSURANCE" },
      "保険食材を追加できませんでした",
    );
  } catch {
    redirect(`${prepPath(week)}&error=save`);
  }
  revalidatePath("/plan/shopping");
  redirect(prepPath(week));
}

export async function removeItemAction(itemId: string, returnTo: string): Promise<void> {
  await requireMember();
  const target = returnTo.startsWith("/") && !returnTo.startsWith("//") ? returnTo : "/shopping";
  if (UUID_PATTERN.test(itemId)) {
    await rpcOrThrow(await createSupabaseServerClient(), "remove_shopping_item", { p_item_id: itemId }, "項目を外せませんでした").catch(() => undefined);
  }
  revalidatePath("/shopping");
  revalidatePath("/plan/shopping");
  redirect(target);
}

export async function confirmShoppingListAction(listId: string): Promise<void> {
  await requireMember();
  if (!UUID_PATTERN.test(listId)) redirect("/shopping");
  await rpcOrThrow(await createSupabaseServerClient(), "confirm_shopping_list", { p_list_id: listId }, "買い物リストを確定できませんでした");
  revalidatePath("/shopping");
  revalidatePath("/");
  redirect("/shopping?notice=confirmed");
}

/** 購入済み（押した画面ですぐ表示を変え、失敗したら戻す） */
export async function setPurchasedAction(itemId: string, purchased: boolean): Promise<{ error?: string }> {
  await requireMember();
  if (!UUID_PATTERN.test(itemId)) return { error: "保存できませんでした。" };
  try {
    await rpcOrThrow(await createSupabaseServerClient(), "set_purchased", { p_item_id: itemId, p_purchased: Boolean(purchased) }, "購入済みを保存できませんでした");
  } catch {
    return { error: "購入済みを保存できませんでした。通信状態を確認して、もう一度押してください。" };
  }
  revalidatePath("/inventory");
  return {};
}

export type AddItemState = { error?: string; ok?: string };

export async function addManualItemAction(listId: string, _previous: AddItemState, formData: FormData): Promise<AddItemState> {
  await requireMember();
  const name = String(formData.get("name") ?? "").trim().slice(0, 60);
  const amount = parseAmount(String(formData.get("amount") ?? ""));
  if (!UUID_PATTERN.test(listId) || !name) return { error: "品名を入力してください。" };
  const supabase = await createSupabaseServerClient();
  try {
    const ingredient = await findOrCreateIngredient(supabase, name, amount.unit);
    const group = unitGroup(amount.unit);
    const base = amount.quantity === null ? null : (toBaseQuantity(amount.quantity, amount.unit) ?? amount.quantity);
    const unit = amount.quantity === null ? null : group === "mass" ? "g" : group === "volume" ? "ml" : (normalizeUnit(amount.unit) ?? amount.unit);
    await rpcOrThrow(
      supabase,
      "add_shopping_item",
      { p_list_id: listId, p_ingredient_id: ingredient.id, p_name: name, p_category: ingredient.category, p_quantity: base, p_unit: unit, p_source: "MANUAL" },
      "追加できませんでした",
    );
  } catch {
    return { error: "追加できませんでした。通信状態を確認して、もう一度お試しください（まだ追加されていません）。" };
  }
  revalidatePath("/shopping");
  revalidatePath("/plan/shopping");
  return { ok: `${name}を追加しました。` };
}

export async function setCategoryOrderAction(categories: IngredientCategory[]): Promise<{ error?: string }> {
  await requireMember();
  const valid = categories.filter((c) => INGREDIENT_CATEGORIES.includes(c));
  if (valid.length !== INGREDIENT_CATEGORIES.length || new Set(valid).size !== valid.length) return { error: "並び順を保存できませんでした。" };
  try {
    await rpcOrThrow(await createSupabaseServerClient(), "set_shopping_category_order", { p_categories: valid }, "並び順を保存できませんでした");
  } catch {
    return { error: "並び順を保存できませんでした。通信状態を確認して、もう一度お試しください。" };
  }
  revalidatePath("/shopping");
  revalidatePath("/settings");
  return {};
}
