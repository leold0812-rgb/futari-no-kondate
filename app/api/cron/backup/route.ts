import "server-only";
import { timingSafeEqual } from "node:crypto";
import { gzipSync } from "node:zlib";
import { del, list, put } from "@vercel/blob";
import { BACKUP_PREFIX, backupPathname, countRows, expiredBackups, exportTables } from "@/lib/backup/core.mts";
import { readServerEnv } from "@/lib/env/server";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";

/**
 * 日次バックアップ（Vercel Cron、docs/development-plan.md Gate 8）。
 *   - `Authorization: Bearer <CRON_SECRET>`（16文字以上）で保護する。proxy.tsの対象外（独自のsecret認証）
 *   - DBの論理データをgzipしたJSONにし、作成時からprivateのBlob storeへ保存する
 *   - 30日を過ぎたバックアップを消す（最新の1件は残す）
 * 応答・ログには件数だけを出し、データの中身（体重など）は出さない。
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

function authorized(header: string | null, secret: string): boolean {
  const expected = Buffer.from(`Bearer ${secret}`);
  const actual = Buffer.from(header ?? "");
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

export async function GET(request: Request): Promise<Response> {
  let secret: string;
  try {
    secret = readServerEnv("CRON_SECRET");
  } catch {
    return Response.json({ ok: false, error: "CRON_SECRET is not configured" }, { status: 503 });
  }
  if (!authorized(request.headers.get("authorization"), secret)) {
    return Response.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }

  const now = new Date();
  try {
    const backup = await exportTables(createSupabaseAdminClient(), now);
    const body = gzipSync(Buffer.from(JSON.stringify(backup), "utf8"));
    const pathname = backupPathname(now);
    await put(pathname, body, { access: "private", contentType: "application/gzip", addRandomSuffix: false, allowOverwrite: false });

    const blobs: { pathname: string; uploadedAt: Date }[] = [];
    let cursor: string | undefined;
    do {
      const page = await list({ prefix: BACKUP_PREFIX, cursor, limit: 1000 });
      blobs.push(...page.blobs.map((b) => ({ pathname: b.pathname, uploadedAt: new Date(b.uploadedAt) })));
      cursor = page.hasMore ? page.cursor : undefined;
    } while (cursor);
    const expired = expiredBackups(blobs, now);
    if (expired.length > 0) await del(expired);

    const rows = Object.values(countRows(backup)).reduce((sum, n) => sum + n, 0);
    console.info(`backup: saved ${pathname} (${rows} rows, ${body.length} bytes), deleted ${expired.length}`);
    return Response.json({ ok: true, pathname, rows, bytes: body.length, deleted: expired.length });
  } catch (error) {
    // 取得・保存の失敗理由はテーブル名とSDKのメッセージだけ（データの中身は含まない）
    console.error(`backup: failed: ${error instanceof Error ? error.message : "unknown error"}`);
    return Response.json({ ok: false, error: "backup failed" }, { status: 500 });
  }
}
