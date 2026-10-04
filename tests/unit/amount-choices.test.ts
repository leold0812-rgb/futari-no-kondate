import { describe, expect, it } from "vitest";
import { canonicalUnit, quantityChoices, quantityForUnit, quantityLabel, quantityMode, unitLabel, unitOptions } from "@/lib/units/amount-choices";

describe("quantityMode", () => {
  it.each([
    ["個", "choice"],
    ["本", "choice"],
    ["大さじ", "choice"],
    ["小さじ", "choice"],
    ["カップ", "choice"],
    ["g", "number"],
    ["ml", "number"],
    ["kg", "number"],
    ["少々", "none"],
    ["適量", "none"],
    ["", "none"],
    ["ひとかけ", "number"],
  ])("%s → %s", (unit, mode) => {
    expect(quantityMode(unit)).toBe(mode);
  });
});

describe("quantityChoices", () => {
  it("個数は 1/4・1/2・1・1と1/2・2〜10", () => {
    expect(quantityChoices("個", null).map(quantityLabel)).toEqual(["1/4", "1/2", "1", "1と1/2", "2", "3", "4", "5", "6", "7", "8", "9", "10"]);
  });

  it("大さじ・小さじは 1/2 刻みで5まで（1/4も選べる）", () => {
    expect(quantityChoices("大さじ", null).map(quantityLabel)).toEqual(["1/4", "1/2", "1", "1と1/2", "2", "2と1/2", "3", "3と1/2", "4", "4と1/2", "5"]);
  });

  it("取り込んだ値が選択肢に無ければ足す（失わない）", () => {
    expect(quantityChoices("個", 12)).toContain(12);
    expect(quantityChoices("枚", 20).at(-1)).toBe(20);
    expect(quantityChoices("個", 2)).toHaveLength(13);
  });
});

describe("unitOptions", () => {
  it("よく使う単位を先に、取り込んだ未知の単位はその行にだけ足す", () => {
    expect(unitOptions("g").primary).toEqual(["個", "g", "ml", "大さじ", "小さじ"]);
    expect(unitOptions("株").other[0]).toBe("株");
    expect(unitOptions("g").other).not.toContain("株");
    expect(unitOptions("ひとつまみ").none).toContain("ひとつまみ");
  });

  it("mlは「mL」と表示する", () => {
    expect(unitLabel("ml")).toBe("mL");
    expect(unitLabel("g")).toBe("g");
  });
});

describe("canonicalUnit / quantityForUnit", () => {
  it("表記ゆれを選択肢の値へそろえる", () => {
    expect(canonicalUnit("cc")).toBe("ml");
    expect(canonicalUnit("大匙")).toBe("大さじ");
    expect(canonicalUnit(null)).toBe("");
    expect(canonicalUnit("ひとかけ")).toBe("ひとかけ");
  });

  it("単位を変えたときの数量", () => {
    expect(quantityForUnit("少々", "2")).toBe("");
    expect(quantityForUnit("g", "2")).toBe("2");
    expect(quantityForUnit("個", "300")).toBe("1");
    expect(quantityForUnit("個", "")).toBe("1");
    expect(quantityForUnit("大さじ", "1.5")).toBe("1.5");
    expect(quantityForUnit("大さじ", "7")).toBe("1");
  });
});
