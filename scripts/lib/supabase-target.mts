/**
 * 管理スクリプト（bootstrap / PIN設定など）が操作対象のSupabaseを取り違えないための検査。
 * Node 24の型除去でそのまま実行するため、Node標準API以外に依存しない。
 */

const LOCAL_HOSTS = new Set(["127.0.0.1", "localhost"]);

/**
 * `--project-ref` の指定とURLが一致するかを確かめる。
 * hostedは `https://<ref>.supabase.co` のみ許可し、ローカルSupabaseは `--project-ref local` を必須にする。
 * 問題があれば日本語の理由を返し、問題がなければnullを返す。
 */
export function checkSupabaseTarget(supabaseUrl: string, projectRef: string | undefined): string | null {
  if (!projectRef) {
    return "--project-ref を指定してください（hostedはURLのproject ref、ローカルSupabaseは local）。";
  }
  let parsed: URL;
  try {
    parsed = new URL(supabaseUrl);
  } catch {
    return "NEXT_PUBLIC_SUPABASE_URL がURLとして読めません。";
  }

  if (LOCAL_HOSTS.has(parsed.hostname)) {
    return projectRef === "local"
      ? null
      : "URLはローカルSupabaseですが --project-ref が local ではありません。";
  }

  if (parsed.protocol !== "https:") {
    return "hosted Supabaseのhttps URLを指定してください。";
  }
  const match = /^([a-z0-9]{20})\.supabase\.co$/.exec(parsed.hostname);
  if (!match) {
    return "URLが https://<project-ref>.supabase.co の形式ではありません。";
  }
  if (match[1] !== projectRef) {
    return "URLのproject refと --project-ref が一致しません。操作対象のprojectを確認してください。";
  }
  return null;
}

/**
 * 管理用キー（secret / service role）かどうかを確かめる。publishable / anon keyではAdmin APIを使えない。
 * 値そのものはメッセージに含めない。
 */
export function checkAdminKey(key: string): string | null {
  if (!key) return "SUPABASE_SERVICE_ROLE_KEY が設定されていません。";
  if (key.startsWith("sb_secret_")) return null;
  if (key.startsWith("sb_publishable_")) {
    return "SUPABASE_SERVICE_ROLE_KEY にpublishable keyが設定されています。secret keyを設定してください。";
  }
  const parts = key.split(".");
  if (parts.length === 3) {
    try {
      const payload = JSON.parse(Buffer.from(parts[1], "base64url").toString("utf8")) as { role?: unknown };
      if (payload.role === "service_role") return null;
    } catch {
      // 形式不正は下の共通メッセージにする
    }
  }
  return "SUPABASE_SERVICE_ROLE_KEY がsecret key（sb_secret_...）またはservice role keyではありません。";
}
