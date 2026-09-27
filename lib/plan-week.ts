import { addDays, tokyoWeekStart } from "@/lib/dates";

/** 計画できる週：今週と来週だけ（URLの week= を検証する） */
export function resolvePlanWeek(value: unknown, now: Date = new Date()): string {
  const current = tokyoWeekStart(now);
  const next = addDays(current, 7);
  return value === next ? next : current;
}

export function planWeekLabel(weekStart: string, now: Date = new Date()): string {
  return weekStart === tokyoWeekStart(now) ? "今週" : "来週";
}
