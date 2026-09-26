/**
 * 在庫の状態（Gate 4）。購入日と材料の保存目安から「そろそろ使いたい」を算出する（仕様：賞味期限の都度入力はしない）。
 * 副作用のない関数。日付はAsia/Tokyoの暦日（YYYY-MM-DD）で受け取る。
 */
import { daysBetween } from "@/lib/dates";

export type FreshnessStatus = "NO_ESTIMATE" | "FRESH" | "USE_SOON" | "PAST_ESTIMATE";

export type Freshness = {
  status: FreshnessStatus;
  /** 保存目安までの残り日数（目安なしはnull。過ぎていれば負） */
  daysLeft: number | null;
};

/**
 * 残り日数が「保存目安の3割（最低1日）」以下で USE_SOON、0日未満で PAST_ESTIMATE。
 * 例：保存目安5日 → 残り2日以下でそろそろ使いたい。保存目安2日（肉）→ 残り1日以下。
 */
export function freshnessOf(purchasedOn: string, storageDays: number | null, today: string): Freshness {
  if (storageDays === null || storageDays <= 0) return { status: "NO_ESTIMATE", daysLeft: null };
  const daysLeft = storageDays - daysBetween(purchasedOn, today);
  if (daysLeft < 0) return { status: "PAST_ESTIMATE", daysLeft };
  const threshold = Math.max(1, Math.ceil(storageDays * 0.3));
  return { status: daysLeft <= threshold ? "USE_SOON" : "FRESH", daysLeft };
}

export const FRESHNESS_LABELS: Record<FreshnessStatus, string> = {
  NO_ESTIMATE: "目安なし",
  FRESH: "まだ大丈夫",
  USE_SOON: "そろそろ使いたい",
  PAST_ESTIMATE: "目安を過ぎています",
};

/** 表示用の説明（色だけに頼らない） */
export function describeFreshness(freshness: Freshness): string {
  if (freshness.daysLeft === null) return FRESHNESS_LABELS.NO_ESTIMATE;
  if (freshness.status === "PAST_ESTIMATE") return `目安を${-freshness.daysLeft}日過ぎています`;
  if (freshness.daysLeft === 0) return "目安は今日まで";
  return `目安まであと${freshness.daysLeft}日`;
}

/** 優先度（小さいほど先に使いたい）。一覧の並び順・献立の並び替えに使う */
export function freshnessPriority(freshness: Freshness): number {
  switch (freshness.status) {
    case "PAST_ESTIMATE":
      return 0;
    case "USE_SOON":
      return 1;
    case "FRESH":
      return 2;
    default:
      return 3;
  }
}
