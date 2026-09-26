"use client";

import Link from "next/link";
import { useEffect, useRef, useState, type KeyboardEvent, type PointerEvent } from "react";
import { RecipeImage } from "@/components/recipes/recipe-image";
import { Alert } from "@/components/ui/alert";
import { buttonClassName } from "@/components/ui/button";
import type { CandidateView, Decision } from "@/lib/services/weekly-plan";
import styles from "./plan.module.css";

type Props = {
  candidates: CandidateView[];
  target: number;
  week: string;
  decideAction: (candidateId: string, decision: Decision) => Promise<{ error?: string }>;
  regenerateSlot: React.ReactNode;
};

const SWIPE_THRESHOLD = 80;

/**
 * 10候補を1枚ずつ判断する。右（作る）/ 左（スキップ）のスワイプに加え、ボタン・矢印キーでも操作でき、直前の判断は戻せる。
 * 判断はすぐ画面に反映し、裏で保存する（失敗したら元に戻して理由を出す）。
 */
export function PlanDeck({ candidates, target, week, decideAction, regenerateSlot }: Props) {
  const [decisions, setDecisions] = useState<Record<string, Decision>>(() =>
    Object.fromEntries(candidates.map((c) => [c.id, c.decision])),
  );
  const [history, setHistory] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [dragX, setDragX] = useState(0);
  const dragStart = useRef<number | null>(null);
  const cardRef = useRef<HTMLDivElement>(null);

  const current = candidates.find((c) => decisions[c.id] === "PENDING") ?? null;
  const acceptedCount = candidates.filter((c) => decisions[c.id] === "ACCEPTED").length;
  const remaining = candidates.filter((c) => decisions[c.id] === "PENDING").length;

  useEffect(() => {
    cardRef.current?.focus({ preventScroll: true });
  }, [current?.id]);

  async function decide(candidate: CandidateView, decision: Decision) {
    setError(null);
    setDecisions((d) => ({ ...d, [candidate.id]: decision }));
    setHistory((h) => [...h, candidate.id]);
    setDragX(0);
    const result = await decideAction(candidate.id, decision).catch(() => ({ error: "通信に失敗しました。" }));
    if (result.error) {
      setDecisions((d) => ({ ...d, [candidate.id]: "PENDING" }));
      setHistory((h) => h.filter((id) => id !== candidate.id));
      setError(`${result.error}（「${candidate.name}」の判断は保存されていません）`);
    }
  }

  async function undo() {
    const last = history.at(-1);
    if (!last) return;
    const previous = decisions[last];
    setError(null);
    setHistory((h) => h.slice(0, -1));
    setDecisions((d) => ({ ...d, [last]: "PENDING" }));
    const result = await decideAction(last, "PENDING").catch(() => ({ error: "通信に失敗しました。" }));
    if (result.error) {
      setDecisions((d) => ({ ...d, [last]: previous }));
      setHistory((h) => [...h, last]);
      setError(`${result.error}（元に戻せませんでした）`);
    }
  }

  function onPointerDown(event: PointerEvent<HTMLDivElement>) {
    dragStart.current = event.clientX;
    event.currentTarget.setPointerCapture(event.pointerId);
  }
  function onPointerMove(event: PointerEvent<HTMLDivElement>) {
    if (dragStart.current !== null) setDragX(event.clientX - dragStart.current);
  }
  function onPointerUp() {
    if (dragStart.current === null || !current) return;
    dragStart.current = null;
    if (dragX > SWIPE_THRESHOLD) void decide(current, "ACCEPTED");
    else if (dragX < -SWIPE_THRESHOLD) void decide(current, "SKIPPED");
    else setDragX(0);
  }
  function onKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (!current) return;
    if (event.key === "ArrowRight") void decide(current, "ACCEPTED");
    if (event.key === "ArrowLeft") void decide(current, "SKIPPED");
  }

  const reasons = current?.breakdown.filter((item) => item.points > 0).slice(0, 3) ?? [];
  const cautions = current?.breakdown.filter((item) => item.points < 0).slice(0, 2) ?? [];

  return (
    <div className={styles.deck}>
      <p className={styles.progress} aria-live="polite">
        作る：<strong>{acceptedCount}</strong> / {target}品　残りの候補：{remaining}
      </p>

      {error ? <Alert tone="error">{error}</Alert> : null}

      {acceptedCount >= target ? (
        <Alert tone="success" title={`${target}品そろいました`}>
          <p>確認して決めると、副菜・汁物と買い物リストの準備に進めます。</p>
          <Link href={`/plan/confirm?week=${week}`} className={buttonClassName({ size: "large", block: true })}>
            {target}品を確認する
          </Link>
        </Alert>
      ) : null}

      {current ? (
        <div
          ref={cardRef}
          className={styles.card}
          style={{ transform: dragX ? `translateX(${dragX}px) rotate(${dragX / 30}deg)` : undefined }}
          data-direction={dragX > SWIPE_THRESHOLD ? "accept" : dragX < -SWIPE_THRESHOLD ? "skip" : undefined}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={() => {
            dragStart.current = null;
            setDragX(0);
          }}
          onKeyDown={onKeyDown}
          tabIndex={0}
          role="group"
          aria-roledescription="献立の候補"
          aria-label={`${current.name}。右矢印で作る、左矢印でスキップ`}
        >
          <RecipeImage url={current.imageUrl} name={current.name} className={styles.cardImage} />
          <div className={styles.cardBody}>
            <p className={styles.cardName}>{current.name}</p>
            <p className={styles.cardMeta}>
              {current.cookingMinutes ? <span>約{current.cookingMinutes}分</span> : null}
              {current.tags.slice(0, 3).map((t) => (
                <span key={t}>{t}</span>
              ))}
            </p>
            {reasons.length > 0 ? (
              <ul className={styles.reasons} aria-label="候補になった理由">
                {reasons.map((r) => (
                  <li key={r.label}>＋ {r.label}</li>
                ))}
                {cautions.map((r) => (
                  <li key={r.label} className={styles.caution}>
                    − {r.label}
                  </li>
                ))}
              </ul>
            ) : null}
            {current.notes.length > 0 ? <p className={styles.note}>{current.notes.join("・")}</p> : null}
          </div>
          <span className={styles.stamp} aria-hidden="true">
            {dragX > SWIPE_THRESHOLD ? "作る" : dragX < -SWIPE_THRESHOLD ? "スキップ" : ""}
          </span>
        </div>
      ) : acceptedCount < target ? (
        <Alert tone="info" title="候補をすべて見ました">
          <p>
            あと{target - acceptedCount}品です。候補を出し直すか、レシピ一覧から選んで追加できます。
          </p>
          <div className={styles.actions}>
            {regenerateSlot}
            <Link href={`/plan/add?week=${week}`} className={buttonClassName({ variant: "secondary", block: true })}>
              レシピから選んで追加する
            </Link>
          </div>
        </Alert>
      ) : null}

      {current ? (
        <div className={styles.buttons}>
          <button type="button" className={`${buttonClassName({ variant: "secondary", size: "large" })} ${styles.skip}`} onClick={() => void decide(current, "SKIPPED")}>
            ← スキップ
          </button>
          <button type="button" className={buttonClassName({ size: "large" })} onClick={() => void decide(current, "ACCEPTED")}>
            作る →
          </button>
        </div>
      ) : null}
      <div className={styles.subActions}>
        <button type="button" className={buttonClassName({ variant: "ghost", size: "small" })} onClick={() => void undo()} disabled={history.length === 0}>
          ↶ 1つ戻る
        </button>
        <Link href={`/plan/add?week=${week}`} className={buttonClassName({ variant: "ghost", size: "small" })}>
          レシピから追加
        </Link>
        {acceptedCount > 0 && acceptedCount < target ? (
          <Link href={`/plan/confirm?week=${week}`} className={buttonClassName({ variant: "ghost", size: "small" })}>
            選んだ料理を見る
          </Link>
        ) : null}
      </div>
    </div>
  );
}
