import { describe, expect, it } from "vitest";
import { addDays, daysBetween, formatJapaneseDate, startOfTokyoDay, tokyoDate, tokyoWeekStart } from "@/lib/dates";

describe("日本時間の日付", () => {
  it("UTCでは前日でも日本時間の日付を返す", () => {
    expect(tokyoDate(new Date("2026-09-27T15:30:00Z"))).toBe("2026-09-28");
    expect(tokyoDate(new Date("2026-09-27T14:59:59Z"))).toBe("2026-09-27");
  });

  it("日本時間の0時", () => {
    expect(startOfTokyoDay(new Date("2026-09-27T15:30:00Z")).toISOString()).toBe("2026-09-27T15:00:00.000Z");
  });

  it.each([
    ["2026-09-28T01:00:00+09:00", "2026-09-28"],
    ["2026-10-04T23:59:00+09:00", "2026-09-28"],
    ["2026-10-05T00:00:00+09:00", "2026-10-05"],
    ["2026-10-01T12:00:00+09:00", "2026-09-28"],
  ])("%s の週は月曜 %s から", (now, monday) => {
    expect(tokyoWeekStart(new Date(now))).toBe(monday);
  });

  it("日数の加算・差・表示", () => {
    expect(addDays("2026-09-28", 6)).toBe("2026-10-04");
    expect(daysBetween("2026-09-28", "2026-10-04")).toBe(6);
    expect(formatJapaneseDate("2026-09-28")).toBe("9月28日(月)");
  });
});
