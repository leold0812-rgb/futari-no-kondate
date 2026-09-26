import { describe, expect, it, vi } from "vitest";
import { EnvConfigError } from "@/lib/env/errors";
import { readServerEnv } from "@/lib/env/server";

// server-only はReact Server環境以外でのimportを拒否するため、テストでは無効化する
vi.mock("server-only", () => ({}));

describe("readServerEnv", () => {
  it("設定済みの値を返す", () => {
    expect(readServerEnv("OPENAI_API_KEY", { OPENAI_API_KEY: "test-value" })).toBe("test-value");
  });

  it("未設定なら変数名だけを含むEnvConfigErrorを投げる", () => {
    expect(() => readServerEnv("SUPABASE_SERVICE_ROLE_KEY", {})).toThrow(EnvConfigError);
    expect(() => readServerEnv("SUPABASE_SERVICE_ROLE_KEY", {})).toThrow("SUPABASE_SERVICE_ROLE_KEY");
  });

  it("CRON_SECRETは16文字以上を必須とし、値をメッセージへ含めない", () => {
    const minimum = "exactly-16-chars";
    expect(minimum).toHaveLength(16);
    expect(readServerEnv("CRON_SECRET", { CRON_SECRET: minimum })).toBe(minimum);

    const tooShort = "fifteen-chars-x";
    expect(() => readServerEnv("CRON_SECRET", { CRON_SECRET: tooShort })).toThrow("16文字以上");
    expect(() => readServerEnv("CRON_SECRET", { CRON_SECRET: tooShort })).not.toThrow(tooShort);
  });
});
