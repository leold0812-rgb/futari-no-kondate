/**
 * 固定2人のSupabase Authアカウント・CoupleSpace・profileを登録する（Gate 1.3）。
 *
 * 使い方（手順は docs/runbooks/hosted-development-setup.md）:
 *   node --env-file=.env.bootstrap.local scripts/auth/bootstrap-couple.mts --project-ref <ref>          # dry-run
 *   node --env-file=.env.bootstrap.local scripts/auth/bootstrap-couple.mts --project-ref <ref> --apply  # 実行
 *
 * 必要な環境変数（値はGit管理外の .env.*.local に置く。表示名などの個人情報をリポジトリへ書かない）:
 *   NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY,
 *   BOOTSTRAP_MEMBER_1_EMAIL, BOOTSTRAP_MEMBER_1_DISPLAY_NAME,
 *   BOOTSTRAP_MEMBER_2_EMAIL, BOOTSTRAP_MEMBER_2_DISPLAY_NAME
 */
import { createClient } from "@supabase/supabase-js";
import { parseArgs } from "node:util";
import { checkAdminKey, checkSupabaseTarget } from "../lib/supabase-target.mts";
import type { MemberConfig } from "./bootstrap-plan.mts";
import { runBootstrap } from "./bootstrap-runner.mts";

function fail(message: string): never {
  console.error(`エラー: ${message}`);
  process.exit(1);
}

async function main() {
  const { values } = parseArgs({
    options: {
      "project-ref": { type: "string" },
      apply: { type: "boolean", default: false },
    },
    strict: true,
  });

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim() ?? "";
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim() ?? "";
  const targetError = checkSupabaseTarget(url, values["project-ref"]);
  if (targetError) fail(targetError);
  const keyError = checkAdminKey(key);
  if (keyError) fail(keyError);

  const members: MemberConfig[] = [1, 2].map((n) => ({
    email: process.env[`BOOTSTRAP_MEMBER_${n}_EMAIL`] ?? "",
    displayName: process.env[`BOOTSTRAP_MEMBER_${n}_DISPLAY_NAME`] ?? "",
  }));

  console.log(`対象: ${values["project-ref"]}（${values.apply ? "実行" : "dry-run"}）`);
  const admin = createClient(url, key, { auth: { autoRefreshToken: false, persistSession: false } });
  const result = await runBootstrap({ admin, members, apply: values.apply, log: (m) => console.log(m) });
  if (result.outcome === "blocked") process.exit(2);
}

main().catch((error: unknown) => {
  fail(error instanceof Error ? error.message : "不明なエラーで停止しました。");
});
