/**
 * バックアップと復元の中身（Gate 8）。Cron route（app/api/cron/backup）と管理スクリプト（scripts/backup/）で共用する。
 * Node 24の型除去でそのまま実行できるよう、`@/`などの別名を使わず、@supabase/supabase-jsの型以外に依存しない。
 *
 * 対象（docs/product-spec.md 合理的仮定7「DBの論理データとStorage参照情報」）:
 *   - publicスキーマの利用データ（料理画像は Storage のpath＝参照情報だけ。画像そのものは二重保存しない）
 *   - 体重も含む（本人たちのデータを失わないため。保存先は非公開のBlob store）
 * 対象外:
 *   - private.pin_credentials / login_throttles（PINの派生値と試行記録。復元後はPINを設定し直す）
 *   - recipe_import_logs（取り込み回数の運用記録）
 *   - auth.users（Supabase Authが管理。復元先に同じ2人のアカウントが必要。IDが違う場合は対応表で置き換える）
 */
import type { SupabaseClient } from "@supabase/supabase-js";

export const BACKUP_FORMAT = "futari-no-kondate-backup";
export const BACKUP_VERSION = 1;
export const RETENTION_DAYS = 30;
export const BACKUP_PREFIX = "backups/";

/** 復元する順（外部キーの親が先）と、読み出しの並び（主キー） */
export const BACKUP_TABLES = [
  { name: "couple_spaces", key: ["id"] },
  { name: "profiles", key: ["id"] },
  { name: "food_composition_items", key: ["id"] },
  { name: "ingredients", key: ["id"] },
  { name: "recipes", key: ["id"] },
  { name: "recipe_ingredients", key: ["id"] },
  { name: "recipe_ratings", key: ["recipe_id", "user_id"] },
  { name: "recipe_favorites", key: ["recipe_id", "user_id"] },
  { name: "inventory_items", key: ["id"] },
  { name: "inventory_adjustments", key: ["id"] },
  { name: "weekly_plans", key: ["id"] },
  { name: "recommendation_runs", key: ["id"] },
  { name: "recommendation_candidates", key: ["id"] },
  { name: "meal_sets", key: ["id"] },
  { name: "meal_histories", key: ["id"] },
  { name: "recipe_histories", key: ["id"] },
  { name: "shopping_lists", key: ["id"] },
  { name: "shopping_items", key: ["id"] },
  { name: "shopping_category_orders", key: ["couple_space_id", "category"] },
  { name: "rice_portions", key: ["user_id"] },
  { name: "weight_records", key: ["id"] },
] as const;

export type TableName = (typeof BACKUP_TABLES)[number]["name"];
type Row = Record<string, unknown>;

export type BackupFile = {
  format: typeof BACKUP_FORMAT;
  version: typeof BACKUP_VERSION;
  createdAt: string;
  tables: Record<TableName, Row[]>;
};

const PAGE = 1000;

/** すべての対象テーブルを読み出す（service roleのclientで呼ぶ） */
export async function exportTables(client: SupabaseClient, now: Date = new Date()): Promise<BackupFile> {
  const tables = {} as Record<TableName, Row[]>;
  for (const table of BACKUP_TABLES) {
    const rows: Row[] = [];
    for (let from = 0; ; from += PAGE) {
      let query = client.from(table.name).select("*");
      for (const column of table.key) query = query.order(column, { ascending: true });
      const { data, error } = await query.range(from, from + PAGE - 1);
      if (error) throw new Error(`${table.name} を読み出せませんでした: ${error.message}`);
      rows.push(...((data ?? []) as Row[]));
      if (!data || data.length < PAGE) break;
    }
    tables[table.name] = rows;
  }
  return { format: BACKUP_FORMAT, version: BACKUP_VERSION, createdAt: now.toISOString(), tables };
}

export function countRows(backup: BackupFile): Record<string, number> {
  return Object.fromEntries(BACKUP_TABLES.map((t) => [t.name, backup.tables[t.name]?.length ?? 0]));
}

/** バックアップファイルの形を確かめる。問題があれば日本語の理由を返す */
export function validateBackup(value: unknown): string | null {
  if (!value || typeof value !== "object") return "バックアップファイルの形式が違います。";
  const file = value as Partial<BackupFile>;
  if (file.format !== BACKUP_FORMAT) return "このアプリのバックアップファイルではありません。";
  if (file.version !== BACKUP_VERSION) return `対応していない版のバックアップです（版 ${String(file.version)}）。`;
  if (!file.tables || typeof file.tables !== "object") return "バックアップにテーブルがありません。";
  for (const table of BACKUP_TABLES) {
    if (!Array.isArray((file.tables as Record<string, unknown>)[table.name])) return `${table.name} がバックアップにありません。`;
  }
  return null;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * 利用者IDを置き換える（復元先で2人のアカウントを作り直し、IDが変わった場合）。
 * UUIDは値として一意なので、文字列として現れる箇所（user_id・completed_by・栄養の写しのキーなど）をすべて置き換える。
 */
export function remapUserIds(backup: BackupFile, map: Record<string, string>): BackupFile {
  const entries = Object.entries(map);
  for (const [from, to] of entries) {
    if (!UUID.test(from) || !UUID.test(to)) throw new Error("利用者IDの対応表はUUIDどうしで指定してください。");
  }
  if (entries.length === 0) return backup;
  const lookup = new Map(entries.map(([from, to]) => [from.toLowerCase(), to.toLowerCase()]));
  const replaced = JSON.stringify(backup).replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi, (id) => lookup.get(id.toLowerCase()) ?? id);
  return JSON.parse(replaced) as BackupFile;
}

/** 復元前の行の調整。常に生成される列（recommendation_runs.seq）は外し、元の順に入れて採番し直す */
export function rowsForRestore(table: TableName, rows: Row[]): Row[] {
  if (table !== "recommendation_runs") return rows;
  return [...rows]
    .sort((a, b) => Number(a.seq ?? 0) - Number(b.seq ?? 0))
    .map((row) => {
      const copy = { ...row };
      delete copy.seq;
      return copy;
    });
}

/** 復元先のテーブルがすべて空かを確かめる（既存データへ上書き・混在させない） */
export async function findNonEmptyTables(client: SupabaseClient): Promise<string[]> {
  const nonEmpty: string[] = [];
  for (const table of BACKUP_TABLES) {
    const { count, error } = await client.from(table.name).select("*", { count: "exact", head: true });
    if (error) throw new Error(`${table.name} を確認できませんでした: ${error.message}`);
    if ((count ?? 0) > 0) nonEmpty.push(table.name);
  }
  return nonEmpty;
}

/** 空のDBへ親テーブルから順に入れる（service roleのclientで呼ぶ） */
export async function restoreTables(client: SupabaseClient, backup: BackupFile, onProgress?: (table: string, rows: number) => void): Promise<void> {
  for (const table of BACKUP_TABLES) {
    const rows = rowsForRestore(table.name, backup.tables[table.name]);
    for (let i = 0; i < rows.length; i += 500) {
      const { error } = await client.from(table.name).insert(rows.slice(i, i + 500));
      if (error) throw new Error(`${table.name} を復元できませんでした（${i + 1}行目から）: ${error.message}`);
    }
    onProgress?.(table.name, rows.length);
  }
}

/** バックアップのファイル名（日時順に並ぶ） */
export function backupPathname(now: Date): string {
  const stamp = now.toISOString().replace(/[:.]/g, "-");
  return `${BACKUP_PREFIX}${stamp.slice(0, 10)}/${stamp}.json.gz`;
}

/** 保持期間（30日）を過ぎたバックアップ。最新の1件は期間を過ぎていても残す */
export function expiredBackups(blobs: { pathname: string; uploadedAt: Date }[], now: Date, days: number = RETENTION_DAYS): string[] {
  const limit = now.getTime() - days * 86_400_000;
  const ours = blobs.filter((b) => b.pathname.startsWith(BACKUP_PREFIX));
  const newest = ours.reduce<{ pathname: string; uploadedAt: Date } | null>(
    (best, b) => (!best || b.uploadedAt.getTime() > best.uploadedAt.getTime() ? b : best),
    null,
  );
  return ours.filter((b) => b.uploadedAt.getTime() < limit && b !== newest).map((b) => b.pathname);
}
