"use client";

import Link from "next/link";
import { useState, useTransition } from "react";
import type { CompleteResult } from "@/app/(main)/meals/actions";
import { Alert } from "@/components/ui/alert";
import { Button, buttonClassName } from "@/components/ui/button";
import { RATING_LABELS, RATINGS, type Rating } from "@/lib/recipes/constants";
import styles from "./meals.module.css";

type Props = {
  /** 献立セットIDまたはレシピID（余裕日） */
  targetId: string;
  label: string;
  action: (targetId: string, idempotencyKey: string) => Promise<CompleteResult>;
  setRatingAction: (recipeId: string, rating: Rating | null) => Promise<{ error?: string }>;
  /** 画面下に固定するか（献立画面） */
  sticky?: boolean;
  /** すでに作った記録がある（自分の操作の結果を表示中でなければ、ボタンを出さない） */
  done?: boolean;
};

function newKey() {
  return typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : `k-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

/**
 * 「作った」ボタン。1回押すと在庫の減算・食事履歴・調理履歴をまとめて保存する（サーバー側で1回だけ処理）。
 * 画面ごとに1つの一意キーを使うため、通信の再送や連打でも二重に記録されない。
 * そのレシピを初めて作った場合だけ、3段階の評価を聞く。
 */
export function CompleteButton({ targetId, label, action, setRatingAction, sticky = true, done = false }: Props) {
  const [key] = useState(newKey);
  const [pending, startTransition] = useTransition();
  const [result, setResult] = useState<CompleteResult | null>(null);
  const [rated, setRated] = useState<Record<string, Rating>>({});
  const [ratingError, setRatingError] = useState<string | null>(null);

  async function rate(recipeId: string, rating: Rating) {
    const previous = rated[recipeId];
    setRatingError(null);
    setRated((r) => ({ ...r, [recipeId]: rating }));
    const response = await setRatingAction(recipeId, rating).catch(() => ({ error: "通信に失敗しました。" }));
    if (response.error) {
      setRated((r) => {
        const next = { ...r };
        if (previous) next[recipeId] = previous;
        else delete next[recipeId];
        return next;
      });
      setRatingError(`${response.error}（評価は保存されていません。もう一度選んでください）`);
    }
  }

  function complete() {
    startTransition(async () => {
      const response = await action(targetId, key).catch(() => ({ error: "通信に失敗しました（記録されたか分からない場合は、もう一度押しても二重には記録されません）。" }));
      setResult(response);
    });
  }

  if (result && !result.error) {
    return (
      <div className={styles.done}>
        <Alert tone="success" title={result.already ? "記録済みです" : "作った記録をつけました"}>
          <p>{result.already ? "この献立はすでに記録されています（二重には記録していません）。" : "在庫を減らし、食事の記録に残しました。"}</p>
          {result.unconsumed && result.unconsumed.length > 0 ? (
            <p className={styles.muted}>在庫に無かった材料：{result.unconsumed.map((u) => u.name).join("、")}（在庫は変えていません）</p>
          ) : null}
        </Alert>
        {(result.firstTimeRecipes ?? []).map((recipe) => (
          <section key={recipe.id} className={styles.rating} aria-labelledby={`rate-${recipe.id}`}>
            <h2 id={`rate-${recipe.id}`} className={styles.ratingTitle}>
              初めて作った「{recipe.name}」はどうでしたか？
            </h2>
            <div role="group" aria-label={`${recipe.name}の評価`} className={styles.ratingButtons}>
              {RATINGS.map((rating) => (
                <button
                  key={rating}
                  type="button"
                  className={buttonClassName({ variant: rated[recipe.id] === rating ? "primary" : "secondary", size: "small" })}
                  aria-pressed={rated[recipe.id] === rating}
                  onClick={() => void rate(recipe.id, rating)}
                >
                  {RATING_LABELS[rating]}
                </button>
              ))}
            </div>
          </section>
        ))}
        {ratingError ? <Alert tone="error">{ratingError}</Alert> : null}
        <Link href="/" className={buttonClassName({ variant: "secondary", block: true })}>
          ホームへ戻る
        </Link>
      </div>
    );
  }

  if (done) return null;
  return (
    <div className={sticky ? styles.completeBox : styles.done}>
      {result?.error ? <Alert tone="error">{result.error}</Alert> : null}
      <Button size="large" block onClick={complete} disabled={pending}>
        {pending ? "記録しています…" : label}
      </Button>
    </div>
  );
}
