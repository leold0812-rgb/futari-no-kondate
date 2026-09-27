/** ログインなしで開けるpath（proxy.tsの判定と単体テストで共用） */
const PUBLIC_PATHS = new Set(["/login", "/offline"]);

export function isPublicPath(pathname: string): boolean {
  return PUBLIC_PATHS.has(pathname);
}

/**
 * ログイン後の戻り先として安全なpathだけを返す（オープンリダイレクト対策）。
 * 同一オリジンの絶対path（`/`始まり、`//`や`/\`始まりではない）のみ許可する。
 */
export function safeNextPath(value: unknown): string {
  if (typeof value !== "string" || !value.startsWith("/")) return "/";
  if (value.startsWith("//") || value.startsWith("/\\")) return "/";
  if (value === "/login" || value.startsWith("/login?")) return "/";
  return value;
}
