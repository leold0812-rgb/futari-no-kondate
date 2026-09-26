import { afterEach, describe, expect, it, vi } from "vitest";
import { EnvConfigError } from "@/lib/env/errors";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("createSupabaseBrowserClient", () => {
  it("環境変数が無ければ通信せずにEnvConfigErrorで止まる", () => {
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "");
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY", "");

    expect(() => createSupabaseBrowserClient()).toThrow(EnvConfigError);
  });

  it("公開用の設定があればclientを生成する", () => {
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "http://127.0.0.1:54321");
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY", "sb_publishable_example");

    expect(createSupabaseBrowserClient()).toHaveProperty("auth");
  });
});
