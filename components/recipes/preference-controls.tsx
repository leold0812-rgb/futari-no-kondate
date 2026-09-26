"use client";

import { useOptimistic, useTransition } from "react";
import { RATING_LABELS, RATINGS, type Rating } from "@/lib/recipes/constants";
import styles from "./preference-controls.module.css";

type Props = {
  recipeId: string;
  myRating: Rating | null;
  partnerRating: Rating | null;
  partnerName: string | null;
  myFavorite: boolean;
  setRatingAction: (recipeId: string, rating: Rating | null) => Promise<{ error?: string }>;
  setFavoriteAction: (recipeId: string, favorite: boolean) => Promise<{ error?: string }>;
};

/** 自分の評価（3段階）とお気に入り。相手の評価は表示だけ（変更できない） */
export function PreferenceControls(props: Props) {
  const [pending, startTransition] = useTransition();
  const [rating, setOptimisticRating] = useOptimistic(props.myRating);
  const [favorite, setOptimisticFavorite] = useOptimistic(props.myFavorite);

  function chooseRating(next: Rating) {
    const value = rating === next ? null : next;
    startTransition(async () => {
      setOptimisticRating(value);
      await props.setRatingAction(props.recipeId, value);
    });
  }

  function toggleFavorite() {
    startTransition(async () => {
      setOptimisticFavorite(!favorite);
      await props.setFavoriteAction(props.recipeId, !favorite);
    });
  }

  return (
    <div className={styles.wrap} aria-busy={pending}>
      <div role="group" aria-label="自分の評価" className={styles.ratings}>
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
        {props.partnerName ? (
          <p className={styles.partner}>
            {props.partnerName}さんの評価：{props.partnerRating ? RATING_LABELS[props.partnerRating] : "未評価"}
          </p>
        ) : null}
      </div>
    </div>
  );
}
