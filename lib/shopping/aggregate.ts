/**
 * 買い物リストの材料合算（Gate 6）。副作用のない純粋関数。
 *
 * - 全献立（主菜・副菜・汁物）の材料を、人数換算したうえで「材料 × 互換単位グループ」ごとに合計する
 * - 同じ材料・同じグループの在庫を差し引き、買う量を出す（互換でない単位の在庫は差し引かない）
 * - 数量のない行（少々・適量）は合算せず「家にあるか確認」として残す
 * 量は基準単位（g / ml / 個数の単位 / 未知の単位はそのまま）で持ち、表示は formatBaseQuantity で整える。
 */
import type { IngredientCategory } from "@/lib/ingredients";
import { formatBaseQuantity, normalizeUnit, toBaseQuantity, unitGroup } from "@/lib/units";

export type ShoppingRecipeLine = {
  ingredientId: string | null;
  /** 材料マスタの名前（無ければ材料行の名前） */
  name: string;
  category: IngredientCategory;
  quantity: number | null;
  unit: string | null;
};

export type ShoppingDish = {
  recipeName: string;
  /** 献立の人数 ÷ レシピの人数 */
  factor: number;
  lines: ShoppingRecipeLine[];
};

export type ShoppingStock = { ingredientId: string; quantity: number; unit: string | null };

export type ShoppingDraftItem = {
  key: string;
  ingredientId: string | null;
  name: string;
  category: IngredientCategory;
  /** 基準単位のグループ（mass / volume / count:個 / other:… / none） */
  group: string;
  /** DBへ保存する単位（g / ml / 個 など。数量なしはnull） */
  unit: string | null;
  required: number | null;
  inStock: number;
  toBuy: number | null;
  /** 少々・適量など数量の無い材料だけの行 */
  uncounted: boolean;
  recipes: string[];
};

function baseUnitFor(group: string): string | null {
  if (group === "mass") return "g";
  if (group === "volume") return "ml";
  if (group.startsWith("count:")) return group.slice("count:".length);
  if (group.startsWith("other:")) return group.slice("other:".length);
  return null;
}

function roundQuantity(value: number): number {
  return Math.round(value * 100) / 100;
}

export function aggregateShopping(dishes: ShoppingDish[], stock: ShoppingStock[]): ShoppingDraftItem[] {
  const items = new Map<string, ShoppingDraftItem>();

  for (const dish of dishes) {
    for (const line of dish.lines) {
      const identity = line.ingredientId ?? `name:${line.name.trim().toLowerCase()}`;
      if (line.quantity === null) {
        // 数量のない行：同じ材料の数量つきの行があればそちらに含めるので、まずは印だけ付ける
        const key = `${identity}|uncounted`;
        const item =
          items.get(key) ??
          ({
            key,
            ingredientId: line.ingredientId,
            name: line.name,
            category: line.category,
            group: "none",
            unit: null,
            required: null,
            inStock: 0,
            toBuy: null,
            uncounted: true,
            recipes: [],
          } satisfies ShoppingDraftItem);
        if (!item.recipes.includes(dish.recipeName)) item.recipes.push(dish.recipeName);
        items.set(key, item);
        continue;
      }
      const group = unitGroup(line.unit);
      const base = (toBaseQuantity(line.quantity, line.unit) ?? line.quantity) * dish.factor;
      const key = `${identity}|${group}`;
      const item =
        items.get(key) ??
        ({
          key,
          ingredientId: line.ingredientId,
          name: line.name,
          category: line.category,
          group,
          unit: baseUnitFor(group) ?? normalizeUnit(line.unit) ?? line.unit,
          required: 0,
          inStock: 0,
          toBuy: 0,
          uncounted: false,
          recipes: [],
        } satisfies ShoppingDraftItem);
      item.required = (item.required ?? 0) + base;
      if (!item.recipes.includes(dish.recipeName)) item.recipes.push(dish.recipeName);
      items.set(key, item);
    }
  }

  // 数量つきの行がある材料では、数量なしの印を消す（例：「塩 小さじ1」と「塩 少々」→ 小さじ1だけ買う判断にする）
  for (const [key, item] of items) {
    if (!item.uncounted) continue;
    const identity = key.slice(0, -"|uncounted".length);
    const counted = [...items.values()].find((other) => !other.uncounted && other.key.startsWith(`${identity}|`));
    if (counted) {
      for (const recipe of item.recipes) if (!counted.recipes.includes(recipe)) counted.recipes.push(recipe);
      items.delete(key);
    }
  }

  // 在庫の差し引き（同じ材料・同じグループだけ）
  for (const item of items.values()) {
    if (item.uncounted || !item.ingredientId) {
      item.toBuy = item.uncounted ? null : roundQuantity(item.required ?? 0);
      if (item.required !== null) item.required = roundQuantity(item.required);
      continue;
    }
    const inStock = stock
      .filter((s) => s.ingredientId === item.ingredientId && unitGroup(s.unit) === item.group)
      .reduce((total, s) => total + (toBaseQuantity(s.quantity, s.unit) ?? s.quantity), 0);
    item.inStock = roundQuantity(inStock);
    item.required = roundQuantity(item.required ?? 0);
    item.toBuy = roundQuantity(Math.max(0, item.required - inStock));
  }

  return [...items.values()];
}

export function describeAmount(quantity: number | null, group: string): string {
  if (quantity === null) return "";
  return formatBaseQuantity(quantity, group);
}
