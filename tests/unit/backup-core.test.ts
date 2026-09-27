import { describe, expect, it } from "vitest";
import {
  BACKUP_FORMAT,
  BACKUP_TABLES,
  BACKUP_VERSION,
  type BackupFile,
  backupPathname,
  expiredBackups,
  remapUserIds,
  rowsForRestore,
  validateBackup,
} from "@/lib/backup/core.mts";

const OLD_A = "00000000-0000-4000-8000-00000000000a";
const NEW_A = "11111111-1111-4111-8111-11111111111a";

function emptyBackup(): BackupFile {
  return {
    format: BACKUP_FORMAT,
    version: BACKUP_VERSION,
    createdAt: "2026-10-01T18:00:00.000Z",
    tables: Object.fromEntries(BACKUP_TABLES.map((t) => [t.name, []])) as unknown as BackupFile["tables"],
  };
}

describe("BACKUP_TABLES", () => {
  it("体重を含み、PINの派生値・試行記録・取り込みログは含まない", () => {
    const names = BACKUP_TABLES.map((t) => t.name as string);
    expect(names).toContain("weight_records");
    expect(names).not.toContain("pin_credentials");
    expect(names).not.toContain("login_throttles");
    expect(names).not.toContain("recipe_import_logs");
  });

  it("親テーブルが子より先に並ぶ（復元の順）", () => {
    const order = (name: string) => BACKUP_TABLES.findIndex((t) => t.name === name);
    const edges: [string, string][] = [
      ["couple_spaces", "profiles"],
      ["food_composition_items", "ingredients"],
      ["recipes", "recipe_ingredients"],
      ["ingredients", "inventory_items"],
      ["weekly_plans", "recommendation_runs"],
      ["recommendation_runs", "recommendation_candidates"],
      ["meal_sets", "meal_histories"],
      ["meal_histories", "recipe_histories"],
      ["shopping_lists", "shopping_items"],
    ];
    for (const [parent, child] of edges) expect(order(parent)).toBeLessThan(order(child));
  });
});

describe("validateBackup", () => {
  it("このアプリの形式だけを受け付ける", () => {
    expect(validateBackup(emptyBackup())).toBeNull();
    expect(validateBackup(null)).not.toBeNull();
    expect(validateBackup({ ...emptyBackup(), format: "other" })).not.toBeNull();
    expect(validateBackup({ ...emptyBackup(), version: 2 })).not.toBeNull();
    const missing = emptyBackup() as unknown as { tables: Record<string, unknown> };
    delete missing.tables.weight_records;
    expect(validateBackup(missing)).not.toBeNull();
  });
});

describe("remapUserIds", () => {
  it("利用者IDを、列の値でもJSONのキーでも置き換える", () => {
    const backup = emptyBackup();
    backup.tables.profiles = [{ id: OLD_A, display_name: "a" }];
    backup.tables.meal_histories = [{ id: "m1", completed_by: OLD_A, nutrition_per_person: { [OLD_A]: { energyKcal: 500 } } }];
    const mapped = remapUserIds(backup, { [OLD_A]: NEW_A });
    expect(mapped.tables.profiles[0].id).toBe(NEW_A);
    expect(mapped.tables.meal_histories[0]).toEqual({ id: "m1", completed_by: NEW_A, nutrition_per_person: { [NEW_A]: { energyKcal: 500 } } });
  });

  it("UUIDでない対応表は受け付けない", () => {
    expect(() => remapUserIds(emptyBackup(), { a: NEW_A })).toThrow();
  });
});

describe("rowsForRestore", () => {
  it("推薦の実行はseqを外し、元の順に並べる", () => {
    const rows = rowsForRestore("recommendation_runs", [
      { id: "r2", seq: 5 },
      { id: "r1", seq: 2 },
    ]);
    expect(rows).toEqual([{ id: "r1" }, { id: "r2" }]);
  });

  it("ほかのテーブルはそのまま", () => {
    const rows = [{ id: "x", seq: 1 }];
    expect(rowsForRestore("recipes", rows)).toBe(rows);
  });
});

describe("backupPathname / expiredBackups", () => {
  const now = new Date("2026-10-31T18:00:00.000Z");

  it("日付ごとのフォルダに、時刻入りの名前で保存する", () => {
    expect(backupPathname(now)).toBe("backups/2026-10-31/2026-10-31T18-00-00-000Z.json.gz");
  });

  it("30日を過ぎたものだけを消し、ほかの場所のファイルには触れない", () => {
    const blobs = [
      { pathname: "backups/old.json.gz", uploadedAt: new Date("2026-09-30T17:00:00Z") },
      { pathname: "backups/edge.json.gz", uploadedAt: new Date("2026-10-01T18:00:00Z") },
      { pathname: "backups/new.json.gz", uploadedAt: new Date("2026-10-31T18:00:00Z") },
      { pathname: "other/old.json.gz", uploadedAt: new Date("2026-01-01T00:00:00Z") },
    ];
    expect(expiredBackups(blobs, now)).toEqual(["backups/old.json.gz"]);
  });

  it("すべて期限切れでも最新の1件は残す（Cronが止まっていた場合）", () => {
    const blobs = [
      { pathname: "backups/a.json.gz", uploadedAt: new Date("2026-08-01T00:00:00Z") },
      { pathname: "backups/b.json.gz", uploadedAt: new Date("2026-08-02T00:00:00Z") },
    ];
    expect(expiredBackups(blobs, now)).toEqual(["backups/a.json.gz"]);
  });
});
