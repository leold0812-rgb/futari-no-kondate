"use server";

import { revalidatePath } from "next/cache";
import { requireMember } from "@/lib/auth/session";
import { tokyoDate } from "@/lib/dates";
import { INGREDIENT_CATEGORIES, type IngredientCategory } from "@/lib/ingredients";
import { addInventory, setLotQuantity, updateIngredient } from "@/lib/services/inventory";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { parseAmount } from "@/lib/units";

export type InventoryFormState = { error?: string; ok?: string };

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

export async function addInventoryAction(_previous: InventoryFormState, formData: FormData): Promise<InventoryFormState> {
  await requireMember();
  const name = String(formData.get("name") ?? "").trim().slice(0, 60);
  const amount = parseAmount(String(formData.get("amount") ?? ""));
  const purchasedOn = String(formData.get("purchasedOn") ?? "") || tokyoDate();
  if (!name) return { error: "材料名を入力してください。" };
  if (amount.quantity === null || amount.quantity <= 0 || amount.quantity > 99999) {
    return { error: "分量を「300g」「2個」のように数字を含めて入力してください（在庫は数えられる量だけ登録します）。" };
  }
  if (!DATE_PATTERN.test(purchasedOn) || purchasedOn > tokyoDate()) {
    return { error: "購入日は今日以前の日付にしてください。" };
  }
  try {
    await addInventory(await createSupabaseServerClient(), {
      rawName: name,
      quantity: Math.round(amount.quantity * 100) / 100,
      unit: amount.unit,
      purchasedOn,
    });
  } catch {
    return { error: "在庫を追加できませんでした。通信状態を確認して、もう一度お試しください（まだ保存されていません）。" };
  }
  revalidatePath("/inventory");
  return { ok: `${name}を在庫に追加しました。` };
}

export async function setLotQuantityAction(lotId: string, formData: FormData): Promise<void> {
  await requireMember();
  const quantity = Number(String(formData.get("quantity") ?? "").normalize("NFKC"));
  if (!UUID_PATTERN.test(lotId) || !Number.isFinite(quantity) || quantity < 0 || quantity > 99999) return;
  await setLotQuantity(await createSupabaseServerClient(), lotId, Math.round(quantity * 100) / 100, quantity === 0 ? "MANUAL_REMOVE" : "MANUAL_EDIT");
  revalidatePath("/inventory");
}

export async function markLotUsedUpAction(lotId: string): Promise<void> {
  await requireMember();
  if (!UUID_PATTERN.test(lotId)) return;
  await setLotQuantity(await createSupabaseServerClient(), lotId, 0, "MANUAL_REMOVE");
  revalidatePath("/inventory");
}

export async function updateIngredientAction(ingredientId: string, formData: FormData): Promise<void> {
  await requireMember();
  const category = String(formData.get("category") ?? "") as IngredientCategory;
  const daysText = String(formData.get("storageDays") ?? "").trim();
  const storageDays = daysText === "" ? null : Number(daysText.normalize("NFKC"));
  if (!UUID_PATTERN.test(ingredientId) || !INGREDIENT_CATEGORIES.includes(category)) return;
  if (storageDays !== null && (!Number.isInteger(storageDays) || storageDays < 1 || storageDays > 365)) return;
  await updateIngredient(await createSupabaseServerClient(), ingredientId, { category, storageDays });
  revalidatePath("/inventory");
  revalidatePath("/inventory/ingredients");
}
