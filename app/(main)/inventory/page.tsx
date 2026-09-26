import type { Metadata } from "next";
import { AddInventoryForm } from "@/components/inventory/add-inventory-form";
import { InventoryEntryCard } from "@/components/inventory/inventory-entry";
import styles from "@/components/inventory/inventory.module.css";
import { Alert } from "@/components/ui/alert";
import { LinkButton } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { PageHeader } from "@/components/ui/page-header";
import { requireMember } from "@/lib/auth/session";
import { tokyoDate } from "@/lib/dates";
import { INGREDIENT_CATEGORIES, INGREDIENT_CATEGORY_LABELS } from "@/lib/ingredients";
import { listIngredients, listInventory } from "@/lib/services/inventory";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { addInventoryAction } from "./actions";

export const metadata: Metadata = { title: "在庫 | ふたりの献立" };

const NOTICES: Record<string, { tone: "success" | "error"; text: string }> = {
  updated: { tone: "success", text: "数量を直しました。" },
  removed: { tone: "success", text: "在庫から消しました（記録は残っています）。" },
  quantity: { tone: "error", text: "数量は0以上の数字で入力してください。まだ保存されていません。" },
  save: { tone: "error", text: "保存できませんでした。通信状態を確認して、もう一度お試しください。" },
};

export default async function InventoryPage({ searchParams }: PageProps<"/inventory">) {
  const params = await searchParams;
  const notice = NOTICES[String(params.error ?? params.notice ?? "")];
  await requireMember();
  const supabase = await createSupabaseServerClient();
  const today = tokyoDate();
  const [entries, ingredients] = await Promise.all([listInventory(supabase, today), listIngredients(supabase)]);
  const useSoon = entries.filter((e) => e.freshness.status === "USE_SOON" || e.freshness.status === "PAST_ESTIMATE");
  const rest = entries.filter((e) => !useSoon.includes(e));

  return (
    <>
      <PageHeader
        title="在庫"
        description="買い物の「購入済み」で増え、「作った」で減ります。ずれたときだけ直してください。"
        action={
          <LinkButton href="/inventory/ingredients" variant="secondary" size="small">
            材料の設定
          </LinkButton>
        }
      />

      {notice ? <Alert tone={notice.tone}>{notice.text}</Alert> : null}

      <AddInventoryForm
        action={addInventoryAction}
        ingredientNames={ingredients.map((i) => i.name)}
        today={today}
        defaultOpen={entries.length === 0}
      />

      {entries.length === 0 ? (
        <EmptyState
          title="在庫はまだありません"
          description="買い物リストで「購入済み」にすると自動で入ります。家にある食材を先に登録しておくこともできます。"
        />
      ) : (
        <>
          {useSoon.length > 0 ? (
            <section className={styles.section} aria-labelledby="use-soon-heading">
              <h2 id="use-soon-heading" className={styles.sectionTitle}>
                ⚠ そろそろ使いたい（{useSoon.length}）
              </h2>
              <p className={styles.sectionNote}>購入日と材料ごとの保存目安から計算しています（消費期限ではありません）。</p>
              <ul className={styles.list}>
                {useSoon.map((entry) => (
                  <InventoryEntryCard key={entry.ingredient.id} entry={entry} />
                ))}
              </ul>
            </section>
          ) : null}
          {INGREDIENT_CATEGORIES.map((category) => {
            const inCategory = rest.filter((e) => e.ingredient.category === category);
            if (inCategory.length === 0) return null;
            return (
              <section key={category} className={styles.section} aria-labelledby={`cat-${category}`}>
                <h2 id={`cat-${category}`} className={styles.sectionTitle}>
                  {INGREDIENT_CATEGORY_LABELS[category]}
                </h2>
                <ul className={styles.list}>
                  {inCategory.map((entry) => (
                    <InventoryEntryCard key={entry.ingredient.id} entry={entry} />
                  ))}
                </ul>
              </section>
            );
          })}
        </>
      )}
    </>
  );
}
