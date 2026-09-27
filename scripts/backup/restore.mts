/**
 * バックアップから復元する（Gate 8、手順は docs/runbooks/backup-restore.md）。
 *
 *   node --env-file=.env.bootstrap.local scripts/backup/restore.mts --project-ref <ref> --file backup.json.gz            # 確認のみ
 *   … --apply                                                                                                         # 復元する
 *   … --user-map user-map.json   # 復元先で2人のアカウントを作り直してIDが変わった場合 {"旧ID": "新ID", …}
 *
 * 安全のため:
 *   - 復元先の対象テーブルがすべて空のときだけ入れる（既存データへ上書き・混在させない）
 *   - 復元先に、バックアップの2人（profiles）と同じIDのAuthアカウントがあることを先に確かめる
 *   - hosted Development・ローカル以外は --production-ref に同じrefを書いたときだけ（scripts/lib/supabase-target.mts）
 * PINは復元しない。復元後に scripts/auth/set-pin.mts で2人のPINを設定し直す。
 */
import { createClient } from "@supabase/supabase-js";
import { readFileSync } from "node:fs";
import { parseArgs } from "node:util";
import { countRows, findNonEmptyTables, remapUserIds, restoreTables } from "../../lib/backup/core.mts";
import { readBackupFile } from "./file.mts";
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
      file: { type: "string" },
      "user-map": { type: "string" },
      apply: { type: "boolean", default: false },
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
  if (!values.file) fail("--file にバックアップファイルを指定してください。");

  let backup = readBackupFile(values.file);
  if (values["user-map"]) {
    backup = remapUserIds(backup, JSON.parse(readFileSync(values["user-map"], "utf8")) as Record<string, string>);
  }
  console.log(`バックアップ: ${backup.createdAt}`);
  for (const [table, n] of Object.entries(countRows(backup))) console.log(`  ${table}: ${n}件`);

  const admin = createClient(url, key, { auth: { autoRefreshToken: false, persistSession: false } });
  const nonEmpty = await findNonEmptyTables(admin);
  if (nonEmpty.length > 0) {
    fail(`復元先にデータがあります（${nonEmpty.join(", ")}）。空のprojectへ復元してください。上書きはしません。`);
  }
  const { data: users, error } = await admin.auth.admin.listUsers({ page: 1, perPage: 1000 });
  if (error) fail(`Authのアカウントを確認できませんでした: ${error.message}`);
  const existing = new Set(users.users.map((u) => u.id));
  const missing = backup.tables.profiles.map((p) => String(p.id)).filter((id) => !existing.has(id));
  if (missing.length > 0) {
    fail(
      `復元先に、バックアップの利用者と同じIDのAuthアカウントがありません（${missing.length}人）。` +
        "bootstrapで2人を作ってから、--user-map で旧IDと新IDの対応を指定してください。",
    );
  }

  if (!values.apply) {
    console.log("確認のみのため復元していません。復元するには --apply を付けてください。");
    return;
  }
  await restoreTables(admin, backup, (table, rows) => console.log(`  復元: ${table} ${rows}件`));
  console.log("完了しました。2人のPINを scripts/auth/set-pin.mts で設定し直してください。");
}

main().catch((error: unknown) => fail(error instanceof Error ? error.message : "不明なエラー"));
