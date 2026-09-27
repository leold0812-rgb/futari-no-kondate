/**
 * Vercel Blob（private）に保存された日次バックアップを一覧・取得する（Gate 8）。
 *
 *   node --env-file=.env.backup.local scripts/backup/fetch.mts --list
 *   node --env-file=.env.backup.local scripts/backup/fetch.mts --pathname backups/2026-10-01/…json.gz --out backup.json.gz
 *   node --env-file=.env.backup.local scripts/backup/fetch.mts --latest --out backup.json.gz
 *
 * 必要な環境変数: BLOB_READ_WRITE_TOKEN（Vercelのstoreの設定画面で確認できる読み書き用token。チャットやコードに貼らない）
 */
import { get, list } from "@vercel/blob";
import { writeFileSync } from "node:fs";
import { parseArgs } from "node:util";
import { BACKUP_PREFIX } from "../../lib/backup/core.mts";

function fail(message: string): never {
  console.error(`エラー: ${message}`);
  process.exit(1);
}

async function allBackups() {
  const blobs: { pathname: string; uploadedAt: Date; size: number }[] = [];
  let cursor: string | undefined;
  do {
    const page = await list({ prefix: BACKUP_PREFIX, cursor, limit: 1000 });
    blobs.push(...page.blobs.map((b) => ({ pathname: b.pathname, uploadedAt: new Date(b.uploadedAt), size: b.size })));
    cursor = page.hasMore ? page.cursor : undefined;
  } while (cursor);
  return blobs.sort((a, b) => a.uploadedAt.getTime() - b.uploadedAt.getTime());
}

async function main() {
  const { values } = parseArgs({
    options: {
      list: { type: "boolean", default: false },
      latest: { type: "boolean", default: false },
      pathname: { type: "string" },
      out: { type: "string" },
    },
    strict: true,
  });
  if (!process.env.BLOB_READ_WRITE_TOKEN?.trim()) fail("BLOB_READ_WRITE_TOKEN が設定されていません。");

  const backups = await allBackups();
  if (values.list) {
    if (backups.length === 0) console.log("バックアップはまだありません。");
    for (const b of backups) console.log(`${b.uploadedAt.toISOString()}  ${Math.round(b.size / 1024)}KB  ${b.pathname}`);
    return;
  }
  const pathname = values.latest ? backups.at(-1)?.pathname : values.pathname;
  if (!pathname || !pathname.startsWith(BACKUP_PREFIX)) fail("--latest または --pathname backups/… を指定してください。");
  if (!values.out) fail("--out に保存先（.json.gz）を指定してください。");

  const result = await get(pathname, { access: "private" });
  if (!result || result.statusCode !== 200 || !result.stream) fail(`取得できませんでした: ${pathname}`);
  const chunks: Uint8Array[] = [];
  const reader = result.stream.getReader();
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
  }
  writeFileSync(values.out, Buffer.concat(chunks), { mode: 0o600 });
  console.log(`保存しました: ${values.out}（${pathname}）`);
}

main().catch((error: unknown) => fail(error instanceof Error ? error.message : "不明なエラー"));
