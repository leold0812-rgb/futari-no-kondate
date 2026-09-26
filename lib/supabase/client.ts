import { createBrowserClient } from "@supabase/ssr";
import { readPublicEnv } from "@/lib/env/public";

/**
 * Client Component用のSupabase client。anon keyだけを使い、権限はRLSで制御する。
 * ブラウザではcreateBrowserClientが同一インスタンスを再利用する。
 */
export function createSupabaseBrowserClient() {
  const { supabaseUrl, supabaseAnonKey } = readPublicEnv();
  return createBrowserClient(supabaseUrl, supabaseAnonKey);
}
