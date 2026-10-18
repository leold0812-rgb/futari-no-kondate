import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { AUTO_LOGIN_TRIED_COOKIE, isPublicPath } from "@/lib/auth/paths";
import { readPublicEnv } from "@/lib/env/public";

/**
 * Next.js 16のproxy（旧middleware）。すべての画面リクエストで:
 *   1. Supabase Auth sessionを更新し、更新後のcookieを応答へ書く（@supabase/ssr公式構成）
 *   2. sessionが無ければ /api/auth/start へ寄せ、そこで発行してから元の画面へ戻す（ログイン画面は無い）
 * データの保護はRLSで行い、ここは画面遷移の制御だけを担う。
 */
export async function proxy(request: NextRequest) {
  let response = NextResponse.next({ request });

  let env: ReturnType<typeof readPublicEnv>;
  try {
    env = readPublicEnv();
  } catch {
    // 環境変数不足。各画面が日本語の設定エラーを表示するため、ここでは通す（データはRLSで保護される）
    return response;
  }

  const supabase = createServerClient(env.supabaseUrl, env.supabaseAnonKey, {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet, headers) {
        for (const { name, value } of cookiesToSet) request.cookies.set(name, value);
        response = NextResponse.next({ request });
        for (const { name, value, options } of cookiesToSet) response.cookies.set(name, value, options);
        // キャッシュ抑止headers（session更新を含む応答をCDNに保存させない）
        for (const [key, value] of Object.entries(headers ?? {})) response.headers.set(key, value);
      },
    },
  });

  // getClaims() はJWTを検証してclaimsを返す（必要ならsessionを更新してsetAllを呼ぶ）
  const { data } = await supabase.auth.getClaims();
  const signedIn = typeof data?.claims?.sub === "string";
  const { pathname, search } = request.nextUrl;

  if (signedIn) {
    if (request.cookies.has(AUTO_LOGIN_TRIED_COOKIE)) response.cookies.delete(AUTO_LOGIN_TRIED_COOKIE);
    return response;
  }
  if (isPublicPath(pathname)) return response;
  // 発行を1度試してもsessionが無い場合は、/api/auth/startが理由を表示する（送り返し続けない）
  if (request.cookies.has(AUTO_LOGIN_TRIED_COOKIE)) return response;

  const url = request.nextUrl.clone();
  url.pathname = "/api/auth/start";
  url.search = "";
  if (pathname !== "/") url.searchParams.set("next", `${pathname}${search}`);
  const redirect = NextResponse.redirect(url);
  for (const cookie of response.cookies.getAll()) redirect.cookies.set(cookie);
  redirect.headers.set("Cache-Control", "private, no-store");
  return redirect;
}

export const config = {
  matcher: [
    // 静的ファイル・PWA資産・Cron（独自のsecret認証）を除くすべて
    "/((?!_next/static|_next/image|favicon.ico|icons/|manifest.webmanifest|sw.js|api/cron/|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)",
  ],
};
