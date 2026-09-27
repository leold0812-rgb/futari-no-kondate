import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { tokyoDate } from "@/lib/dates";
import {
  DEFAULT_STORAGE_DAYS,
  guessIngredientCategory,
  INGREDIENT_CATEGORIES,
  normalizeIngredientName,
  type IngredientCategory,
} from "@/lib/ingredients";
import { freshnessOf, freshnessPriority, type Freshness } from "@/lib/inventory/status";
import { normalizeUnit, toBaseQuantity, unitGroup } from "@/lib/units";

/** 在庫のユースケース（Gate 4）。利用者のsession（RLS）で呼ぶ。数量の変更はDB関数（監査つき）だけで行う */

export type Ingredient = {
  id: string;
  name: string;
  category: IngredientCategory;
  defaultUnit: string | null;
  storageDays: number | null;
};

export type InventoryLot = {
  id: string;
  ingredientId: string;
  quantity: number;
  unit: string | null;
  purchasedOn: string;
  freshness: Freshness;
};

export type InventoryEntry = {
  ingredient: Ingredient;
  lots: InventoryLot[];
  /** もっとも先に使いたいlotの鮮度 */
  freshness: Freshness;
};

type IngredientRow = { id: string; name: string; category: IngredientCategory; default_unit: string | null; storage_days: number | null };

function toIngredient(row: IngredientRow): Ingredient {
  return { id: row.id, name: row.name, category: row.category, defaultUnit: row.default_unit, storageDays: row.storage_days };
}

export async function listIngredients(supabase: SupabaseClient): Promise<Ingredient[]> {
  const { data, error } = await supabase
    .from("ingredients")
    .select("id, name, category, default_unit, storage_days")
    .order("name")
    .limit(2000);
  if (error) throw new Error(`材料を読み込めませんでした: ${error.message}`);
  return (data as IngredientRow[]).map(toIngredient);
}

export async function listInventory(supabase: SupabaseClient, today: string = tokyoDate()): Promise<InventoryEntry[]> {
  const { data, error } = await supabase
    .from("inventory_items")
    .select("id, ingredient_id, quantity, unit, purchased_on, ingredients(id, name, category, default_unit, storage_days)")
    .order("purchased_on")
    .limit(2000);
  if (error) throw new Error(`在庫を読み込めませんでした: ${error.message}`);

  const byIngredient = new Map<string, InventoryEntry>();
  for (const row of data ?? []) {
    const ingredientRow = (Array.isArray(row.ingredients) ? row.ingredients[0] : row.ingredients) as IngredientRow | null;
    if (!ingredientRow) continue;
    const ingredient = toIngredient(ingredientRow);
    const lot: InventoryLot = {
      id: row.id as string,
      ingredientId: ingredient.id,
      quantity: Number(row.quantity),
      unit: row.unit as string | null,
      purchasedOn: row.purchased_on as string,
      freshness: freshnessOf(row.purchased_on as string, ingredient.storageDays, today),
    };
    const entry = byIngredient.get(ingredient.id) ?? { ingredient, lots: [], freshness: lot.freshness };
    entry.lots.push(lot);
    if (compareFreshness(lot.freshness, entry.freshness) < 0) entry.freshness = lot.freshness;
    byIngredient.set(ingredient.id, entry);
  }
  return [...byIngredient.values()].sort(
    (a, b) => compareFreshness(a.freshness, b.freshness) || a.ingredient.name.localeCompare(b.ingredient.name, "ja"),
  );
}

export function compareFreshness(a: Freshness, b: Freshness): number {
  return freshnessPriority(a) - freshnessPriority(b) || (a.daysLeft ?? 9999) - (b.daysLeft ?? 9999);
}

/** 材料ごとの在庫量（互換単位グループごとに基準単位で合計）。推薦・買い物の在庫差引に使う */
export function totalsByGroup(lots: Pick<InventoryLot, "quantity" | "unit">[]): Map<string, number> {
  const totals = new Map<string, number>();
  for (const lot of lots) {
    const group = unitGroup(lot.unit);
    const base = toBaseQuantity(lot.quantity, lot.unit) ?? lot.quantity;
    totals.set(group, (totals.get(group) ?? 0) + base);
  }
  return totals;
}

/** 名前で材料を探し、無ければ（カテゴリと保存目安を推定して）作る */
export async function findOrCreateIngredient(supabase: SupabaseClient, rawName: string, unit: string | null): Promise<Ingredient> {
  const name = normalizeIngredientName(rawName);
  if (!name) throw new Error("材料名を入力してください。");
  const existing = (await listIngredients(supabase)).find((i) => i.name.trim().toLowerCase() === name.toLowerCase());
  if (existing) return existing;

  const category = guessIngredientCategory(name);
  const { data, error } = await supabase
    .from("ingredients")
    .insert({ name, category, storage_days: DEFAULT_STORAGE_DAYS[category], default_unit: unit })
    .select("id, name, category, default_unit, storage_days")
    .single();
  if (error?.code === "23505") {
    // 同時に同じ材料が作られた
    const again = (await listIngredients(supabase)).find((i) => i.name.trim().toLowerCase() === name.toLowerCase());
    if (again) return again;
  }
  if (error || !data) throw new Error(`材料を登録できませんでした: ${error?.message ?? "不明なエラー"}`);
  return toIngredient(data as IngredientRow);
}

export async function addInventory(
  supabase: SupabaseClient,
  input: { rawName: string; quantity: number; unit: string | null; purchasedOn: string },
): Promise<void> {
  const unit = normalizeUnit(input.unit) ?? input.unit;
  const ingredient = await findOrCreateIngredient(supabase, input.rawName, unit);
  const { error } = await supabase.rpc("inventory_add", {
    p_ingredient_id: ingredient.id,
    p_quantity: input.quantity,
    p_unit: unit,
    p_purchased_on: input.purchasedOn,
  });
  if (error) throw new Error(`在庫を追加できませんでした: ${error.message}`);
}

/** 手動補正（0なら削除）。監査の理由はDB関数が決める */
export async function setLotQuantity(supabase: SupabaseClient, lotId: string, quantity: number): Promise<void> {
  const { error } = await supabase.rpc("inventory_set_quantity", { p_item_id: lotId, p_quantity: quantity });
  if (error) throw new Error(`在庫を更新できませんでした: ${error.message}`);
}

export async function updateIngredient(
  supabase: SupabaseClient,
  ingredientId: string,
  patch: { category: IngredientCategory; storageDays: number | null },
): Promise<void> {
  if (!INGREDIENT_CATEGORIES.includes(patch.category)) throw new Error("カテゴリが正しくありません。");
  const { error } = await supabase
    .from("ingredients")
    .update({ category: patch.category, storage_days: patch.storageDays })
    .eq("id", ingredientId);
  if (error) throw new Error(`材料を更新できませんでした: ${error.message}`);
}
