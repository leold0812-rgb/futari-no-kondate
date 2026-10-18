"use client";

import { useOptimistic, useState, useTransition } from "react";
import { RATING_LABELS, RATINGS, type Rating } from "@/lib/recipes/constants";
import styles from "./preference-controls.module.css";

type Props = {
  recipeId: string;
  rating: Rating | null;
  favorite: boolean;
  setRatingAction: (recipeId: string, rating: Rating | null) => Promise<{ error?: string }>;
  setFavoriteAction: (recipeId: string, favorite: boolean) => Promise<{ error?: string }>;
};

/** 評価（3段階）とお気に入り。ふたり共通の設定として扱う */
export function PreferenceControls(props: Props) {
  const [pending, startTransition] = useTransition();
  const [rating, setOptimisticRating] = useOptimistic(props.rating);
  const [favorite, setOptimisticFavorite] = useOptimistic(props.favorite);
  const [error, setError] = useState<string | null>(null);

  // 失敗したら楽観表示は元に戻り、理由と再試行の方法を示す
  function chooseRating(next: Rating) {
    const value = rating === next ? null : next;
    setError(null);
    startTransition(async () => {
      setOptimisticRating(value);
      const result = await props.setRatingAction(props.recipeId, value);
      if (result?.error) setError(`${result.error}（評価は変わっていません）`);
    });
  }

  function toggleFavorite() {
    setError(null);
    startTransition(async () => {
      setOptimisticFavorite(!favorite);
      const result = await props.setFavoriteAction(props.recipeId, !favorite);
      if (result?.error) setError(`${result.error}（お気に入りは変わっていません）`);
    });
  }

  return (
    <div className={styles.wrap} aria-busy={pending}>
      <div role="group" aria-label="評価" className={styles.ratings}>
        {RATINGS.map((value) => (
          <button
            key={value}
            type="button"
            className={styles.rating}
            data-value={value}
            aria-pressed={rating === value}
            onClick={() => chooseRating(value)}
          >
            {rating === value ? "✓ " : ""}
            {RATING_LABELS[value]}
          </button>
        ))}
      </div>
      <div className={styles.row}>
        <button type="button" className={styles.favorite} aria-pressed={favorite} onClick={toggleFavorite}>
          <span aria-hidden="true">{favorite ? "★" : "☆"}</span> {favorite ? "お気に入り登録済み" : "お気に入りに追加"}
        </button>
      </div>
      <p className={styles.error} role="status" aria-live="polite">
        {error}
      </p>
    </div>
  );
}
