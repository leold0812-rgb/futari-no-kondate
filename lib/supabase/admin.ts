import "server-only";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { readPublicEnv } from "@/lib/env/public";
import { readServerEnv } from "@/lib/env/server";

/**
 * secret（service role）keyを使う管理用client。RLSを迂回するため、用途を限定する：
 *   - 画面を開いたときのsession発行（lib/auth/auto-session.ts。generateLink）
 *   - URL取り込みの上限の予約・完了（public.begin/finish_recipe_import。sessionで確かめた利用者とspaceだけを渡す）
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
