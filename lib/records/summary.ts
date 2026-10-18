import { addDays, tokyoWeekStart } from "@/lib/dates";

/**
 * 記録画面（Gate 8）の集計。副作用のない純粋関数。
 * - 週平均夕食カロリー：その週に「作った」夕食のうち、栄養の写しが完全なものだけの平均。
 *   一部が未登録の夕食は平均に入れず、件数だけ示す（推測で補わない）。
 */

export type MealHistoryRow = {
  id: string;
  eatenOn: string;
  dishes: { name: string; dishType: string | null }[];
  /** 利用者IDごとの栄養の写し（作ったときのDB計算） */
  nutrition: Record<string, { energyKcal: number; complete: boolean } | undefined>;
};

export type WeeklyAverage = {
  weekStart: string;
  /** 平均に使えた夕食の数 */
  counted: number;
  /** 栄養の一部が未登録で平均に入れなかった夕食の数 */
  incomplete: number;
  averageKcal: number | null;
};

/** 直近 weeks 週（今週を含む、新しい順）の週平均夕食カロリー */
export function weeklyDinnerAverages(rows: MealHistoryRow[], userId: string, today: string, weeks: number): WeeklyAverage[] {
  const thisWeek = tokyoWeekStart(new Date(`${today}T12:00:00+09:00`));
  const result: WeeklyAverage[] = [];
  for (let i = 0; i < weeks; i += 1) {
    const weekStart = addDays(thisWeek, -7 * i);
    const weekEnd = addDays(weekStart, 6);
    let sum = 0;
    let counted = 0;
    let incomplete = 0;
    for (const row of rows) {
      if (row.eatenOn < weekStart || row.eatenOn > weekEnd) continue;
      const mine = row.nutrition[userId];
      if (mine && mine.complete) {
        sum += mine.energyKcal;
        counted += 1;
      } else {
        incomplete += 1;
      }
    }
    result.push({ weekStart, counted, incomplete, averageKcal: counted > 0 ? Math.round(sum / counted) : null });
  }
  return result;
}

