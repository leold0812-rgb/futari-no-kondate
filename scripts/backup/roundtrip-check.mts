/**
 * 復元テスト（Gate 8、CIのE2E後にローカルSupabaseで実行する）。
 *   1. いまのDB（E2Eで作ったデータ）をバックアップする
 *   2. 対象テーブルを空にする（ローカルだけ。hostedでは動かない）
 *   3. バックアップから復元する
 *   4. もう一度バックアップし、1と同じ内容かを比べる
 *
 *   node scripts/backup/roundtrip-check.mts --project-ref local
 */
import { createClient } from "@supabase/supabase-js";
import { isDeepStrictEqual } from "node:util";
import { parseArgs } from "node:util";
import { BACKUP_TABLES, type BackupFile, clearTables, countRows, exportTables, findNonEmptyTables, restoreTables } from "../../lib/backup/core.mts";
import { checkAdminKey, checkSupabaseTarget } from "../lib/supabase-target.mts";

function fail(message: string): never {
  console.error(`エラー: ${message}`);
  process.exit(1);
}

/**
 * 比べられる形にする。
 * - recommendation_runs.seq は復元で採番し直すため、値ではなく順で比べる
 * - couple_spaces.updated_at は profiles を入れると2人上限の仕組み（private.enforce_couple_space_member_limit）が
 *   更新するため復元時刻になる。表示・処理に使っていない管理用の列なので比べない
 */
function comparable(backup: BackupFile) {
  const tables = { ...backup.tables } as Record<string, Record<string, unknown>[]>;
  tables.couple_spaces = tables.couple_spaces.map((row) => {
    const copy = { ...row };
    delete copy.updated_at;
    return copy;
  });
  const runs = [...tables.recommendation_runs].sort((a, b) => Number(a.seq) - Number(b.seq));
  tables.recommendation_runs = runs
    .map((row, order) => {
      const copy: Record<string, unknown> = { ...row, order };
      delete copy.seq;
      return copy;
    })
    .sort((a, b) => String(a.id).localeCompare(String(b.id)));
  return tables;
}

async function main() {
  const { values } = parseArgs({ options: { "project-ref": { type: "string" } }, strict: true });
  if (values["project-ref"] !== "local") fail("復元テストはローカルSupabase（--project-ref local）でだけ実行します。");
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim() ?? "";
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim() ?? "";
  const problem = checkSupabaseTarget(url, "local") ?? checkAdminKey(key);
  if (problem) fail(problem);
  const admin = createClient(url, key, { auth: { autoRefreshToken: false, persistSession: false } });

  const before = await exportTables(admin);
  const counts = countRows(before);
  const total = Object.values(counts).reduce((a, b) => a + b, 0);
  console.log(`バックアップ: ${total}件`);
  for (const [table, n] of Object.entries(counts)) console.log(`  ${table}: ${n}件`);
  const empty = ["profiles", "recipes", "meal_histories"].filter((t) => counts[t] === 0);
  if (empty.length > 0) fail(`復元テストの前提のデータがありません（${empty.join(", ")}）。E2Eの後に実行してください。`);

  await clearTables(admin);
  const left = await findNonEmptyTables(admin);
  if (left.length > 0) fail(`空にできなかったテーブルがあります: ${left.join(", ")}`);

  await restoreTables(admin, before);
  const after = await exportTables(admin);

  const a = comparable(before);
  const b = comparable(after);
  const different = BACKUP_TABLES.map((t) => t.name).filter((name) => !isDeepStrictEqual(a[name], b[name]));
  if (different.length > 0) fail(`復元前後で内容が違います: ${different.join(", ")}`);
  console.log("復元テスト: 復元前後で全テーブルの内容が一致しました。");
}

main().catch((error: unknown) => fail(error instanceof Error ? error.message : "不明なエラー"));
