import { addDays, tokyoWeekStart } from "@/lib/dates";

/**
 * 記録画面（Gate 8）の集計。副作用のない純粋関数。
 * - 週平均夕食カロリー：その週に「作った」夕食のうち、本人の栄養の写しが完全なものだけの平均。
 *   一部が未登録の夕食は平均に入れず、件数だけ示す（推測で補わない）。
 * - 体重の推移：グラフ用に日付順へ並べ、表示範囲の最小・最大を出す。
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

export type WeightPoint = { measuredOn: string; weightKg: number };

export type WeightSeries = {
  points: WeightPoint[];
  minKg: number;
  maxKg: number;
  latest: WeightPoint | null;
  /** 表示範囲の最初の記録からの増減（kg、小数1桁） */
  change: number | null;
};

/** 表示範囲（from〜to）の体重を日付順に並べる。記録が無ければ points は空 */
export function weightSeries(records: WeightPoint[], from: string, to: string): WeightSeries {
  const points = records
    .filter((r) => r.measuredOn >= from && r.measuredOn <= to)
    .sort((a, b) => (a.measuredOn < b.measuredOn ? -1 : a.measuredOn > b.measuredOn ? 1 : 0));
  if (points.length === 0) return { points, minKg: 0, maxKg: 0, latest: null, change: null };
  const weights = points.map((p) => p.weightKg);
  const first = points[0];
  const latest = points[points.length - 1];
  return {
    points,
    minKg: Math.min(...weights),
    maxKg: Math.max(...weights),
    latest,
    change: points.length > 1 ? Math.round((latest.weightKg - first.weightKg) * 10) / 10 : null,
  };
}

/** 体重の入力（全角数字・小数点も受け付ける）。範囲外はnull */
export function parseWeightKg(input: string): number | null {
  const text = input.normalize("NFKC").trim();
  if (!/^\d{1,3}(\.\d)?$/.test(text)) return null;
  const value = Number(text);
  return value >= 20 && value <= 300 ? value : null;
}
