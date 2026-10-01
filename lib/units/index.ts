/**
 * 材料の単位（Gate 2 / 4 / 6）。副作用のない純粋関数。
 *
 * 方針（AGENTS.md「数量の合算・減算は互換単位だけで行う」）:
 *   - 質量（g / kg）どうし、体積（ml / L / 大さじ / 小さじ / カップ / 合）どうしだけを換算する。
 *   - 個数系の単位（個・本・枚…）は同じ単位どうしだけを合算する（1個≠1本）。
 *   - 質量↔体積（密度）や個数↔質量は食材ごとに違うため、ここでは換算しない。
 *   - 「少々」「適量」など数えられない分量は quantity=null として扱い、合算しない。
 *
 * DB側の在庫減算（supabase/migrations の private.unit_base）と定義をそろえる。変更時は両方を直す。
 */

export type UnitKind = "mass" | "volume" | "count";

type UnitDefinition = {
  code: string;
  kind: UnitKind;
  /** 基準単位（質量はg、体積はml）への係数。個数系は1 */
  factor: number;
  aliases: readonly string[];
};

const UNIT_DEFINITIONS: readonly UnitDefinition[] = [
  { code: "g", kind: "mass", factor: 1, aliases: ["グラム", "gr", "ｇ", "Ｇ"] },
  { code: "kg", kind: "mass", factor: 1000, aliases: ["キロ", "キログラム", "ｋｇ", "Kg", "KG"] },
  { code: "ml", kind: "volume", factor: 1, aliases: ["mL", "ML", "cc", "ｃｃ", "ミリリットル", "ｍｌ"] },
  { code: "L", kind: "volume", factor: 1000, aliases: ["l", "ℓ", "リットル", "Ｌ"] },
  { code: "大さじ", kind: "volume", factor: 15, aliases: ["大匙", "大サジ", "おおさじ", "tbsp", "Tbsp"] },
  { code: "小さじ", kind: "volume", factor: 5, aliases: ["小匙", "小サジ", "こさじ", "tsp"] },
  { code: "カップ", kind: "volume", factor: 200, aliases: ["cup", "Cup", "かっぷ"] },
  { code: "合", kind: "volume", factor: 180, aliases: [] },
  { code: "個", kind: "count", factor: 1, aliases: ["コ", "こ", "ケ"] },
  { code: "本", kind: "count", factor: 1, aliases: [] },
  { code: "枚", kind: "count", factor: 1, aliases: [] },
  { code: "束", kind: "count", factor: 1, aliases: ["わ"] },
  { code: "袋", kind: "count", factor: 1, aliases: [] },
  { code: "パック", kind: "count", factor: 1, aliases: ["pack", "P"] },
  { code: "玉", kind: "count", factor: 1, aliases: [] },
  { code: "株", kind: "count", factor: 1, aliases: [] },
  { code: "切れ", kind: "count", factor: 1, aliases: ["切", "きれ"] },
  { code: "片", kind: "count", factor: 1, aliases: ["かけ"] },
  { code: "尾", kind: "count", factor: 1, aliases: ["匹"] },
  { code: "缶", kind: "count", factor: 1, aliases: [] },
  { code: "丁", kind: "count", factor: 1, aliases: [] },
  { code: "房", kind: "count", factor: 1, aliases: [] },
  { code: "粒", kind: "count", factor: 1, aliases: [] },
  { code: "箱", kind: "count", factor: 1, aliases: [] },
  { code: "瓶", kind: "count", factor: 1, aliases: ["びん"] },
  { code: "杯", kind: "count", factor: 1, aliases: [] },
];

/** 数量を持たない分量表現 */
export const UNQUANTIFIED_WORDS = ["少々", "適量", "適宜", "ひとつまみ", "お好みで", "少量", "ひとつかみ"] as const;

const BY_CODE = new Map(UNIT_DEFINITIONS.map((u) => [u.code, u]));
const BY_ALIAS = new Map<string, UnitDefinition>();
for (const unit of UNIT_DEFINITIONS) {
  BY_ALIAS.set(unit.code, unit);
  for (const alias of unit.aliases) BY_ALIAS.set(alias, unit);
}

/** 画面の単位候補（入力補助用） */
export const UNIT_CHOICES: readonly string[] = UNIT_DEFINITIONS.map((u) => u.code);

/** 表記ゆれを正規の単位コードへ。知らない単位はnull（呼び出し側で元の表記を残す） */
export function normalizeUnit(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const trimmed = raw.normalize("NFKC").trim();
  if (!trimmed) return null;
  return (BY_ALIAS.get(trimmed) ?? BY_ALIAS.get(raw.trim()) ?? BY_ALIAS.get(trimmed.toLowerCase()))?.code ?? null;
}

/**
 * 合算してよい単位の組を表すキー。質量は"mass"、体積は"volume"、個数系は"count:<単位>"、
 * 未知の単位は"other:<表記>"（同じ表記どうしだけ合算できる）。単位なしは"none"。
 */
export function unitGroup(unit: string | null | undefined): string {
  const code = normalizeUnit(unit);
  if (!code) return unit?.trim() ? `other:${unit.trim()}` : "none";
  const def = BY_CODE.get(code)!;
  return def.kind === "count" ? `count:${code}` : def.kind;
}

export function unitKind(unit: string | null | undefined): UnitKind | null {
  const code = normalizeUnit(unit);
  return code ? BY_CODE.get(code)!.kind : null;
}

/** 質量はg、体積はmlへ。個数系は同じ値。未知の単位はnull */
export function toBaseQuantity(quantity: number, unit: string | null | undefined): number | null {
  const code = normalizeUnit(unit);
  if (!code) return null;
  return quantity * BY_CODE.get(code)!.factor;
}

/** 互換単位どうしだけ換算する。互換でなければnull */
export function convertQuantity(quantity: number, from: string | null | undefined, to: string | null | undefined): number | null {
  if (unitGroup(from) !== unitGroup(to)) return null;
  const fromCode = normalizeUnit(from);
  const toCode = normalizeUnit(to);
  if (!fromCode || !toCode) {
    // 未知の単位・単位なしは同じ表記のときだけ同一とみなす
    return (from ?? "").trim() === (to ?? "").trim() ? quantity : null;
  }
  return (quantity * BY_CODE.get(fromCode)!.factor) / BY_CODE.get(toCode)!.factor;
}

/** 表示用の丸め。大きい値は整数、小さい値は小数1桁まで。fractions なら料理でよく使う分数（1/2など）で見せる */
export function formatNumber(value: number, fractions = true): string {
  if (!Number.isFinite(value)) return "";
  const fractionsEnabled = fractions;
  const fractionTable: [number, string][] = [
    [0.25, "1/4"],
    [0.5, "1/2"],
    [0.75, "3/4"],
    [1 / 3, "1/3"],
    [2 / 3, "2/3"],
  ];
  const whole = Math.floor(value);
  const rest = value - whole;
  if (fractionsEnabled && value < 10) {
    for (const [fraction, label] of fractionTable) {
      if (Math.abs(rest - fraction) < 0.02) return whole === 0 ? label : `${whole}と${label}`;
    }
  }
  if (value >= 100) return String(Math.round(value));
  const rounded = Math.round(value * 10) / 10;
  return Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(1);
}

/** 「大さじ1と1/2」「200g」「1個」のように単位の位置も日本語の慣習に合わせて表示する */
export function formatQuantity(quantity: number | null, unit: string | null | undefined): string {
  const unitLabel = normalizeUnit(unit) ?? unit?.trim() ?? "";
  if (quantity === null) return unitLabel;
  // 分数で書くのは計量スプーン・カップと個数の単位だけ（g・kg・ml・Lは小数）
  const kind = unitKind(unitLabel);
  const fractional = kind === "count" || unitLabel === "大さじ" || unitLabel === "小さじ" || unitLabel === "カップ" || kind === null;
  const number = formatNumber(quantity, fractional);
  if (unitLabel === "大さじ" || unitLabel === "小さじ" || unitLabel === "カップ") return `${unitLabel}${number}`;
  return `${number}${unitLabel}`;
}

/**
 * 合算結果を読みやすい単位で表示する。質量は1000g以上をkg、体積は大さじ・小さじで表せる少量はそれで表す。
 * baseQuantity は toBaseQuantity の値（g / ml）。
 */
export function formatBaseQuantity(baseQuantity: number, group: string): string {
  if (group === "mass") {
    return baseQuantity >= 1000 ? formatQuantity(baseQuantity / 1000, "kg") : formatQuantity(baseQuantity, "g");
  }
  if (group === "volume") {
    if (baseQuantity >= 1000) return formatQuantity(baseQuantity / 1000, "L");
    if (baseQuantity < 15) return formatQuantity(baseQuantity / 5, "小さじ");
    if (baseQuantity < 50 && Math.abs(baseQuantity / 15 - Math.round(baseQuantity / 15 * 2) / 2) < 0.01) {
      return formatQuantity(baseQuantity / 15, "大さじ");
    }
    return formatQuantity(baseQuantity, "ml");
  }
  if (group.startsWith("count:")) return formatQuantity(baseQuantity, group.slice("count:".length));
  if (group.startsWith("other:")) return formatQuantity(baseQuantity, group.slice("other:".length));
  return formatNumber(baseQuantity);
}

/** 人数換算。料理で扱いやすいよう個数系は0.25刻み、それ以外は有効数字を保って丸める */
export function scaleQuantity(quantity: number | null, factor: number, unit: string | null | undefined): number | null {
  if (quantity === null) return null;
  const scaled = quantity * factor;
  if (unitKind(unit) === "count") return Math.max(0.25, Math.round(scaled * 4) / 4);
  if (scaled >= 10) return Math.round(scaled);
  return Math.round(scaled * 100) / 100;
}

const NUMBER_PATTERN = "(\\d+\\s*/\\s*\\d+|\\d+(?:\\.\\d+)?(?:\\s*と\\s*\\d+\\s*/\\s*\\d+)?)";

function parseNumberText(text: string): number | null {
  const mixed = /^(\d+)\s*と\s*(\d+)\s*\/\s*(\d+)$/.exec(text);
  if (mixed) return Number(mixed[1]) + Number(mixed[2]) / Number(mixed[3]);
  const fraction = /^(\d+)\s*\/\s*(\d+)$/.exec(text);
  if (fraction) return Number(fraction[2]) === 0 ? null : Number(fraction[1]) / Number(fraction[2]);
  const value = Number(text);
  return Number.isFinite(value) ? value : null;
}

export type ParsedAmount = { quantity: number | null; unit: string | null };

/**
 * 分量の文字列を数量と単位へ分ける（URL取り込み・手入力の補助）。
 * 例: "200g" → 200 g、"大さじ1と1/2" → 1.5 大さじ、"1/2個" → 0.5 個、"少々" → null 少々、"2〜3個" → 2 個（下限）
 *     "大1" → 1 大さじ、"小1/2" → 0.5 小さじ（レシピの略記）、"1片(10g)" → 1 片、"1/2個分" → 0.5 個
 * 解釈できない場合は quantity=null、unit=元の文字列（空ならnull）。
 */
export function parseAmount(raw: string | null | undefined): ParsedAmount {
  if (!raw) return { quantity: null, unit: null };
  const text = raw
    .replace(/[½]/g, "1/2")
    .replace(/[¼]/g, "1/4")
    .replace(/[¾]/g, "3/4")
    .normalize("NFKC")
    .replace(/⁄/g, "/")
    .replace(/\s+/g, "")
    .replace(/[〜~～]\s*\d+(?:\.\d+)?/, "")
    .trim();
  if (!text) return { quantity: null, unit: null };
  if ((UNQUANTIFIED_WORDS as readonly string[]).includes(text)) return { quantity: null, unit: text };

  // 前置単位（大さじ・小さじ・カップ）
  const prefixed = new RegExp(`^(大さじ|小さじ|大匙|小匙|カップ)${NUMBER_PATTERN}(?:杯)?$`).exec(text);
  if (prefixed) {
    const quantity = parseNumberText(prefixed[2]);
    return { quantity, unit: normalizeUnit(prefixed[1]) };
  }
  // レシピの略記「大1」「小1/2」（数字で終わる場合だけ。「大2個」は大きめ2個の意味なので扱わない）
  const shorthand = new RegExp(`^(大|小)${NUMBER_PATTERN}$`).exec(text);
  if (shorthand) {
    return { quantity: parseNumberText(shorthand[2]), unit: shorthand[1] === "大" ? "大さじ" : "小さじ" };
  }
  // 数値＋後置単位
  const suffixed = new RegExp(`^${NUMBER_PATTERN}(.*)$`).exec(text);
  if (suffixed) {
    const quantity = parseNumberText(suffixed[1]);
    // 「1片(10g)」の補足や「1/2個分」の「分」は単位に含めない
    const unitText = suffixed[2].replace(/[(（].*[)）]$/, "");
    if (!unitText) return { quantity, unit: null };
    const known = normalizeUnit(unitText) ?? (unitText.endsWith("分") ? normalizeUnit(unitText.slice(0, -1)) : null);
    return { quantity, unit: known ?? unitText };
  }
  return { quantity: null, unit: text };
}
