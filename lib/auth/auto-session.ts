import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * ログイン画面をやめたため（2026-10-08 利用者の指示）、代表アカウント1つのsessionを自動で発行する。
 * secret keyの generateLink → 利用者のSSR clientの verifyOtp でcookieへ書く（ADR 0001と同じ手順。PINの照合だけを外した形）。
 * hashed_tokenは戻り値やログに含めない。
 */
export type AutoSessionResult = { ok: true } | { ok: false; reason: "no_account" | "unavailable" };

export async function signInAsOnlyMember(admin: SupabaseClient, sessionClient: SupabaseClient): Promise<AutoSessionResult> {
  const { data: profile, error: profileError } = await admin
    .from("profiles")
    .select("id")
    .order("created_at", { ascending: true })
    .limit(1)
    .maybeSingle();
  if (profileError) return { ok: false, reason: "unavailable" };
  if (!profile) return { ok: false, reason: "no_account" };

  const { data: user, error: userError } = await admin.auth.admin.getUserById(profile.id as string);
  const email = user?.user?.email;
  if (userError || !email) return { ok: false, reason: "no_account" };

  const { data: link, error: linkError } = await admin.auth.admin.generateLink({ type: "magiclink", email });
  if (linkError || !link.properties?.hashed_token) return { ok: false, reason: "unavailable" };

  const { error: verifyError } = await sessionClient.auth.verifyOtp({
    token_hash: link.properties.hashed_token,
    type: "email",
  });
  return verifyError ? { ok: false, reason: "unavailable" } : { ok: true };
}
