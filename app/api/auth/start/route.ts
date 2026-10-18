import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { AUTO_LOGIN_TRIED_COOKIE, safeNextPath } from "@/lib/auth/paths";
import { signInAsOnlyMember } from "@/lib/auth/auto-session";
import { EnvConfigError } from "@/lib/env/errors";
import { readPublicEnv } from "@/lib/env/public";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";

/**
 * sessionが無い端末のためにsessionを発行してから目的の画面へ戻す（ログイン画面の代わり）。
 * 画面（Server Component）の描画中はcookieを書けないため、proxy.tsがここへ寄せる。
 */
export const dynamic = "force-dynamic";

function problem(title: string, body: string): NextResponse {
  const html = `<!doctype html><html lang="ja"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${title}</title></head><body style="font-family:system-ui;padding:24px;line-height:1.7"><h1 style="font-size:1.25rem">${title}</h1><p>${body}</p></body></html>`;
  return new NextResponse(html, { status: 503, headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "private, no-store" } });
}

export async function GET(request: NextRequest) {
  const next = safeNextPath(request.nextUrl.searchParams.get("next"));
  const response = NextResponse.redirect(new URL(next, request.nextUrl.origin));
  response.headers.set("Cache-Control", "private, no-store");
  // 発行に失敗したときproxy.tsが同じ所へ送り返し続けないよう、1度試した印を短時間だけ残す。
  // secureはhttpsのときだけ付ける（ローカルのhttpでは付けるとブラウザが保存せず、転送が止まらなくなる）
  const https = request.nextUrl.protocol === "https:";
  response.cookies.set(AUTO_LOGIN_TRIED_COOKIE, "1", { httpOnly: true, sameSite: "lax", secure: https, path: "/", maxAge: 60 });

  let env: ReturnType<typeof readPublicEnv>;
  let admin;
  try {
    env = readPublicEnv();
    admin = createSupabaseAdminClient();
  } catch (error) {
    if (error instanceof EnvConfigError) {
      return problem("サーバーの設定が足りません", "アプリの接続設定が未入力です。設定を入れ直してから、もう一度開いてください。");
    }
    throw error;
  }

  const sessionClient = createServerClient(env.supabaseUrl, env.supabaseAnonKey, {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet) {
        for (const { name, value, options } of cookiesToSet) response.cookies.set(name, value, options);
      },
    },
  });

  const result = await signInAsOnlyMember(admin, sessionClient);
  if (!result.ok) {
    if (result.reason === "no_account") {
      return problem("アカウントがまだ用意されていません", "最初の登録が終わると、この画面は出なくなります（docs/runbooks/hosted-development-setup.md のD）。");
    }
    return problem("いま開けませんでした", "通信が不安定か、サーバーが一時的に応答していません。少し待ってから、もう一度開いてください。");
  }
  return response;
}
