import "server-only";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { readPublicEnv } from "@/lib/env/public";
import { readServerEnv } from "@/lib/env/server";

/**
 * secret（service role）keyを使う管理用client。RLSを迂回するため、用途を限定する：
 *   - ログイン画面の表示名一覧、PIN検証と試行制限（public.pin_login_*）、session発行（generateLink）
 *   - バックアップCron
 * 利用者の操作によるデータ読み書きには使わない（それらは createSupabaseServerClient + RLS）。
 */
export function createSupabaseAdminClient(): SupabaseClient {
  const { supabaseUrl } = readPublicEnv();
  const secretKey = readServerEnv("SUPABASE_SERVICE_ROLE_KEY");
  return createClient(supabaseUrl, secretKey, {
    auth: { autoRefreshToken: false, persistSession: false, detectSessionInUrl: false },
  });
}
