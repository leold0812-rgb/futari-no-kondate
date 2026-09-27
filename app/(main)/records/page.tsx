import type { Metadata } from "next";
import { WeightChart } from "@/components/records/weight-chart";
import { WeightForm } from "@/components/records/weight-form";
import styles from "@/components/records/records.module.css";
import { Alert } from "@/components/ui/alert";
import { Button, LinkButton } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { PageHeader } from "@/components/ui/page-header";
import { requireMember } from "@/lib/auth/session";
import { addDays, formatJapaneseDate, tokyoDate } from "@/lib/dates";
import { weeklyDinnerAverages, weightSeries } from "@/lib/records/summary";
import { getMealHistories, getMyWeights } from "@/lib/services/records";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { deleteWeightAction, saveWeightAction } from "./actions";

export const metadata: Metadata = { title: "記録 | ふたりの献立" };

const WEEKS = 4;
const WEIGHT_DAYS = 90;
const HISTORY_LIMIT = 30;

export default async function RecordsPage() {
  const member = await requireMember();
  const supabase = await createSupabaseServerClient();
  const today = tokyoDate();
  const weightFrom = addDays(today, -(WEIGHT_DAYS - 1));
  const [histories, weights] = await Promise.all([
    getMealHistories(supabase, addDays(today, -7 * WEEKS - 7)),
    getMyWeights(supabase, member, weightFrom),
  ]);
  const series = weights.ok ? weightSeries(weights.data, weightFrom, today) : null;
  const averages = histories.ok ? weeklyDinnerAverages(histories.data, member.userId, today, WEEKS) : null;
  const recentWeights = weights.ok ? [...weights.data].reverse().slice(0, 5) : [];

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
        <Card aria-labelledby="weight-heading">
          <h2 id="weight-heading" className={styles.heading}>
            自分の体重
          </h2>
          <p className={styles.private}>🔒 あなただけが見られます。相手には表示されません。</p>
          {!series ? (
            <Alert tone="error">体重の記録を読み込めませんでした。通信状態を確かめて、画面を開き直してください。</Alert>
          ) : series.latest ? (
            <>
              <p className={styles.latest}>
                <span className={styles.latestValue}>{series.latest.weightKg.toFixed(1)}kg</span>
                <span className={styles.muted}>
                  {formatJapaneseDate(series.latest.measuredOn)}
                  {series.change !== null
                    ? `・${WEIGHT_DAYS}日間で${series.change > 0 ? "+" : series.change < 0 ? "−" : "±"}${Math.abs(series.change).toFixed(1)}kg`
                    : ""}
                </span>
              </p>
              <WeightChart series={series} from={weightFrom} to={today} />
            </>
          ) : (
            <p className={styles.muted}>まだ記録がありません。測った日に入力すると、ここに推移が表示されます。</p>
          )}
          <WeightForm action={saveWeightAction} today={today} />
          {recentWeights.length > 0 ? (
            <details>
              <summary>最近の記録を直す</summary>
              <ul className={styles.recent}>
                {recentWeights.map((w) => (
                  <li key={w.measuredOn} className={styles.recentItem}>
                    <span>
                      {formatJapaneseDate(w.measuredOn)}　{w.weightKg.toFixed(1)}kg
                    </span>
                    <form action={deleteWeightAction.bind(null, w.measuredOn)}>
                      <Button type="submit" variant="ghost" size="small" aria-label={`${formatJapaneseDate(w.measuredOn)}の記録を消す`}>
                        消す
                      </Button>
                    </form>
                  </li>
                ))}
              </ul>
              <p className={styles.muted}>値を直すときは、同じ日付でもう一度記録すると上書きされます。</p>
            </details>
          ) : null}
        </Card>

        <Card aria-labelledby="average-heading">
          <h2 id="average-heading" className={styles.heading}>
            夕食のカロリー（週平均）
          </h2>
          <p className={styles.muted}>「作った」を押した夕食の、あなたの1人分（ご飯を含む）の平均です。</p>
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
