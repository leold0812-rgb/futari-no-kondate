"use client";

import { useState } from "react";
import { SERVINGS_CHOICES } from "@/lib/recipes/constants";
import { formatQuantity, scaleQuantity } from "@/lib/units";
import styles from "./servings-ingredients.module.css";

export type IngredientView = {
  id: string;
  rawName: string;
  quantity: number | null;
  unit: string | null;
  note: string | null;
  isMain: boolean;
};

/** 材料一覧と1〜4人分の換算。換算は表示だけで、保存されたレシピは変えない */
export function ServingsIngredients({ baseServings, ingredients }: { baseServings: number; ingredients: IngredientView[] }) {
  const initial = (SERVINGS_CHOICES as readonly number[]).includes(baseServings) ? baseServings : 2;
  const [servings, setServings] = useState(initial);
  const factor = servings / baseServings;

  return (
    <div className={styles.wrap}>
      <div className={styles.header}>
        <p className={styles.base}>元のレシピ：{baseServings}人分</p>
        <div role="group" aria-label="何人分で表示するか" className={styles.choices}>
          {SERVINGS_CHOICES.map((n) => (
            <button
              key={n}
              type="button"
              className={styles.choice}
              aria-pressed={servings === n}
              onClick={() => setServings(n)}
            >
              {n}人分
            </button>
          ))}
        </div>
      </div>
      {ingredients.length === 0 ? (
        <p className={styles.empty}>材料はまだ登録されていません。</p>
      ) : (
        <ul className={styles.list}>
          {ingredients.map((item) => (
            <li key={item.id} className={styles.item}>
              <span className={styles.name}>
                {item.rawName}
                {item.isMain ? <span className={styles.main}>主</span> : null}
                {item.note ? <span className={styles.note}>（{item.note}）</span> : null}
              </span>
              <span className={styles.amount}>{formatQuantity(scaleQuantity(item.quantity, factor, item.unit), item.unit)}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
