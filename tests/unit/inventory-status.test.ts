import { describe, expect, it } from "vitest";
import { describeFreshness, freshnessOf, freshnessPriority } from "@/lib/inventory/status";

describe("在庫の「そろそろ使いたい」", () => {
  it.each([
    // 購入日, 保存目安, 今日, 状態, 残り日数
    ["2026-09-28", 5, "2026-09-28", "FRESH", 5],
    ["2026-09-28", 5, "2026-09-30", "FRESH", 3],
    ["2026-09-28", 5, "2026-10-01", "USE_SOON", 2],
    ["2026-09-28", 5, "2026-10-03", "USE_SOON", 0],
    ["2026-09-28", 5, "2026-10-04", "PAST_ESTIMATE", -1],
    ["2026-09-28", 2, "2026-09-29", "USE_SOON", 1],
    ["2026-09-28", 1, "2026-09-28", "USE_SOON", 1],
    ["2026-09-28", 30, "2026-10-15", "FRESH", 13],
    ["2026-09-28", 30, "2026-10-19", "USE_SOON", 9],
  ] as const)("%s購入・目安%s日・今日%s → %s（残り%s日）", (purchased, days, today, status, left) => {
    expect(freshnessOf(purchased, days, today)).toEqual({ status, daysLeft: left });
  });

  it("保存目安が無い材料（調味料など）は判定しない", () => {
    expect(freshnessOf("2026-01-01", null, "2026-09-28")).toEqual({ status: "NO_ESTIMATE", daysLeft: null });
  });

  it("表示文言と優先度", () => {
    expect(describeFreshness({ status: "USE_SOON", daysLeft: 0 })).toBe("目安は今日まで");
    expect(describeFreshness({ status: "PAST_ESTIMATE", daysLeft: -2 })).toBe("目安を2日過ぎています");
    expect(describeFreshness({ status: "FRESH", daysLeft: 4 })).toBe("目安まであと4日");
    expect(freshnessPriority({ status: "PAST_ESTIMATE", daysLeft: -1 })).toBeLessThan(
      freshnessPriority({ status: "USE_SOON", daysLeft: 1 }),
    );
  });
});
