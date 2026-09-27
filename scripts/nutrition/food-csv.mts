/**
 * 食品成分表CSVの読み取り（取り込みスクリプト用の純粋関数）。
 *
 * 期待する列（1行目は見出し）：food_number,name,energy_kcal,protein_g,fat_g,carbs_g
 * 成分表の表記：「Tr」（微量）は0、「(0.1)」（推定値）は0.1、「-」や空欄は値なし（その食品は取り込まない）。
 */

export type FoodRow = {
  foodNumber: string;
  name: string;
  energyKcal: number;
  proteinG: number;
  fatG: number;
  carbsG: number;
};

/** ダブルクォート・カンマ・改行を含む1ファイル分のCSVを行の配列へ */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  const input = text.replace(/^﻿/, "");
  for (let i = 0; i < input.length; i += 1) {
    const c = input[i];
    if (quoted) {
      if (c === '"' && input[i + 1] === '"') {
        field += '"';
        i += 1;
      } else if (c === '"') {
        quoted = false;
      } else {
        field += c;
      }
      continue;
    }
    if (c === '"') quoted = true;
    else if (c === ",") {
      row.push(field);
      field = "";
    } else if (c === "\n" || c === "\r") {
      if (c === "\r" && input[i + 1] === "\n") i += 1;
      row.push(field);
      if (row.some((v) => v.trim() !== "")) rows.push(row);
      row = [];
      field = "";
    } else field += c;
  }
  row.push(field);
  if (row.some((v) => v.trim() !== "")) rows.push(row);
  return rows;
}

/** 成分表の値の表記を数値へ。値なしはnull */
export function parseComponentValue(raw: string): number | null {
  const text = raw.normalize("NFKC").trim();
  if (text === "" || text === "-" || text === "*") return null;
  if (/^tr$/i.test(text) || /^\(tr\)$/i.test(text)) return 0;
  const value = Number(text.replace(/^\((.*)\)$/, "$1"));
  return Number.isFinite(value) && value >= 0 ? value : null;
}

const REQUIRED = ["food_number", "name", "energy_kcal", "protein_g", "fat_g", "carbs_g"] as const;

export function readFoodRows(text: string): { rows: FoodRow[]; skipped: string[] } {
  const [header, ...body] = parseCsv(text);
  if (!header) throw new Error("CSVが空です。");
  const index = Object.fromEntries(REQUIRED.map((name) => [name, header.findIndex((h) => h.trim() === name)]));
  const missing = REQUIRED.filter((name) => index[name] < 0);
  if (missing.length > 0) throw new Error(`見出しに ${missing.join(", ")} がありません。`);

  const rows: FoodRow[] = [];
  const skipped: string[] = [];
  for (const cells of body) {
    const foodNumber = (cells[index.food_number] ?? "").trim().padStart(5, "0");
    const name = (cells[index.name] ?? "").trim();
    const values = [index.energy_kcal, index.protein_g, index.fat_g, index.carbs_g].map((i) => parseComponentValue(cells[i] ?? ""));
    if (!/^\d{5}$/.test(foodNumber) || !name || values.some((v) => v === null)) {
      skipped.push(foodNumber || name || "(不明)");
      continue;
    }
    const [energyKcal, proteinG, fatG, carbsG] = values as number[];
    rows.push({ foodNumber, name: name.slice(0, 200), energyKcal, proteinG, fatG, carbsG });
  }
  return { rows, skipped };
}
