import type { Metadata } from "next";
import styles from "@/components/records/records.module.css";
import { Alert } from "@/components/ui/alert";
import { LinkButton } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { PageHeader } from "@/components/ui/page-header";
import { requireMember } from "@/lib/auth/session";
import { addDays, formatJapaneseDate, tokyoDate } from "@/lib/dates";
import { weeklyDinnerAverages } from "@/lib/records/summary";
import { getMealHistories } from "@/lib/services/records";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "記録 | ふたりの献立" };

const WEEKS = 4;
const HISTORY_LIMIT = 30;

export default async function RecordsPage() {
  const member = await requireMember();
  const supabase = await createSupabaseServerClient();
  const today = tokyoDate();
  const histories = await getMealHistories(supabase, addDays(today, -7 * WEEKS - 7));
  const averages = histories.ok ? weeklyDinnerAverages(histories.data, member.userId, today, WEEKS) : null;

  return (
    <>
      <PageHeader
        title="記録"
        action={
          <LinkButton href="/settings" variant="secondary" size="small">
            設定
          </LinkButton>
        }
      />
      <div className={styles.stack}>
        <Card aria-labelledby="average-heading">
          <h2 id="average-heading" className={styles.heading}>
            夕食のカロリー（週平均）
          </h2>
          <p className={styles.muted}>「作った」を押した夕食の、1人分（ご飯を含む）の平均です。</p>
          {!averages ? (
            <Alert tone="error">食事の記録を読み込めませんでした。通信状態を確かめて、画面を開き直してください。</Alert>
          ) : (
            <ul className={styles.weeks}>
              {averages.map((week, i) => (
                <li key={week.weekStart} className={styles.week}>
                  <span>{i === 0 ? "今週" : `${formatJapaneseDate(week.weekStart)}の週`}</span>
                  <span className={styles.weekValue}>
                    {week.averageKcal !== null ? `${week.averageKcal}kcal` : "—"}
                    <span className={styles.note}>
                      {week.counted + week.incomplete === 0
                        ? "記録なし"
                        : `${week.counted}回の平均${week.incomplete > 0 ? `（栄養が一部未登録の${week.incomplete}回は除く）` : ""}`}
                    </span>
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card aria-labelledby="history-heading">
          <h2 id="history-heading" className={styles.heading}>
            食事の履歴
          </h2>
          {!histories.ok ? (
            <Alert tone="error">食事の履歴を読み込めませんでした。通信状態を確かめて、画面を開き直してください。</Alert>
          ) : histories.data.length === 0 ? (
            <p className={styles.muted}>まだ履歴がありません。献立で「作った」を押すと、ここに残ります。</p>
          ) : (
            <ul className={styles.history}>
              {histories.data.slice(0, HISTORY_LIMIT).map((h) => {
                const mine = h.nutrition[member.userId];
                return (
                  <li key={h.id} className={styles.historyItem}>
                    <span className={styles.historyDate}>{formatJapaneseDate(h.eatenOn)}</span>
                    <span>
                      {h.dishes.map((d) => d.name).join("・")}
                    </span>
                    <span className={styles.muted}>
                      {mine ? (mine.complete ? `${mine.energyKcal}kcal` : `${mine.energyKcal}kcal以上（一部未登録）`) : "栄養の記録なし"}
                    </span>
                  </li>
                );
              })}
            </ul>
          )}
        </Card>
      </div>
    </>
  );
}
