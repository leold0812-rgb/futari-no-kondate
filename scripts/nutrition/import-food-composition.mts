/**
 * 食品成分表を取り込む（Gate 2b）。ユーザーが公式サイトから入手したデータをCSVにして渡す。
 *
 *   node --env-file=.env.bootstrap.local scripts/nutrition/import-food-composition.mts \
 *     --project-ref <ref> --file <csv> --version "日本食品標準成分表（八訂）増補2023年"          # 確認のみ
 *   … --apply                                                                              # 取り込む
 *
 * 必要な環境変数: NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY
 * 同じ版・同じ食品番号は上書きする（何度実行しても同じ結果）。
 */
import { createClient } from "@supabase/supabase-js";
import { readFileSync } from "node:fs";
import { parseArgs } from "node:util";
import { checkAdminKey, checkKnownProject, checkSupabaseTarget } from "../lib/supabase-target.mts";
import { readFoodRows } from "./food-csv.mts";

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
      version: { type: "string" },
      apply: { type: "boolean", default: false },
    },
    strict: true,
  });
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim() ?? "";
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim() ?? "";
  const problem = checkSupabaseTarget(url, values["project-ref"]) ??
    checkKnownProject(values["project-ref"], values["production-ref"]) ??
    checkAdminKey(key);
  if (problem) fail(problem);
  if (!values.file) fail("--file にCSVファイルを指定してください。");
  const version = values.version?.trim();
  if (!version || version.length > 60) fail("--version に成分表の版（60文字以内）を指定してください。");

  const { rows, skipped } = readFoodRows(readFileSync(values.file, "utf8"));
  console.log(`読み取り: ${rows.length}件（値の無い・形式の違う行 ${skipped.length}件は取り込みません）`);
  if (!values.apply) {
    console.log("確認のみのため取り込んでいません。取り込むには --apply を付けてください。");
    return;
  }
  const admin = createClient(url, key, { auth: { autoRefreshToken: false, persistSession: false } });
  for (let i = 0; i < rows.length; i += 500) {
    const batch = rows.slice(i, i + 500).map((r) => ({
      source_version: version,
      food_number: r.foodNumber,
      name: r.name,
      energy_kcal: r.energyKcal,
      protein_g: r.proteinG,
      fat_g: r.fatG,
      carbs_g: r.carbsG,
    }));
    const { error } = await admin.from("food_composition_items").upsert(batch, { onConflict: "source_version,food_number" });
    if (error) fail(`取り込めませんでした（${i + 1}件目から）: ${error.message}`);
  }
  console.log(`完了: ${rows.length}件を取り込みました（版：${version}）。`);
}

main().catch((error: unknown) => fail(error instanceof Error ? error.message : "不明なエラーで停止しました。"));
