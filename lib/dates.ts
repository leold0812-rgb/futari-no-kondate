/**
 * 日付の扱い（仕様の合理的仮定1：週はAsia/Tokyoの月曜00:00〜日曜23:59）。副作用のない関数。
 * サーバー（UTCで動く）でも端末の時刻設定に依存せず、常に日本時間で計算する。
 */

const TOKYO_OFFSET_MS = 9 * 60 * 60 * 1000;

/** 日本時間の暦日（YYYY-MM-DD） */
export function tokyoDate(now: Date = new Date()): string {
  return new Date(now.getTime() + TOKYO_OFFSET_MS).toISOString().slice(0, 10);
}

/** 日本時間のその日の00:00をUTCのDateで返す */
export function startOfTokyoDay(now: Date = new Date()): Date {
  return new Date(`${tokyoDate(now)}T00:00:00+09:00`);
}

/** その日を含む週の月曜（日本時間、YYYY-MM-DD） */
export function tokyoWeekStart(now: Date = new Date()): string {
  const date = new Date(`${tokyoDate(now)}T00:00:00Z`);
  const day = date.getUTCDay(); // 0=日曜
  const diff = day === 0 ? -6 : 1 - day;
  date.setUTCDate(date.getUTCDate() + diff);
  return date.toISOString().slice(0, 10);
}

/** YYYY-MM-DD に日数を足す */
export function addDays(isoDate: string, days: number): string {
  const date = new Date(`${isoDate}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

/** 2つの暦日の差（b - a、日数） */
export function daysBetween(a: string, b: string): number {
  return Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86_400_000);
}

/** 画面表示用「9月28日(月)」 */
export function formatJapaneseDate(isoDate: string): string {
  const date = new Date(`${isoDate}T00:00:00Z`);
  const weekday = ["日", "月", "火", "水", "木", "金", "土"][date.getUTCDay()];
  return `${date.getUTCMonth() + 1}月${date.getUTCDate()}日(${weekday})`;
}
