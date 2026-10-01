import { describe, expect, it } from "vitest";
import {
  convertQuantity,
  formatBaseQuantity,
  formatQuantity,
  normalizeUnit,
  parseAmount,
  scaleQuantity,
  toBaseQuantity,
  unitGroup,
} from "@/lib/units";

describe("単位の正規化", () => {
  it.each([
    ["g", "g"],
    ["ｇ", "g"],
    ["グラム", "g"],
    ["cc", "ml"],
    ["ｃｃ", "ml"],
    ["mL", "ml"],
    ["大匙", "大さじ"],
    ["コ", "個"],
    ["かけ", "片"],
  ])("%s → %s", (raw, code) => {
    expect(normalizeUnit(raw)).toBe(code);
  });

  it("知らない単位・空はnull", () => {
    expect(normalizeUnit("ふさ")).toBeNull();
    expect(normalizeUnit("")).toBeNull();
    expect(normalizeUnit(null)).toBeNull();
  });
});

describe("互換単位だけを換算する", () => {
  it("質量どうし・体積どうしは換算できる", () => {
    expect(convertQuantity(1.5, "kg", "g")).toBe(1500);
    expect(convertQuantity(2, "大さじ", "小さじ")).toBe(6);
    expect(convertQuantity(1, "カップ", "ml")).toBe(200);
    expect(toBaseQuantity(3, "大さじ")).toBe(45);
  });

  it("質量と体積、異なる個数単位は換算しない（誤った合算をしない）", () => {
    expect(convertQuantity(100, "g", "ml")).toBeNull();
    expect(convertQuantity(1, "個", "本")).toBeNull();
    expect(convertQuantity(1, "個", "g")).toBeNull();
  });

  it("未知の単位は同じ表記どうしだけ同一とみなす", () => {
    expect(convertQuantity(2, "ふさ", "ふさ")).toBe(2);
    expect(convertQuantity(2, "ふさ", "房")).toBeNull();
  });

  it("合算グループ", () => {
    expect(unitGroup("kg")).toBe("mass");
    expect(unitGroup("小さじ")).toBe("volume");
    expect(unitGroup("コ")).toBe("count:個");
    expect(unitGroup("ふさ")).toBe("other:ふさ");
    expect(unitGroup(null)).toBe("none");
  });
});

describe("表示", () => {
  it.each([
    [200, "g", "200g"],
    [1.5, "大さじ", "大さじ1と1/2"],
    [0.5, "個", "1/2個"],
    [0.25, "小さじ", "小さじ1/4"],
    [2.3, "本", "2.3本"],
    [null, "少々", "少々"],
  ])("%s %s → %s", (quantity, unit, text) => {
    expect(formatQuantity(quantity, unit)).toBe(text);
  });

  it("合算結果は読みやすい単位で見せる", () => {
    expect(formatBaseQuantity(1200, "mass")).toBe("1.2kg");
    expect(formatBaseQuantity(450, "mass")).toBe("450g");
    expect(formatBaseQuantity(10, "volume")).toBe("小さじ2");
    expect(formatBaseQuantity(45, "volume")).toBe("大さじ3");
    expect(formatBaseQuantity(300, "volume")).toBe("300ml");
    expect(formatBaseQuantity(3, "count:個")).toBe("3個");
  });
});

describe("人数換算", () => {
  it("個数系は0.25刻み、それ以外は小数2桁（10以上は整数）", () => {
    expect(scaleQuantity(1, 1.5, "個")).toBe(1.5);
    expect(scaleQuantity(1, 1 / 3, "個")).toBe(0.25);
    expect(scaleQuantity(300, 0.5, "g")).toBe(150);
    expect(scaleQuantity(1, 0.5, "大さじ")).toBe(0.5);
    expect(scaleQuantity(null, 2, "少々")).toBeNull();
  });
});

describe("分量文字列の解析", () => {
  it.each([
    ["200g", 200, "g"],
    ["200 g", 200, "g"],
    ["大さじ1と1/2", 1.5, "大さじ"],
    ["小さじ1/2", 0.5, "小さじ"],
    ["1/2個", 0.5, "個"],
    ["½個", 0.5, "個"],
    ["２本", 2, "本"],
    ["2〜3個", 2, "個"],
    ["1カップ", 1, "カップ"],
    ["300cc", 300, "ml"],
    ["1片", 1, "片"],
    ["3", 3, null],
  ])("%s → %s %s", (raw, quantity, unit) => {
    expect(parseAmount(raw)).toEqual({ quantity, unit });
  });

  it("数えられない分量は数量なし", () => {
    expect(parseAmount("少々")).toEqual({ quantity: null, unit: "少々" });
    expect(parseAmount("適量")).toEqual({ quantity: null, unit: "適量" });
  });

  it("解釈できない文字列は単位として残す", () => {
    expect(parseAmount("お好みの量")).toEqual({ quantity: null, unit: "お好みの量" });
    expect(parseAmount("")).toEqual({ quantity: null, unit: null });
  });
});

describe("parseAmount（略記・補足）", () => {
  it.each([
    ["大1", 1, "大さじ"],
    ["小1/2", 0.5, "小さじ"],
    ["大さじ2杯", 2, "大さじ"],
    ["1片(10g)", 1, "片"],
    ["1/2個分", 0.5, "個"],
    ["1/2本分", 0.5, "本"],
  ])("%s → %s %s", (input, quantity, unit) => {
    expect(parseAmount(input)).toEqual({ quantity, unit });
  });

  it("「大2個」は大きめ2個の意味かもしれないので、大さじとして読まない", () => {
    expect(parseAmount("大2個").unit).not.toBe("大さじ");
  });
});
