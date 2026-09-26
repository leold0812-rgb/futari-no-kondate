/** レシピの区分と表示名（DBのcheck制約と同じ値。supabase/migrations/20260929090000_create_recipes.sql） */

export const DISH_TYPES = ["MAIN", "SIDE", "SOUP"] as const;
export type DishType = (typeof DISH_TYPES)[number];
export const DISH_TYPE_LABELS: Record<DishType, string> = { MAIN: "主菜", SIDE: "副菜", SOUP: "汁物" };

export const MAIN_CATEGORIES = ["MEAT", "FISH", "EGG_SOY", "NOODLE", "RICE", "VEGETABLE", "OTHER"] as const;
export type MainCategory = (typeof MAIN_CATEGORIES)[number];
export const MAIN_CATEGORY_LABELS: Record<MainCategory, string> = {
  MEAT: "肉",
  FISH: "魚",
  EGG_SOY: "卵・大豆",
  NOODLE: "麺",
  RICE: "ごはんもの",
  VEGETABLE: "野菜",
  OTHER: "その他",
};

export const CUISINES = ["JAPANESE", "WESTERN", "CHINESE", "KOREAN", "ETHNIC", "OTHER"] as const;
export type Cuisine = (typeof CUISINES)[number];
export const CUISINE_LABELS: Record<Cuisine, string> = {
  JAPANESE: "和風",
  WESTERN: "洋風",
  CHINESE: "中華",
  KOREAN: "韓国",
  ETHNIC: "エスニック",
  OTHER: "その他",
};

export const RECIPE_STATUSES = ["URL_ONLY", "DRAFT", "READY"] as const;
export type RecipeStatus = (typeof RECIPE_STATUSES)[number];
export const RECIPE_STATUS_LABELS: Record<RecipeStatus, string> = {
  URL_ONLY: "URLのみ",
  DRAFT: "下書き",
  READY: "登録済み",
};

export const RATINGS = ["MAKE_AGAIN", "NORMAL", "NEVER_AGAIN"] as const;
export type Rating = (typeof RATINGS)[number];
export const RATING_LABELS: Record<Rating, string> = {
  MAKE_AGAIN: "また作りたい",
  NORMAL: "ふつう",
  NEVER_AGAIN: "もう作らない",
};

/**
 * 推薦で使うタグ（docs/recommendation.md：栄養基準値が決まるまではタグを根拠にする）。
 * 自由入力のタグも付けられるが、推薦はこの一覧のタグだけを読む。
 */
export const KNOWN_TAGS = ["高タンパク", "低カロリー", "時短", "作り置き向き", "野菜たっぷり"] as const;

export const SERVINGS_CHOICES = [1, 2, 3, 4] as const;
export const RECIPE_SORTS = ["new", "rating", "quick", "name"] as const;
export type RecipeSort = (typeof RECIPE_SORTS)[number];
export const RECIPE_SORT_LABELS: Record<RecipeSort, string> = {
  new: "新しい順",
  rating: "評価が高い順",
  quick: "調理時間が短い順",
  name: "名前順",
};
