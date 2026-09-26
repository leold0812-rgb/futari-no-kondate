import { EnvConfigError } from "./errors";

// ブラウザへ公開してよい値だけを扱う。server secretをこのファイルへ追加しない。

export type PublicEnv = {
  supabaseUrl: string;
  supabaseAnonKey: string;
};

type PublicEnvSource = {
  NEXT_PUBLIC_SUPABASE_URL?: string;
  NEXT_PUBLIC_SUPABASE_ANON_KEY?: string;
};

const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]"]);

/**
 * 公開用Supabase設定を検証して返す。
 * Next.jsはNEXT_PUBLIC_*を文字どおりの `process.env.X` 参照でだけ埋め込むため、既定値では各変数を個別に参照する。
 */
export function readPublicEnv(
  source: PublicEnvSource = {
    NEXT_PUBLIC_SUPABASE_URL: process.env.NEXT_PUBLIC_SUPABASE_URL,
    NEXT_PUBLIC_SUPABASE_ANON_KEY: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
  },
): PublicEnv {
  const url = source.NEXT_PUBLIC_SUPABASE_URL?.trim() ?? "";
  const anonKey = source.NEXT_PUBLIC_SUPABASE_ANON_KEY?.trim() ?? "";

  const missing = [
    !url && "NEXT_PUBLIC_SUPABASE_URL",
    !anonKey && "NEXT_PUBLIC_SUPABASE_ANON_KEY",
  ].filter((name): name is string => Boolean(name));
  if (missing.length > 0) {
    throw new EnvConfigError(missing, "値が設定されていません");
  }

  if (!isAllowedSupabaseUrl(url)) {
    throw new EnvConfigError(
      ["NEXT_PUBLIC_SUPABASE_URL"],
      "https のURL（ローカルのSupabaseのみ http://localhost 可）を指定してください",
    );
  }

  if (looksLikeServiceRoleKey(anonKey)) {
    throw new EnvConfigError(
      ["NEXT_PUBLIC_SUPABASE_ANON_KEY"],
      "service role / secret key が指定されています。ブラウザへ公開される変数にはanon（publishable）keyだけを設定してください",
    );
  }

  return { supabaseUrl: url, supabaseAnonKey: anonKey };
}

function isAllowedSupabaseUrl(value: string): boolean {
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    return false;
  }
  if (parsed.protocol === "https:") return true;
  return parsed.protocol === "http:" && LOCAL_HOSTS.has(parsed.hostname);
}

/** 公開変数へ誤って特権キーを入れる事故を防ぐ。新形式(sb_secret_)と旧JWT形式(role=service_role)を判定する */
function looksLikeServiceRoleKey(key: string): boolean {
  if (key.startsWith("sb_secret_")) return true;

  const parts = key.split(".");
  if (parts.length !== 3) return false;
  try {
    const payload = JSON.parse(base64UrlDecode(parts[1])) as { role?: unknown };
    return payload.role === "service_role";
  } catch {
    return false;
  }
}

function base64UrlDecode(input: string): string {
  const base64 = input.replace(/-/g, "+").replace(/_/g, "/");
  const padded = base64.padEnd(base64.length + ((4 - (base64.length % 4)) % 4), "=");
  return atob(padded);
}
