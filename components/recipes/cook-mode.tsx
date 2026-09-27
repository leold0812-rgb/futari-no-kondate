"use client";

import Link from "next/link";
import { useState } from "react";
import { buttonClassName } from "@/components/ui/button";
import { formatQuantity } from "@/lib/units";
import styles from "./cook-mode.module.css";

type Props = {
  recipeId: string;
  name: string;
  steps: string[];
  ingredients: { id: string; rawName: string; quantity: number | null; unit: string | null }[];
};

/** 調理モード：1手順ずつ大きく表示する。材料は折りたたみで確認できる */
export function CookMode({ recipeId, name, steps, ingredients }: Props) {
  const [index, setIndex] = useState(0);
  const total = steps.length;
  const isLast = index === total - 1;

  if (total === 0) {
    return (
      <div className={styles.empty}>
        <p>手順がまだ登録されていません。</p>
        <Link href={`/recipes/${recipeId}/edit`} className={buttonClassName({ variant: "secondary" })}>
          手順を追加する
        </Link>
      </div>
    );
  }

  return (
    <div className={styles.wrap}>
      <p className={styles.recipeName}>{name}</p>
      <p className={styles.progress} aria-live="polite">
        手順 {index + 1} / {total}
      </p>
      <div className={styles.progressBar} aria-hidden="true">
        <span style={{ width: `${((index + 1) / total) * 100}%` }} />
      </div>
      <p className={styles.step}>{steps[index]}</p>

      <details className={styles.ingredients}>
        <summary>材料を見る</summary>
        <ul>
          {ingredients.map((item) => (
            <li key={item.id}>
              <span>{item.rawName}</span>
              <span>{formatQuantity(item.quantity, item.unit)}</span>
            </li>
          ))}
        </ul>
      </details>

      <div className={styles.nav}>
        <button
          type="button"
          className={buttonClassName({ variant: "secondary", size: "large" })}
          onClick={() => setIndex((i) => Math.max(0, i - 1))}
          disabled={index === 0}
        >
          ‹ 前へ
        </button>
        {isLast ? (
          <Link href={`/recipes/${recipeId}`} className={buttonClassName({ size: "large" })}>
            完了
          </Link>
        ) : (
          <button
            type="button"
            className={buttonClassName({ size: "large" })}
            onClick={() => setIndex((i) => Math.min(total - 1, i + 1))}
          >
            次へ ›
          </button>
        )}
      </div>
    </div>
  );
}
