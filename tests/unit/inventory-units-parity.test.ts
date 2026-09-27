import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { toBaseQuantity, UNIT_CHOICES, unitKind } from "@/lib/units";

vi.mock("server-only", () => ({}));
const { totalsByGroup } = await import("@/lib/services/inventory");

// DBの在庫減算（private.unit_base）とアプリの単位定義（lib/units）がずれていないことを確かめる
const sql = readFileSync(join(__dirname, "..", "..", "supabase", "migrations", "20261001090000_create_inventory.sql"), "utf8");
const unitBase = sql.slice(sql.indexOf("create function private.unit_base"), sql.indexOf("grant execute on function private.unit_base"));

describe("単位定義のアプリとDBの一致", () => {
  it.each(UNIT_CHOICES)("%s はDBでも同じ種類・係数", (code) => {
    const kind = unitKind(code);
    expect(unitBase).toContain(`'${code}'`);
    const factor = toBaseQuantity(1, code)!;
    if (factor !== 1) expect(unitBase).toContain(`when '${code}' then ${factor}::numeric`);
    const massList = /when p_unit in \(([^)]*)\) then 'mass'/.exec(unitBase)![1];
    const volumeList = /when p_unit in \(([^)]*)\) then 'volume'/.exec(unitBase)![1];
    expect(massList.includes(`'${code}'`)).toBe(kind === "mass");
    expect(volumeList.includes(`'${code}'`)).toBe(kind === "volume");
  });
});

describe("在庫量の合計", () => {
  it("互換単位ごとに基準単位で合計し、違う個数単位は分ける", () => {
    const totals = totalsByGroup([
      { quantity: 300, unit: "g" },
      { quantity: 0.5, unit: "kg" },
      { quantity: 2, unit: "個" },
      { quantity: 1, unit: "パック" },
      { quantity: 3, unit: "大さじ" },
    ]);
    expect(Object.fromEntries(totals)).toEqual({ mass: 800, "count:個": 2, "count:パック": 1, volume: 45 });
  });
});
