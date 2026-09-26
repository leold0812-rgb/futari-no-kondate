/**
 * 統合テスト共通：ローカルSupabase（`supabase start`）の接続設定。hosted projectへは接続しない。
 * 値はCIで `supabase status -o env` の公開済み既定鍵から渡す（GitHub Secretsは使わない）。
 */
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

export const NO_SESSION_PERSISTENCE = { auth: { autoRefreshToken: false, persistSession: false } } as const;

export type LocalSupabaseEnv = { url: string; anonKey: string; serviceKey: string };

export function readLocalSupabaseEnv(): LocalSupabaseEnv {
  const url = process.env.SPIKE_SUPABASE_URL ?? "";
  const anonKey = process.env.SPIKE_ANON_KEY ?? "";
  const serviceKey = process.env.SPIKE_SERVICE_ROLE_KEY ?? "";
  if (!url || !anonKey || !serviceKey) {
    throw new Error(
      "SPIKE_SUPABASE_URL / SPIKE_ANON_KEY / SPIKE_SERVICE_ROLE_KEY が未設定です。ローカルの `supabase status -o env` の値を渡してください。",
    );
  }
  const host = new URL(url).hostname;
  if (host !== "127.0.0.1" && host !== "localhost") {
    throw new Error("拒否: 統合テストはローカルSupabase（127.0.0.1 / localhost）専用です。");
  }
  return { url, anonKey, serviceKey };
}

export function createAdminClient(env: LocalSupabaseEnv): SupabaseClient {
  return createClient(env.url, env.serviceKey, NO_SESSION_PERSISTENCE);
}

export function createAnonClient(env: LocalSupabaseEnv): SupabaseClient {
  return createClient(env.url, env.anonKey, NO_SESSION_PERSISTENCE);
}

/** 管理者APIで全Authユーザーを列挙する（テストの前提確認用） */
export async function listAllAuthUsers(admin: SupabaseClient) {
  const { data, error } = await admin.auth.admin.listUsers({ page: 1, perPage: 1000 });
  if (error) throw new Error(`listUsers failed: ${error.message}`);
  return data.users;
}
