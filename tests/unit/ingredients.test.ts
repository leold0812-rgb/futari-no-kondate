import { describe, expect, it } from "vitest";
import { DEFAULT_STORAGE_DAYS, guessIngredientCategory, normalizeIngredientName, splitIngredientLine } from "@/lib/ingredients";

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
    ["牛乳", "EGG_DAIRY"],
    ["牛こま切れ肉", "MEAT"],
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

describe("splitIngredientLine（区切りなしの書き方）", () => {
  it.each([
    ["鶏もも肉300g", "鶏もも肉", "300g"],
    ["卵2個", "卵", "2個"],
    ["醤油大さじ1", "醤油", "大さじ1"],
    ["砂糖小1/2", "砂糖", "小1/2"],
    ["みりん大2", "みりん", "大2"],
    ["塩少々", "塩", "少々"],
    ["じゃがいも大2個", "じゃがいも大", "2個"],
  ])("%s → %s / %s", (line, rawName, amount) => {
    expect(splitIngredientLine(line)).toEqual({ rawName, amount });
  });

  it("説明の数字（2cm幅など）を分量と取り違えない", () => {
    expect(splitIngredientLine("豚こま肉(2cm幅)")).toEqual({ rawName: "豚こま肉(2cm幅)", amount: "" });
  });

  it("大根のように「大」で始まる名前を略記と取り違えない", () => {
    expect(splitIngredientLine("大根1本")).toEqual({ rawName: "大根", amount: "1本" });
  });
});
