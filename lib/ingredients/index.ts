/**
 * 材料名の正規化とカテゴリの推定（Gate 2）。副作用のない純粋関数。
 *
 * レシピの材料行（「玉ねぎ（中）」「★醤油」など）を材料マスタの名前へそろえ、在庫・買い物で合算できるようにする。
 * カテゴリと保存目安は新しい材料を作るときの初期値で、利用者があとから直せる。
 */

export const INGREDIENT_CATEGORIES = [
  "VEGETABLE",
  "MEAT",
  "FISH",
  "EGG_DAIRY",
  "SOY",
  "GRAIN",
  "SEASONING",
  "DRY_CANNED",
  "FROZEN",
  "OTHER",
] as const;

export type IngredientCategory = (typeof INGREDIENT_CATEGORIES)[number];

export const INGREDIENT_CATEGORY_LABELS: Record<IngredientCategory, string> = {
  VEGETABLE: "野菜・果物",
  MEAT: "肉",
  FISH: "魚介",
  EGG_DAIRY: "卵・乳製品",
  SOY: "豆腐・大豆製品",
  GRAIN: "米・麺・パン",
  SEASONING: "調味料",
  DRY_CANNED: "乾物・缶詰",
  FROZEN: "冷凍食品",
  OTHER: "その他",
};

/**
 * 新しい材料の保存目安（購入日からの日数）の初期値。
 * 一般的な冷蔵保存を想定した控えめな目安で、正確な消費期限ではない（画面では「目安」と表示し、材料ごとに変更できる）。
 */
export const DEFAULT_STORAGE_DAYS: Record<IngredientCategory, number | null> = {
  VEGETABLE: 5,
  MEAT: 2,
  FISH: 1,
  EGG_DAIRY: 10,
  SOY: 3,
  GRAIN: 60,
  SEASONING: null,
  DRY_CANNED: null,
  FROZEN: 30,
  OTHER: 7,
};

/**
 * 名前に含まれる語からカテゴリを推定する（上から順に最初に一致したものを採用）。推定できなければOTHER。
 * 「塩鮭」「油揚げ」「米酢」のような語の重なりに備え、調味料と確実に分かる語 → 具体的な食材 → 一般的な調味料の順に調べる。
 */
const CATEGORY_KEYWORDS: readonly [IngredientCategory, readonly string[]][] = [
  ["SEASONING", ["の素", "鶏ガラ", "だし", "出汁", "コンソメ", "ソース", "つゆ", "ドレッシング", "ルウ", "ルー", "酢", "料理酒", "ごま油", "胡麻油"]],
  ["FROZEN", ["冷凍"]],
  ["DRY_CANNED", ["缶", "ツナ", "乾燥", "干し", "切り干し", "ひじき", "わかめ", "海苔", "のり", "春雨", "鰹節", "かつお節", "昆布"]],
  ["SOY", ["豆腐", "厚揚げ", "油揚げ", "納豆", "豆乳", "大豆"]],
  ["FISH", ["魚", "鮭", "さけ", "サーモン", "鯖", "さば", "鯵", "あじ", "ぶり", "鱈", "たら", "えび", "海老", "いか", "たこ", "あさり", "しらす", "ほたて", "帆立", "かに"]],
  // 「牛乳」を肉（牛）と誤判定しないよう、卵・乳製品を肉より先に調べる
  ["EGG_DAIRY", ["卵", "たまご", "玉子", "牛乳", "チーズ", "ヨーグルト", "生クリーム"]],
  ["MEAT", ["肉", "鶏", "豚", "牛", "ひき", "挽", "ベーコン", "ハム", "ソーセージ", "ウインナー", "ささみ", "手羽"]],
  ["GRAIN", ["米", "ご飯", "ごはん", "うどん", "そば", "パスタ", "スパゲッティ", "麺", "パン", "餅", "もち", "マカロニ"]],
  [
    "VEGETABLE",
    [
      "玉ねぎ", "たまねぎ", "玉葱", "にんじん", "人参", "じゃがいも", "キャベツ", "白菜", "大根", "ねぎ", "葱", "ほうれん草", "小松菜",
      "もやし", "ピーマン", "なす", "茄子", "トマト", "きゅうり", "ブロッコリー", "かぼちゃ", "きのこ", "しめじ", "えのき", "椎茸",
      "しいたけ", "まいたけ", "エリンギ", "レタス", "にら", "ニラ", "ごぼう", "れんこん", "生姜", "しょうが", "にんにく", "大葉",
      "アボカド", "レモン", "りんご", "バナナ", "水菜", "チンゲン菜", "オクラ", "アスパラ", "さつまいも", "里芋", "長芋", "セロリ", "パプリカ",
    ],
  ],
  [
    "SEASONING",
    [
      "醤油", "しょうゆ", "しょう油", "塩", "砂糖", "みりん", "酒", "味噌", "みそ", "こしょう", "胡椒", "ケチャップ", "マヨネーズ",
      "油", "オイル", "豆板醤", "コチュジャン", "オイスター", "ポン酢", "片栗粉", "小麦粉", "薄力粉", "パン粉", "ナンプラー",
      "カレー粉", "バター", "はちみつ", "わさび", "からし", "唐辛子", "ごま", "胡麻",
    ],
  ],
];

export function guessIngredientCategory(name: string): IngredientCategory {
  const normalized = name.normalize("NFKC");
  for (const [category, keywords] of CATEGORY_KEYWORDS) {
    if (keywords.some((keyword) => normalized.includes(keyword))) return category;
  }
  return "OTHER";
}

/**
 * レシピの材料行の名前から、材料マスタに使う名前を作る。
 * - 記号（★☆●◎◯・※*）や先頭の「A」「(A)」などのグループ記号を除く
 * - 括弧内の補足（「（中）」「(皮をむく)」）を除く
 * - 全角英数字・空白をNFKCで正規化する
 * 空になった場合はnull（材料マスタに対応付けない）。
 */
export function normalizeIngredientName(raw: string): string | null {
  let name = raw.normalize("NFKC").trim();
  name = name.replace(/^[★☆●○◎◯・※*＊■□◆◇▲△▼▽-]+/, "");
  name = name.replace(/^\(?[A-Za-zＡ-Ｚａ-ｚ]\)?[\s.．:：]+/, "");
  name = name.replace(/[(（【\[].*?[)）】\]]/g, "");
  name = name.replace(/\s+/g, " ").trim();
  if (!name || name.length > 40) return name ? name.slice(0, 40) : null;
  return name;
}

/** 「少々」「適量」のように在庫で数えない調味料行か（数量なし） */
export function isUncountedLine(quantity: number | null): boolean {
  return quantity === null;
}

/**
 * 「鶏もも肉 300g」「玉ねぎ…1個」「塩 少々」のような1行を材料名と分量の文字列に分ける（貼り付け・URL取り込み用）。
 * 分量が見つからなければ amount は空文字。
 */
export function splitIngredientLine(line: string): { rawName: string; amount: string } | null {
  const text = line.normalize("NFKC").trim().replace(/^[・\-*●◯○]\s*/, "");
  if (!text) return null;
  const match =
    /^(.+?)(?:\s*[…:：.]{1,}\s*|\s+)([0-9½¼¾]|大さじ|小さじ|カップ|少々|適量|適宜|ひとつまみ|お好みで)(.*)$/.exec(text);
  if (!match) return { rawName: text.slice(0, 60), amount: "" };
  return { rawName: match[1].trim().slice(0, 60), amount: `${match[2]}${match[3]}`.trim() };
}
