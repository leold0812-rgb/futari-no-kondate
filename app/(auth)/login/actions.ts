"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { safeNextPath } from "@/lib/auth/paths";
import { deriveSourceKey } from "@/lib/auth/pin";
import { describeLoginFailure, loginWithPin } from "@/lib/auth/pin-login";
import { EnvConfigError } from "@/lib/env/errors";
import { readServerEnv } from "@/lib/env/server";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export type LoginFormState = {
  error?: string;
  /** 失敗後も選んだ名前を保つ */
  userId?: string;
};

/** Vercelが付ける送信元IP。ローカルなど無い場合は1つの送信元として扱う */
async function clientAddress(): Promise<string> {
  const h = await headers();
  return h.get("x-real-ip")?.trim() || h.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown";
}

export async function loginAction(_previous: LoginFormState, formData: FormData): Promise<LoginFormState> {
  const userId = String(formData.get("userId") ?? "");
  const pin = String(formData.get("pin") ?? "");
  const next = safeNextPath(formData.get("next"));

  let result;
  try {
    const pepper = readServerEnv("PIN_PEPPER");
    result = await loginWithPin({
      admin: createSupabaseAdminClient(),
      sessionClient: await createSupabaseServerClient(),
      pepper,
      userId,
      pin,
      sourceKey: deriveSourceKey(await clientAddress(), pepper),
    });
  } catch (error) {
    if (error instanceof EnvConfigError) {
      return { userId, error: "ログインの設定が完了していません。管理者が環境変数（PIN_PEPPERなど）を確認してください。" };
    }
    return { userId, error: describeLoginFailure({ ok: false, reason: "unavailable" }) };
  }

  if (!result.ok) return { userId, error: describeLoginFailure(result) };
  redirect(next);
}
