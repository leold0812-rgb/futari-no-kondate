import "server-only";
import { EnvConfigError } from "./errors";

// サーバー専用の秘密値。Client Componentからimportするとbuildが失敗する（server-only）。

type ServerEnvRule = {
  /** 検証に失敗したときの理由（値は含めない） */
  reason: string;
  isValid: (value: string) => boolean;
};

const SERVER_ENV_RULES = {
  SUPABASE_SERVICE_ROLE_KEY: { reason: "値が設定されていません", isValid: (v) => v.length > 0 },
  OPENAI_API_KEY: { reason: "値が設定されていません", isValid: (v) => v.length > 0 },
  // docs/development-plan.md: Cron endpointは16文字以上のランダムなCRON_SECRETで保護する
  CRON_SECRET: { reason: "16文字以上のランダムな値を設定してください", isValid: (v) => v.length >= 16 },
  BLOB_READ_WRITE_TOKEN: { reason: "値が設定されていません", isValid: (v) => v.length > 0 },
  // PINハッシュ・送信元HMACのpepper（lib/auth/pin.ts）。変えると登録済みPINはすべて無効になる
  PIN_PEPPER: { reason: "32文字以上のランダムな値を設定してください", isValid: (v) => v.length >= 32 },
} as const satisfies Record<string, ServerEnvRule>;

export type ServerEnvName = keyof typeof SERVER_ENV_RULES;

/**
 * 必要になった機能ごとに1つずつ読む。未使用の秘密値が無いことで無関係な画面まで落とさないため、起動時に一括検証しない。
 */
export function readServerEnv(
  name: ServerEnvName,
  source: Readonly<Record<string, string | undefined>> = process.env,
): string {
  const value = source[name]?.trim() ?? "";
  const rule = SERVER_ENV_RULES[name];
  if (!rule.isValid(value)) {
    throw new EnvConfigError([name], rule.reason);
  }
  return value;
}
