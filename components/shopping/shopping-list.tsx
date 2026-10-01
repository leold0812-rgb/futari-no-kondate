"use client";

import { useOptimistic, useState, useTransition } from "react";
import { Alert } from "@/components/ui/alert";
import { INGREDIENT_CATEGORY_LABELS, type IngredientCategory } from "@/lib/ingredients";
import { clearLocalWrite, markLocalWrite } from "@/lib/realtime/local-write";
import { describeAmount } from "@/lib/shopping/aggregate";
import type { ShoppingItemView } from "@/lib/services/shopping";
import styles from "./shopping.module.css";

type Props = {
  items: ShoppingItemView[];
  categoryOrder: IngredientCategory[];
  setPurchasedAction: (itemId: string, purchased: boolean) => Promise<{ error?: string }>;
};

/**
 * 買い物中の一覧。カテゴリ順に並べ、押すと購入済み（在庫へ加算）。購入済みは消さず、チェックと薄い表示で残す。
 * 画面はすぐ変え、保存に失敗したら戻して理由を出す。
 */
export function ShoppingList({ items, categoryOrder, setPurchasedAction }: Props) {
  const [pending, startTransition] = useTransition();
  const [optimistic, setOptimistic] = useOptimistic(items, (current, change: { id: string; purchased: boolean }) =>
    current.map((item) => (item.id === change.id ? { ...item, purchased: change.purchased } : item)),
  );
  const [error, setError] = useState<string | null>(null);

  function toggle(item: ShoppingItemView) {
    setError(null);
    startTransition(async () => {
      setOptimistic({ id: item.id, purchased: !item.purchased });
      markLocalWrite();
      const result = await setPurchasedAction(item.id, !item.purchased).catch(() => ({ error: "通信に失敗しました。" }));
      if (result.error) {
        clearLocalWrite();
        setError(`${result.error}（「${item.name}」は変わっていません）`);
      }
    });
  }

  const visible = optimistic.filter((i) => !i.homeChecked && (i.toBuy === null || i.toBuy > 0 || i.source !== "PLAN"));
  const remaining = visible.filter((i) => !i.purchased).length;

  return (
    <div className={styles.list} aria-busy={pending}>
      <p className={styles.summary} aria-live="polite">
        残り {remaining} / {visible.length} 品
      </p>
      {error ? <Alert tone="error">{error}</Alert> : null}
      {categoryOrder.map((category) => {
        const inCategory = visible
          .filter((i) => i.category === category)
          .sort((a, b) => Number(a.purchased) - Number(b.purchased));
        if (inCategory.length === 0) return null;
        return (
          <section key={category} aria-labelledby={`shop-${category}`} className={styles.group}>
            <h2 id={`shop-${category}`} className={styles.groupTitle}>
              {INGREDIENT_CATEGORY_LABELS[category]}
            </h2>
            <ul className={styles.items}>
              {inCategory.map((item) => (
                <li key={item.id}>
                  <button
                    type="button"
                    className={styles.item}
                    aria-pressed={item.purchased}
                    data-purchased={item.purchased}
                    onClick={() => toggle(item)}
                  >
                    <span className={styles.check} aria-hidden="true">
                      {item.purchased ? "✓" : ""}
                    </span>
                    <span className={styles.itemName}>
                      {item.name}
                      {item.source === "INSURANCE" ? <span className={styles.badge}>保険</span> : null}
                    </span>
                    <span className={styles.amount}>
                      {item.toBuy === null ? "量は適宜" : describeAmount(item.toBuy, item.group)}
                    </span>
                    <span className="visually-hidden">{item.purchased ? "（購入済み。押すと未購入に戻す）" : "（押すと購入済み）"}</span>
                  </button>
                </li>
              ))}
            </ul>
          </section>
        );
      })}
    </div>
  );
}
