import { describe, expect, it } from "vitest";
import { parseComponentValue, parseCsv, readFoodRows } from "@/scripts/nutrition/food-csv.mts";

describe("食品成分表CSVの読み取り", () => {
  it("引用符・カンマ・改行を含むCSVを読む", () => {
    expect(parseCsv('a,"b,c","d""e"\r\n1,2,3\n')).toEqual([
      ["a", "b,c", 'd"e'],
      ["1", "2", "3"],
    ]);
  });

  it("成分表の表記（Tr・推定値・値なし）を数値へ", () => {
    expect(parseComponentValue("Tr")).toBe(0);
    expect(parseComponentValue("(0.3)")).toBe(0.3);
    expect(parseComponentValue("１２．５")).toBe(12.5);
    expect(parseComponentValue("-")).toBeNull();
    expect(parseComponentValue("")).toBeNull();
  });

  it("必要な列を読み、値の欠けた行は取り込まない（架空のデータ）", () => {
    const csv = [
      "food_number,name,energy_kcal,protein_g,fat_g,carbs_g",
      "1,テスト食品A,100,(2.0),Tr,20",
      "00002,テスト食品B,-,1,1,1",
      "x,不正,1,1,1,1",
    ].join("\n");
    const { rows, skipped } = readFoodRows(csv);
    expect(rows).toEqual([{ foodNumber: "00001", name: "テスト食品A", energyKcal: 100, proteinG: 2, fatG: 0, carbsG: 20 }]);
    expect(skipped).toHaveLength(2);
  });

  it("必要な見出しが無ければ理由を示して止める", () => {
    expect(() => readFoodRows("food_number,name\n1,a")).toThrow("energy_kcal");
  });
});
