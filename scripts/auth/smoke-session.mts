/**
 * hosted Developmentで、ADR 0001の方式（サーバーのgenerateLink + verifyOtp）が動くことを確かめるスモークテスト。
 * bootstrap後に1回実行する。書き込みはsession発行とsign outだけで、データは変更しない。
 *
 *   node --env-file=.env.bootstrap.local scripts/auth/smoke-session.mts --project-ref <ref>
 *
 * 必要な環境変数: NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY,
 *                 BOOTSTRAP_MEMBER_1_EMAIL
 * token・keyの値は出力しない。
 */
import { createClient } from "@supabase/supabase-js";
import { randomUUID } from "node:crypto";
import { parseArgs } from "node:util";
import { checkAdminKey, checkSupabaseTarget } from "../lib/supabase-target.mts";

const NO_PERSIST = { auth: { autoRefreshToken: false, persistSession: false } } as const;

type Check = { name: string; ok: boolean; detail: string };

async function main() {
  const { values } = parseArgs({ options: { "project-ref": { type: "string" } }, strict: true });
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim() ?? "";
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY?.trim() ?? "";
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim() ?? "";
  const email = process.env.BOOTSTRAP_MEMBER_1_EMAIL?.trim() ?? "";

  const problem =
    checkSupabaseTarget(url, values["project-ref"]) ??
    checkAdminKey(serviceKey) ??
    (anonKey ? null : "NEXT_PUBLIC_SUPABASE_ANON_KEY が設定されていません。") ??
    (email ? null : "BOOTSTRAP_MEMBER_1_EMAIL が設定されていません。");
  if (problem) {
    console.error(`エラー: ${problem}`);
    process.exit(1);
  }

  const checks: Check[] = [];
  const anon = createClient(url, anonKey, NO_PERSIST);
  const admin = createClient(url, serviceKey, NO_PERSIST);

  // 1. 公開サインアップが無効
  const signUp = await anon.auth.signUp({ email: `smoke-${randomUUID()}@futari-no-kondate.invalid`, password: randomUUID() });
  checks.push({
    name: "公開サインアップが拒否される",
    ok: signUp.error?.code === "signup_disabled" && !signUp.data.session,
    detail: signUp.error?.code ?? "エラーなし（サインアップが有効の可能性）",
  });

  // 2. Email providerが無効（匿名からのログインメール送信要求を断つ）
  const otp = await anon.auth.signInWithOtp({ email, options: { shouldCreateUser: false } });
  checks.push({
    name: "匿名のログインメール送信要求が拒否される",
    ok: otp.error?.code === "email_provider_disabled",
    detail: otp.error?.code ?? "エラーなし（Email providerが有効の可能性）",
  });

  // 3. サーバー方式でsessionを発行できる
  const { data: link, error: linkError } = await admin.auth.admin.generateLink({ type: "magiclink", email });
  const client = createClient(url, anonKey, NO_PERSIST);
  let sessionOk = false;
  let sessionDetail = linkError?.code ?? linkError?.message ?? "";
  if (link?.properties) {
    const verified = await client.auth.verifyOtp({ token_hash: link.properties.hashed_token, type: "email" });
    sessionOk = !verified.error && Boolean(verified.data.session);
    sessionDetail = verified.error?.code ?? `access token有効期間 ${verified.data.session?.expires_in ?? "?"}秒`;
  }
  checks.push({ name: "generateLink + verifyOtpでsessionを発行できる", ok: sessionOk, detail: sessionDetail });

  // 4. 発行したsessionでRLSを通して同じspaceの2人分を読める
  if (sessionOk) {
    const { data: profiles, error } = await client.from("profiles").select("id, couple_space_id");
    const spaces = new Set((profiles ?? []).map((p) => p.couple_space_id));
    checks.push({
      name: "RLSを通して同じspaceの2人分のprofileを読める",
      ok: !error && profiles?.length === 2 && spaces.size === 1,
      detail: error?.message ?? `${profiles?.length ?? 0}件、space ${spaces.size}件`,
    });
    // このsessionだけを終了する（相手や他端末のsessionには触れない）
    await client.auth.signOut({ scope: "local" });
  }

  // 5. anon keyではprofilesを読めない
  const anonRead = await anon.from("profiles").select("id");
  checks.push({
    name: "sessionなし（anon）ではprofilesを読めない",
    ok: Boolean(anonRead.error) || (anonRead.data?.length ?? 0) === 0,
    detail: anonRead.error?.code ?? `${anonRead.data?.length ?? 0}件`,
  });

  for (const check of checks) console.log(`${check.ok ? "OK " : "NG "} ${check.name}（${check.detail}）`);
  if (checks.some((check) => !check.ok)) process.exit(1);
}

main().catch((error: unknown) => {
  console.error(`エラー: ${error instanceof Error ? error.message : "不明なエラー"}`);
  process.exit(1);
});
