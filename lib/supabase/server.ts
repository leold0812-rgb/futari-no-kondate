import "server-only";
import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { readPublicEnv } from "@/lib/env/public";

/**
 * Server Component / Server Action / Route Handler用のSupabase client（cookieベースのセッション）。
 * リクエストごとに生成し、モジュールスコープで共有しない。service role keyは使わない。
 */
export async function createSupabaseServerClient() {
  const { supabaseUrl, supabaseAnonKey } = readPublicEnv();
  const cookieStore = await cookies();

  return createServerClient(supabaseUrl, supabaseAnonKey, {
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(cookiesToSet) {
        try {
          for (const { name, value, options } of cookiesToSet) {
            cookieStore.set(name, value, options);
          }
        } catch {
          // Server Componentの描画中はcookieを書き込めない（Next.jsの仕様）。
          // セッション更新はGate 1で追加するproxyが担うため、ここでは書き込みを諦めて読み取りを続ける。
        }
      },
    },
  });
}
