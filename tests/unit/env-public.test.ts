import { describe, expect, it } from "vitest";
import { EnvConfigError } from "@/lib/env/errors";
import { readPublicEnv } from "@/lib/env/public";

const ANON_JWT = fakeJwt({ role: "anon" });
const SERVICE_ROLE_JWT = fakeJwt({ role: "service_role" });

function fakeJwt(payload: Record<string, unknown>): string {
  const encode = (value: unknown) => Buffer.from(JSON.stringify(value)).toString("base64url");
  return `${encode({ alg: "HS256", typ: "JWT" })}.${encode(payload)}.signature`;
}

function captureError(fn: () => unknown): EnvConfigError {
  try {
    fn();
  } catch (error) {
    if (error instanceof EnvConfigError) return error;
    throw error;
  }
  throw new Error("EnvConfigErrorが発生しませんでした");
}

describe("readPublicEnv", () => {
  it("https のURLとanon keyを受け付け、前後の空白を除く", () => {
    expect(
      readPublicEnv({
        NEXT_PUBLIC_SUPABASE_URL: " https://example.supabase.co ",
        NEXT_PUBLIC_SUPABASE_ANON_KEY: ` ${ANON_JWT} `,
      }),
    ).toEqual({ supabaseUrl: "https://example.supabase.co", supabaseAnonKey: ANON_JWT });
  });

  it("ローカルSupabaseの http://127.0.0.1 を受け付ける", () => {
    expect(
      readPublicEnv({
        NEXT_PUBLIC_SUPABASE_URL: "http://127.0.0.1:54321",
        NEXT_PUBLIC_SUPABASE_ANON_KEY: "sb_publishable_example",
      }).supabaseUrl,
    ).toBe("http://127.0.0.1:54321");
  });

  it("未設定・空白のみの変数名をまとめて日本語で示す", () => {
    const error = captureError(() =>
      readPublicEnv({ NEXT_PUBLIC_SUPABASE_URL: undefined, NEXT_PUBLIC_SUPABASE_ANON_KEY: "  " }),
    );
    expect(error.variables).toEqual(["NEXT_PUBLIC_SUPABASE_URL", "NEXT_PUBLIC_SUPABASE_ANON_KEY"]);
    expect(error.message).toContain("値が設定されていません");
    expect(error.message).toContain(".env.local");
  });

  it.each(["http://example.supabase.co", "ftp://example.com", "not a url"])(
    "安全でないURL %s を拒否する",
    (url) => {
      const error = captureError(() =>
        readPublicEnv({ NEXT_PUBLIC_SUPABASE_URL: url, NEXT_PUBLIC_SUPABASE_ANON_KEY: ANON_JWT }),
      );
      expect(error.variables).toEqual(["NEXT_PUBLIC_SUPABASE_URL"]);
    },
  );

  it.each([
    ["旧形式のservice role JWT", SERVICE_ROLE_JWT],
    ["新形式のsecret key", "sb_secret_example"],
  ])("公開変数に入った%sを拒否し、値をメッセージへ含めない", (_label, key) => {
    const error = captureError(() =>
      readPublicEnv({
        NEXT_PUBLIC_SUPABASE_URL: "https://example.supabase.co",
        NEXT_PUBLIC_SUPABASE_ANON_KEY: key,
      }),
    );
    expect(error.variables).toEqual(["NEXT_PUBLIC_SUPABASE_ANON_KEY"]);
    expect(error.message).not.toContain(key);
  });
});
