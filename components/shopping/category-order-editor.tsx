"use client";

import { useState, useTransition } from "react";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { INGREDIENT_CATEGORY_LABELS, type IngredientCategory } from "@/lib/ingredients";
import styles from "./shopping.module.css";

type Props = {
  initial: IngredientCategory[];
  action: (categories: IngredientCategory[]) => Promise<{ error?: string }>;
};

/** 買い物リストのカテゴリ順（いつものお店の売り場順に合わせる）。上下ボタンで並べ替えて保存する */
export function CategoryOrderEditor({ initial, action }: Props) {
  const [order, setOrder] = useState(initial);
  const [pending, startTransition] = useTransition();
  const [message, setMessage] = useState<{ tone: "success" | "error"; text: string } | null>(null);

  function move(index: number, delta: number) {
    const next = [...order];
    const [item] = next.splice(index, 1);
    next.splice(index + delta, 0, item);
    setOrder(next);
    setMessage(null);
  }

  function save() {
    startTransition(async () => {
      const result = await action(order).catch(() => ({ error: "通信に失敗しました。" }));
      setMessage(result.error ? { tone: "error", text: result.error } : { tone: "success", text: "並び順を保存しました。" });
    });
  }

  return (
    <div className={styles.section}>
      <ol className={styles.orderList}>
        {order.map((category, index) => (
          <li key={category} className={styles.orderRow}>
            <span>
              {index + 1}. {INGREDIENT_CATEGORY_LABELS[category]}
            </span>
            <Button variant="ghost" size="small" onClick={() => move(index, -1)} disabled={index === 0} aria-label={`${INGREDIENT_CATEGORY_LABELS[category]}を上へ`}>
              ↑
            </Button>
            <Button
              variant="ghost"
              size="small"
              onClick={() => move(index, 1)}
              disabled={index === order.length - 1}
              aria-label={`${INGREDIENT_CATEGORY_LABELS[category]}を下へ`}
            >
              ↓
            </Button>
          </li>
        ))}
      </ol>
      {message ? <Alert tone={message.tone}>{message.text}</Alert> : null}
      <Button variant="secondary" onClick={save} disabled={pending}>
        {pending ? "保存しています…" : "この並び順で保存"}
      </Button>
    </div>
  );
}
