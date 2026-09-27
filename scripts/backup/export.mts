/**
 * いまのDBを手元のファイルへバックアップする（Gate 8）。危険な作業の前や、復元の練習に使う。
 *
 *   node --env-file=.env.bootstrap.local scripts/backup/export.mts --project-ref <ref> --out backup.json.gz
 *
 * 必要な環境変数: NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY
 * 出力には体重などの個人データが含まれる。リポジトリの外（iCloud等の同期フォルダ以外）に保存し、用が済んだら消す。
 */
import { createClient } from "@supabase/supabase-js";
import { writeFileSync } from "node:fs";
import { parseArgs } from "node:util";
import { gzipSync } from "node:zlib";
import { countRows, exportTables } from "../../lib/backup/core.mts";
import { checkAdminKey, checkKnownProject, checkSupabaseTarget } from "../lib/supabase-target.mts";

function fail(message: string): never {
  console.error(`エラー: ${message}`);
  process.exit(1);
}

async function main() {
  const { values } = parseArgs({
    options: {
      "project-ref": { type: "string" },
      "production-ref": { type: "string" },
      out: { type: "string" },
    },
    strict: true,
  });
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim() ?? "";
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim() ?? "";
  const problem =
    checkSupabaseTarget(url, values["project-ref"]) ??
    checkKnownProject(values["project-ref"], values["production-ref"]) ??
    checkAdminKey(key);
  if (problem) fail(problem);
  if (!values.out) fail("--out に保存先（.json.gz）を指定してください。");

  const admin = createClient(url, key, { auth: { autoRefreshToken: false, persistSession: false } });
  const backup = await exportTables(admin);
  writeFileSync(values.out, gzipSync(Buffer.from(JSON.stringify(backup), "utf8")), { mode: 0o600 });
  const counts = countRows(backup);
  console.log(`保存しました: ${values.out}`);
  for (const [table, n] of Object.entries(counts)) console.log(`  ${table}: ${n}件`);
}

main().catch((error: unknown) => fail(error instanceof Error ? error.message : "不明なエラー"));
