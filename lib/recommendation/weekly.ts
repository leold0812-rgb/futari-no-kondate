/**
 * 週間推薦（Gate 5、docs/recommendation.md「週間推薦仕様 v0」）。AIを使わない、説明可能で決定的な純粋関数。
 * 同じ入力と ALGORITHM_VERSION からは必ず同じ10件を同じ順で返す。係数を変えたら版を上げる。
 */
import { daysBetween } from "@/lib/dates";
import type { MainCategory, Rating } from "@/lib/recipes/constants";

export const ALGORITHM_VERSION = "weekly-v0.1";
export const CANDIDATE_COUNT = 10;

export type RecommendationRecipe = {
  id: string;
  name: string;
  dishType: "MAIN" | "SIDE" | "SOUP";
  status: "URL_ONLY" | "DRAFT" | "READY";
  mainCategory: MainCategory | null;
  createdAt: string;
  tags: string[];
  highCost: boolean;
  specialSeasoning: boolean;
  /** 2人分の評価（未評価は含めない） */
  ratings: Rating[];
  favoriteCount: number;
  /** 最後に作った日（日本時間の暦日）。未調理はnull */
  lastCookedOn: string | null;
  cookCount: number;
  /** 主な材料（無ければ全材料）の材料ID */
  mainIngredientIds: string[];
};

export type RecommendationContext = {
  today: string;
  /** 在庫がある材料ID */
  inStockIngredientIds: ReadonlySet<string>;
};

export type ScoreItem = { label: string; points: number };

export type ScoredCandidate = {
  recipeId: string;
  name: string;
  score: number;
  breakdown: ScoreItem[];
  /** 選ばれた理由・緩和の記録 */
  notes: string[];
};

export type WeeklyRecommendation = {
  algorithmVersion: string;
  candidates: ScoredCandidate[];
  /** 全体の注意（候補不足など） */
  notes: string[];
};

const MAIN_CATEGORY_CAP = Math.floor(CANDIDATE_COUNT / 2); // 同じ大分類は過半数（6件以上）にしない
const RECENT_DAYS = 30;

/** 通常の候補にできるか（主菜・READY・どちらも「もう作らない」にしていない） */
export function isEligible(recipe: RecommendationRecipe): boolean {
  return recipe.dishType === "MAIN" && recipe.status === "READY" && !recipe.ratings.includes("NEVER_AGAIN");
}

/** 1品ずつの基本スコア（他の候補との食材の使い回しは選定時に加点する） */
export function baseScore(recipe: RecommendationRecipe, context: RecommendationContext): ScoreItem[] {
  const items: ScoreItem[] = [];
  const makeAgain = recipe.ratings.filter((r) => r === "MAKE_AGAIN").length;
  if (makeAgain > 0) items.push({ label: `また作りたい（${makeAgain}人）`, points: 14 * makeAgain });
  if (recipe.favoriteCount > 0) items.push({ label: `お気に入り（${recipe.favoriteCount}人）`, points: 6 * Math.min(recipe.favoriteCount, 2) });
  if (recipe.cookCount === 0) items.push({ label: "まだ作っていない", points: 8 });
  if (recipe.tags.includes("高タンパク")) items.push({ label: "高タンパク", points: 12 });
  if (recipe.tags.includes("低カロリー")) items.push({ label: "低カロリー", points: 10 });

  if (recipe.mainIngredientIds.length > 0) {
    const covered = recipe.mainIngredientIds.filter((id) => context.inStockIngredientIds.has(id)).length;
    const points = Math.round((covered / recipe.mainIngredientIds.length) * 10);
    if (points > 0) items.push({ label: `在庫で主な材料を賄える（${covered}/${recipe.mainIngredientIds.length}）`, points });
  }
  if (recipe.lastCookedOn) {
    const days = daysBetween(recipe.lastCookedOn, context.today);
    if (days < RECENT_DAYS) {
      const points = -Math.round(10 * (1 - Math.max(0, days) / RECENT_DAYS));
      if (points < 0) items.push({ label: `${Math.max(0, days)}日前に作った`, points });
    }
  }
  if (recipe.highCost) items.push({ label: "材料費が高め", points: -8 });
  if (recipe.specialSeasoning) items.push({ label: "ふだん無い調味料が必要", points: -4 });
  return items;
}

const sum = (items: ScoreItem[]) => items.reduce((total, item) => total + item.points, 0);

type Scored = { recipe: RecommendationRecipe; items: ScoreItem[]; score: number };

/** 同点は 未調理 → 最後に作ったのが古い → 追加が新しい → ID の順（仕様どおりの決定的な並び） */
function compareScored(a: Scored, b: Scored): number {
  if (b.score !== a.score) return b.score - a.score;
  const aNew = a.recipe.cookCount === 0 ? 0 : 1;
  const bNew = b.recipe.cookCount === 0 ? 0 : 1;
  if (aNew !== bNew) return aNew - bNew;
  const aLast = a.recipe.lastCookedOn ?? "";
  const bLast = b.recipe.lastCookedOn ?? "";
  if (aLast !== bLast) return aLast.localeCompare(bLast);
  if (a.recipe.createdAt !== b.recipe.createdAt) return b.recipe.createdAt.localeCompare(a.recipe.createdAt);
  return a.recipe.id.localeCompare(b.recipe.id);
}

/** 選定済みの候補と主な材料を共有する数に応じて0〜8点（使い回し） */
function reuseItem(recipe: RecommendationRecipe, selected: Scored[]): ScoreItem | null {
  if (selected.length === 0 || recipe.mainIngredientIds.length === 0) return null;
  const used = new Set(selected.flatMap((s) => s.recipe.mainIngredientIds));
  const shared = recipe.mainIngredientIds.filter((id) => used.has(id)).length;
  const points = Math.min(8, shared * 4);
  return points > 0 ? { label: `他の候補と材料を使い回せる（${shared}品）`, points } : null;
}

export function recommendWeekly(recipes: RecommendationRecipe[], context: RecommendationContext): WeeklyRecommendation {
  const notes: string[] = [];
  const pool: Scored[] = recipes
    .filter(isEligible)
    .map((recipe) => {
      const items = baseScore(recipe, context);
      return { recipe, items, score: sum(items) };
    })
    .sort(compareScored);

  if (pool.length < CANDIDATE_COUNT) {
    notes.push(`候補にできる主菜が${pool.length}品のため、全部を候補にしました（10品に足りません）。`);
  }

  const selected: Scored[] = [];
  const selectedIds = new Set<string>();
  const selectedNotes = new Map<string, string[]>();
  const categoryCount = (category: MainCategory | null) =>
    category ? selected.filter((s) => s.recipe.mainCategory === category).length : 0;
  const highCostCount = () => selected.filter((s) => s.recipe.highCost).length;

  type Rules = { highCostCap: number; categoryCap: number };
  const allowed = (s: Scored, rules: Rules) =>
    !selectedIds.has(s.recipe.id) &&
    (!s.recipe.highCost || highCostCount() < rules.highCostCap) &&
    (!s.recipe.mainCategory || categoryCount(s.recipe.mainCategory) < rules.categoryCap);

  /** 残りから、使い回し加点を含めて最もよい1品を選ぶ */
  function pickBest(candidates: Scored[], rules: Rules): Scored | null {
    let best: Scored | null = null;
    let bestTotal = -Infinity;
    for (const s of candidates) {
      if (!allowed(s, rules)) continue;
      const reuse = reuseItem(s.recipe, selected);
      const total = s.score + (reuse?.points ?? 0);
      if (total > bestTotal || (total === bestTotal && best && compareScored(s, best) < 0)) {
        best = reuse ? { ...s, items: [...s.items, reuse], score: total } : s;
        bestTotal = total;
      }
    }
    return best;
  }

  function add(s: Scored, note?: string) {
    // 選定理由（未調理の枠・条件の緩和）は内訳にも0点の項目として残す（仕様：選定理由のbreakdownを保存）
    if (note) s = { ...s, items: [...s.items, { label: note, points: 0 }] };
    selected.push(s);
    selectedIds.add(s.recipe.id);
    if (note) selectedNotes.set(s.recipe.id, [...(selectedNotes.get(s.recipe.id) ?? []), note]);
  }

  const strict: Rules = { highCostCap: 1, categoryCap: MAIN_CATEGORY_CAP };

  // 1. 未調理を原則2品。対象が十分（候補15品以上・未調理3品以上）なら3品
  const uncooked = pool.filter((s) => s.recipe.cookCount === 0);
  const uncookedTarget = Math.min(uncooked.length, pool.length >= 15 && uncooked.length >= 3 ? 3 : 2);
  while (selected.filter((s) => s.recipe.cookCount === 0).length < uncookedTarget) {
    const next = pickBest(uncooked, strict);
    if (!next) break;
    add(next, "まだ作っていない料理の枠");
  }

  // 2. 残りをスコア順（使い回し加点込み）で埋める。高コストは1品まで、同じ大分類は5品まで
  while (selected.length < Math.min(CANDIDATE_COUNT, pool.length)) {
    const next = pickBest(pool, strict);
    if (!next) break;
    add(next);
  }

  // 3. 足りなければ条件を緩めて埋め、理由を残す
  if (selected.length < Math.min(CANDIDATE_COUNT, pool.length)) {
    const relaxations: [Rules, string][] = [
      [{ highCostCap: 2, categoryCap: MAIN_CATEGORY_CAP }, "候補が足りないため、材料費が高めの料理を2品目として入れました"],
      [{ highCostCap: 2, categoryCap: CANDIDATE_COUNT }, "候補が足りないため、同じ大分類の料理が多くなっています"],
      [{ highCostCap: CANDIDATE_COUNT, categoryCap: CANDIDATE_COUNT }, "候補が足りないため、条件を外して選びました"],
    ];
    for (const [rules, reason] of relaxations) {
      while (selected.length < Math.min(CANDIDATE_COUNT, pool.length)) {
        const next = pickBest(pool, rules);
        if (!next) break;
        add(next, reason);
        if (!notes.includes(reason)) notes.push(reason);
      }
    }
  }

  return {
    algorithmVersion: ALGORITHM_VERSION,
    notes,
    candidates: selected.map((s) => ({
      recipeId: s.recipe.id,
      name: s.recipe.name,
      score: s.score,
      breakdown: s.items,
      notes: selectedNotes.get(s.recipe.id) ?? [],
    })),
  };
}
