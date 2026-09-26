import type { Metadata } from "next";
import styles from "@/components/inventory/inventory.module.css";
import { buttonClassName, LinkButton } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { controlClassName } from "@/components/ui/field";
import { PageHeader } from "@/components/ui/page-header";
import { requireMember } from "@/lib/auth/session";
import { INGREDIENT_CATEGORIES, INGREDIENT_CATEGORY_LABELS } from "@/lib/ingredients";
import { listIngredients } from "@/lib/services/inventory";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { updateIngredientAction } from "../actions";

export const metadata: Metadata = { title: "材料の設定 | ふたりの献立" };

/** 材料ごとのカテゴリ（買い物の並び順）と保存目安（そろそろ使いたいの計算）を直す */
export default async function IngredientSettingsPage() {
  await requireMember();
  const ingredients = await listIngredients(await createSupabaseServerClient());
  return (
    <>
      <PageHeader
        title="材料の設定"
        description="保存目安は購入日から使い切りたい日数です。空欄にすると「そろそろ使いたい」の対象外になります。"
        back={
          <LinkButton href="/inventory" variant="ghost" size="small">
            ‹ 在庫
          </LinkButton>
        }
      />
      {ingredients.length === 0 ? (
        <EmptyState title="材料はまだありません" description="レシピや在庫を登録すると、ここに材料が並びます。" />
      ) : (
        <ul className={styles.list}>
          {ingredients.map((ingredient) => (
            <li key={ingredient.id} className={styles.ingredientRow}>
              <p className={styles.entryName}>{ingredient.name}</p>
              <form action={updateIngredientAction.bind(null, ingredient.id)} className={styles.ingredientForm}>
                <label className={styles.field}>
                  <span>カテゴリ</span>
                  <select name="category" defaultValue={ingredient.category} className={controlClassName}>
                    {INGREDIENT_CATEGORIES.map((c) => (
                      <option key={c} value={c}>
                        {INGREDIENT_CATEGORY_LABELS[c]}
                      </option>
                    ))}
                  </select>
                </label>
                <label className={styles.field}>
                  <span>保存目安（日）</span>
                  <input
                    name="storageDays"
                    inputMode="numeric"
                    defaultValue={ingredient.storageDays ?? ""}
                    className={controlClassName}
                    aria-label={`${ingredient.name}の保存目安（日）`}
                  />
                </label>
                <button type="submit" className={buttonClassName({ variant: "secondary", size: "small" })}>
                  保存
                </button>
              </form>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}
