import { describe, expect, it } from "vitest";
import { DEFAULT_STORAGE_DAYS, guessIngredientCategory, normalizeIngredientName } from "@/lib/ingredients";

describe("材料名の正規化", () => {
  it.each([
    ["玉ねぎ（中）", "玉ねぎ"],
    ["★醤油", "醤油"],
    ["(A)みりん", "みりん"],
    ["A みりん", "みりん"],
    ["鶏もも肉(皮なし)", "鶏もも肉"],
    ["  にんじん  ", "にんじん"],
    ["ＡＢＣソース", "ABCソース"],
    ["【たれ】", null],
  ])("%s → %s", (raw, expected) => {
    expect(normalizeIngredientName(raw)).toBe(expected);
  });
});

describe("カテゴリの推定", () => {
  it.each([
    ["鶏もも肉", "MEAT"],
    ["豚こま切れ肉", "MEAT"],
    ["生鮭", "FISH"],
    ["玉ねぎ", "VEGETABLE"],
    ["しょうゆ", "SEASONING"],
    ["サラダ油", "SEASONING"],
    ["卵", "EGG_DAIRY"],
    ["絹豆腐", "SOY"],
    ["冷凍うどん", "FROZEN"],
    ["ツナ缶", "DRY_CANNED"],
    ["うどん", "GRAIN"],
    ["謎の材料", "OTHER"],
    ["油揚げ", "SOY"],
    ["塩鮭", "FISH"],
    ["米酢", "SEASONING"],
    ["鶏ガラスープの素", "SEASONING"],
    ["ごま油", "SEASONING"],
    ["いりごま", "SEASONING"],
  ])("%s → %s", (name, category) => {
    expect(guessIngredientCategory(name)).toBe(category);
  });

  it("調味料・乾物は保存目安を持たない（在庫の「そろそろ使いたい」に出さない）", () => {
    expect(DEFAULT_STORAGE_DAYS.SEASONING).toBeNull();
    expect(DEFAULT_STORAGE_DAYS.DRY_CANNED).toBeNull();
    expect(DEFAULT_STORAGE_DAYS.FISH).toBe(1);
  });
});
