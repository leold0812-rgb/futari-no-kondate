import { describe, expect, it } from "vitest";
import { safeNextPath, isPublicPath } from "@/lib/auth/paths";
import { deriveSourceKey, hashPin, isPinFormat, validateNewPin, validatePepper, verifyPin } from "@/lib/auth/pin";
import { describeLoginFailure } from "@/lib/auth/pin-login";

const pepper = "p".repeat(40);

describe("PINの形式", () => {
  it.each(["123457", "000001", "9081726354", "123456789012"])("%s はログイン入力として受け付ける", (pin) => {
    expect(isPinFormat(pin)).toBe(true);
  });

  it.each(["12345", "1234567890123", "12a456", "１２３４５６", " 123456", ""])("%j は受け付けない", (pin) => {
    expect(isPinFormat(pin)).toBe(false);
  });

  it.each([
    ["000000", "同じ数字"],
    ["1111111", "同じ数字"],
  ])("新しいPIN %s は推測されやすいため拒否する（%s）", (pin, reason) => {
    expect(validateNewPin(pin)).toMatch(reason);
  });

  it("推測されにくいPINは設定できる", () => {
    expect(validateNewPin("274951")).toBeNull();
  });

  it.each(["123456", "654321", "890123"])("連番のPIN %s も設定できる（利用者の指示）", (pin) => {
    expect(validateNewPin(pin)).toBeNull();
  });

  it("pepperは32文字以上を必須にする", () => {
    expect(validatePepper("x".repeat(31))).not.toBeNull();
    expect(validatePepper("x".repeat(32))).toBeNull();
  });
});

describe("PINのハッシュと照合", () => {
  it("正しいPINだけが照合に成功する", async () => {
    const stored = await hashPin("274951", pepper);
    expect(stored).toMatch(/^scrypt\$1\$32768\$8\$1\$/);
    expect(stored).not.toContain("274951");
    await expect(verifyPin("274951", pepper, stored)).resolves.toBe(true);
    await expect(verifyPin("274952", pepper, stored)).resolves.toBe(false);
  });

  it("pepperが違えば照合に失敗する（DBのハッシュだけでは検証できない）", async () => {
    const stored = await hashPin("274951", pepper);
    await expect(verifyPin("274951", "q".repeat(40), stored)).resolves.toBe(false);
  });

  it("同じPINでも毎回saltが異なる", async () => {
    expect(await hashPin("274951", pepper)).not.toBe(await hashPin("274951", pepper));
  });

  it("保存値が無い・壊れている・過大なパラメータの場合は失敗として扱う", async () => {
    await expect(verifyPin("274951", pepper, null)).resolves.toBe(false);
    await expect(verifyPin("274951", pepper, "scrypt$1$broken")).resolves.toBe(false);
    const stored = await hashPin("274951", pepper);
    const huge = stored.replace("$32768$", "$1048576$");
    await expect(verifyPin("274951", pepper, huge)).resolves.toBe(false);
  });

  it("送信元キーはIPを含まず、pepperごとに異なる", () => {
    const key = deriveSourceKey("203.0.113.5", pepper);
    expect(key).toMatch(/^[0-9a-f]{64}$/);
    expect(key).not.toContain("203.0.113.5");
    expect(deriveSourceKey("203.0.113.5", "q".repeat(40))).not.toBe(key);
  });
});

describe("ログイン失敗の文言", () => {
  it("送信元の制限中は再試行までのおおよその分数を示す", () => {
    expect(describeLoginFailure({ ok: false, reason: "locked", retryAfterSeconds: 61 })).toContain("約2分後");
  });

  it("PIN違いでは、ロックの警告を出さずに入力し直しを促す", () => {
    const message = describeLoginFailure({ ok: false, reason: "wrong_pin" });
    expect(message).toContain("もう一度入力");
    expect(message).not.toContain("5回");
  });
});

describe("ログイン前に開けるpathと戻り先", () => {
  it("ログイン画面とオフライン画面だけが公開", () => {
    expect(isPublicPath("/login")).toBe(true);
    expect(isPublicPath("/offline")).toBe(true);
    expect(isPublicPath("/")).toBe(false);
    expect(isPublicPath("/recipes")).toBe(false);
  });

  it.each([
    ["/recipes?q=1", "/recipes?q=1"],
    ["https://evil.example", "/"],
    ["//evil.example", "/"],
    ["/\\evil.example", "/"],
    ["/login", "/"],
    [undefined, "/"],
    [["/a"], "/"],
  ])("next=%j は %s へ戻す", (input, expected) => {
    expect(safeNextPath(input)).toBe(expected);
  });
});
