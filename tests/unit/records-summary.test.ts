import { describe, expect, it } from "vitest";
import { weeklyDinnerAverages, type MealHistoryRow } from "@/lib/records/summary";

const ME = "me";
const row = (eatenOn: string, kcal: number, complete = true): MealHistoryRow => ({
  id: eatenOn + kcal,
  eatenOn,
  dishes: [],
  nutrition: { [ME]: { energyKcal: kcal, complete }, partner: { energyKcal: 999, complete: true } },
});

describe("weeklyDinnerAverages", () => {
  // 2026-10-01 は木曜。今週は 2026-09-28（月）〜 10-04（日）
  const today = "2026-10-01";

  it("今週から新しい順に週ごとの平均を出し、本人の値だけを使う", () => {
    const result = weeklyDinnerAverages([row("2026-09-28", 600), row("2026-09-30", 800), row("2026-09-27", 500)], ME, today, 2);
    expect(result).toEqual([
      { weekStart: "2026-09-28", counted: 2, incomplete: 0, averageKcal: 700 },
      { weekStart: "2026-09-21", counted: 1, incomplete: 0, averageKcal: 500 },
    ]);
  });

  it("栄養の一部が未登録の夕食は平均に入れず、件数だけ数える", () => {
    const [week] = weeklyDinnerAverages([row("2026-09-29", 700), row("2026-09-30", 100, false)], ME, today, 1);
    expect(week).toEqual({ weekStart: "2026-09-28", counted: 1, incomplete: 1, averageKcal: 700 });
  });

  it("本人の写しが無い夕食（登録前の記録など）も未登録として扱う", () => {
    const noMe: MealHistoryRow = { id: "x", eatenOn: "2026-09-29", dishes: [], nutrition: {} };
    const [week] = weeklyDinnerAverages([noMe], ME, today, 1);
    expect(week).toEqual({ weekStart: "2026-09-28", counted: 0, incomplete: 1, averageKcal: null });
  });

  it("日曜は同じ週（月曜始まり）に入る", () => {
    const [week] = weeklyDinnerAverages([row("2026-10-04", 650)], ME, "2026-10-04", 1);
    expect(week.weekStart).toBe("2026-09-28");
    expect(week.averageKcal).toBe(650);
  });
});
