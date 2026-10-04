/**
 * 材料の分量を「単位を選ぶ → 数量を選ぶ／入力する」で入れるための選択肢（副作用のない関数）。
 * 仕事後に文字を打つ量を減らすため、よく使う単位と数量は選ぶだけにする。
 *   - 個数の単位（個・本・枚…）：1/4・1/2・1・1と1/2・2〜10 から選ぶ
 *   - 大さじ・小さじ・カップ：1/4・1/2・1〜5（1/2刻み）から選ぶ
 *   - g・mL など：数字を入力する
 *   - 少々・適量：数量なし
 * 取り込んだレシピの値が選択肢に無い場合（12個、小さじ1/3 など）は、その値を選択肢に足して失わない。
 */
import { UNQUANTIFIED_WORDS, formatNumber, normalizeUnit, unitKind } from "./index";

/** 上に並べる、よく使う単位 */
export const PRIMARY_UNITS = ["個", "g", "ml", "大さじ", "小さじ"] as const;
/** そのほかの単位（買い物で数えやすい単位。取り込んだレシピによく出る） */
export const OTHER_UNITS = ["本", "枚", "片", "束", "パック", "袋", "缶", "丁", "カップ", "kg"] as const;
/** 数量を持たない分量 */
export const NO_QUANTITY_UNITS = ["少々", "適量"] as const;

export type QuantityMode = "none" | "number" | "choice";

const COUNT_CHOICES = [0.25, 0.5, 1, 1.5, 2, 3, 4, 5, 6, 7, 8, 9, 10];
const SPOON_CHOICES = [0.25, 0.5, 1, 1.5, 2, 2.5, 3, 3.5, 4, 4.5, 5];
const SPOON_UNITS = new Set(["大さじ", "小さじ", "カップ"]);

/** 画面に出す単位名（mlだけ「mL」と表示する） */
export function unitLabel(unit: string): string {
  return unit === "ml" ? "mL" : unit;
}

/** 取り込んだ値を選択肢の値へそろえる（表記ゆれは正規の単位へ。知らない単位はそのまま） */
export function canonicalUnit(unit: string | null | undefined): string {
  const trimmed = unit?.trim() ?? "";
  return normalizeUnit(trimmed) ?? trimmed;
}

export function isNoQuantityUnit(unit: string): boolean {
  return (UNQUANTIFIED_WORDS as readonly string[]).includes(unit);
}

/** その単位の数量の入れ方 */
export function quantityMode(unit: string): QuantityMode {
  if (unit === "" || isNoQuantityUnit(unit)) return "none";
  if (SPOON_UNITS.has(unit) || unitKind(unit) === "count") return "choice";
  return "number";
}

/** 単位の選択肢。いまの単位が一覧に無ければ（取り込んだ「株」「1片(10g)」など）その行にだけ足す */
export function unitOptions(current: string): { primary: string[]; other: string[]; none: string[] } {
  const other: string[] = [...OTHER_UNITS];
  const none: string[] = [...NO_QUANTITY_UNITS];
  const known = new Set<string>([...PRIMARY_UNITS, ...OTHER_UNITS, ...NO_QUANTITY_UNITS]);
  if (current && !known.has(current)) {
    if (isNoQuantityUnit(current)) none.push(current);
    else other.unshift(current);
  }
  return { primary: [...PRIMARY_UNITS], other, none };
}

/** 数量の選択肢（choiceの単位だけ）。いまの値が一覧に無ければ足す */
export function quantityChoices(unit: string, current: number | null): number[] {
  const base = SPOON_UNITS.has(unit) ? SPOON_CHOICES : COUNT_CHOICES;
  if (current === null || !Number.isFinite(current) || current <= 0 || base.some((v) => Math.abs(v - current) < 0.001)) return base;
  return [...base, current].sort((a, b) => a - b);
}

/** 「1/2」「1と1/2」「3」のような数量の表示 */
export function quantityLabel(value: number): string {
  return formatNumber(value, true);
}

/**
 * 単位を変えたときの数量。数量なしの単位では消し、選ぶ単位では選択肢に無ければ1にする。
 * 数字を入力する単位では、いまの値をそのまま残す（空なら空）。
 */
export function quantityForUnit(nextUnit: string, current: string): string {
  const mode = quantityMode(nextUnit);
  if (mode === "none") return "";
  if (mode === "number") return current;
  const value = Number(current);
  const valid = current !== "" && Number.isFinite(value) && quantityChoices(nextUnit, null).some((v) => Math.abs(v - value) < 0.001);
  return valid ? String(value) : "1";
}
