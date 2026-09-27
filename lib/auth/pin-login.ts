/**
 * PINログインの中核処理（Gate 1.4、ADR 0001）。Server Actionと統合テストから使う。
 *
 * 1. `pin_login_begin` で試行を1回予約（ロック中なら検証しない）
 * 2. サーバーでPINを照合（scrypt + pepper）
 * 3. 成功時だけ `pin_login_succeeded` で連続失敗をリセットし、
 *    secret keyの `generateLink` → 利用者のSSR clientの `verifyOtp` でsessionをcookieへ書く
 *
 * hashed_token・PIN・pepperは戻り値やログに含めない。
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { isPinFormat, verifyPin } from "./pin";

export type PinLoginFailure =
  | { ok: false; reason: "invalid_input" }
  | { ok: false; reason: "wrong_pin" }
  | { ok: false; reason: "locked"; retryAfterSeconds: number }
  | { ok: false; reason: "not_ready" }
  | { ok: false; reason: "unavailable" };

export type PinLoginResult = { ok: true } | PinLoginFailure;

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type PinLoginInput = {
  /** secret keyのclient（RLS迂回）。PIN関連RPCとAdmin APIだけに使う */
  admin: SupabaseClient;
  /** 利用者のcookieへsessionを書くSSR client（anon key） */
  sessionClient: SupabaseClient;
  pepper: string;
  userId: string;
  pin: string;
  /** deriveSourceKey() で作った送信元の識別子 */
  sourceKey: string;
};

export async function loginWithPin(input: PinLoginInput): Promise<PinLoginResult> {
  const { admin, sessionClient, pepper, userId, pin, sourceKey } = input;
  if (!UUID_PATTERN.test(userId) || !isPinFormat(pin)) return { ok: false, reason: "invalid_input" };

  const { data: attempt, error: beginError } = await admin
    .rpc("pin_login_begin", { p_user_id: userId, p_source: sourceKey })
    .single<{ allowed: boolean; retry_after_seconds: number; pin_hash: string | null }>();
  if (beginError || !attempt) return { ok: false, reason: "unavailable" };
  if (!attempt.allowed) {
    // 待ち時間0は照合の対象外（profileが無い・PIN未登録）。scryptは実行しない
    if (attempt.retry_after_seconds <= 0) return { ok: false, reason: "not_ready" };
    return { ok: false, reason: "locked", retryAfterSeconds: attempt.retry_after_seconds };
  }

  const matched = await verifyPin(pin, pepper, attempt.pin_hash);
  if (!matched) return { ok: false, reason: "wrong_pin" };

  const { error: resetError } = await admin.rpc("pin_login_succeeded", { p_user_id: userId });
  if (resetError) return { ok: false, reason: "unavailable" };

  const { data: userData, error: userError } = await admin.auth.admin.getUserById(userId);
  const email = userData.user?.email;
  if (userError || !email) return { ok: false, reason: "unavailable" };

  const { data: link, error: linkError } = await admin.auth.admin.generateLink({ type: "magiclink", email });
  if (linkError || !link.properties?.hashed_token) return { ok: false, reason: "unavailable" };

  const { error: verifyError } = await sessionClient.auth.verifyOtp({
    token_hash: link.properties.hashed_token,
    type: "email",
  });
  if (verifyError) return { ok: false, reason: "unavailable" };
  return { ok: true };
}

/** 利用者へ見せる文言（何が起きたか・次に何をすればよいか） */
export function describeLoginFailure(failure: PinLoginFailure): string {
  switch (failure.reason) {
    case "invalid_input":
      return "名前を選び、6〜12桁の数字のPINを入力してください。";
    case "wrong_pin":
      return "PINが違います。もう一度入力してください。";
    case "locked": {
      const minutes = Math.ceil(failure.retryAfterSeconds / 60);
      return `この端末（通信回線）から短い時間に何度も試されたため、ログインを一時的に止めています。約${minutes}分後にもう一度お試しください。`;
    }
    case "not_ready":
      return "この名前はまだログインの準備ができていません（PIN未設定）。管理者にPINの設定を依頼してください。";
    case "unavailable":
      return "ログイン処理を完了できませんでした。通信状態を確認して、少し待ってからもう一度お試しください。";
  }
}
