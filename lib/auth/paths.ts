/** sessionが無くても開けるpath（proxy.tsの判定と単体テストで共用） */
const PUBLIC_PATHS = new Set(["/api/auth/start", "/offline"]);

export function isPublicPath(pathname: string): boolean {
  return PUBLIC_PATHS.has(pathname);
}

/** session発行を1度試した印。発行に失敗したときに同じ所へ送り返し続けないため */
export const AUTO_LOGIN_TRIED_COOKIE = "kondate-session-tried";

/**
 * session発行後の戻り先として安全なpathだけを返す（オープンリダイレクト対策）。
 * 同一オリジンの絶対path（`/`始まり、`//`や`/\`始まりではない）のみ許可する。
 */
export function safeNextPath(value: unknown): string {
  if (typeof value !== "string" || !value.startsWith("/")) return "/";
  if (value.startsWith("//") || value.startsWith("/\\")) return "/";
  if (value === "/api/auth/start" || value.startsWith("/api/auth/start?")) return "/";
  return value;
}
