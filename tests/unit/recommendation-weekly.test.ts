import { describe, expect, it } from "vitest";
import {
  ALGORITHM_VERSION,
  baseScore,
  isEligible,
  recommendWeekly,
  type RecommendationContext,
  type RecommendationRecipe,
} from "@/lib/recommendation/weekly";

const context: RecommendationContext = { today: "2026-10-01", inStockIngredientIds: new Set(["onion", "egg"]) };

let seq = 0;
function recipe(overrides: Partial<RecommendationRecipe> = {}): RecommendationRecipe {
  seq += 1;
  return {
    id: `r${String(seq).padStart(3, "0")}`,
    name: `料理${seq}`,
    dishType: "MAIN",
    status: "READY",
    mainCategory: "MEAT",
    createdAt: `2026-09-${String((seq % 28) + 1).padStart(2, "0")}T00:00:00Z`,
    tags: [],
    highCost: false,
    specialSeasoning: false,
    ratings: [],
    favoriteCount: 0,
    lastCookedOn: "2026-08-01",
    cookCount: 1,
    mainIngredientIds: [],
    ...overrides,
  };
}

/** 大分類をばらした作り置きの候補群 */
function variedPool(count: number): RecommendationRecipe[] {
  const categories = ["MEAT", "FISH", "EGG_SOY", "NOODLE", "RICE", "VEGETABLE"] as const;
  return Array.from({ length: count }, (_, i) => recipe({ mainCategory: categories[i % categories.length] }));
}

describe("対象集合", () => {
  it("主菜・READYだけが対象で、どちらかが「もう作らない」にした料理は通常候補から外す", () => {
    expect(isEligible(recipe())).toBe(true);
    expect(isEligible(recipe({ dishType: "SIDE" }))).toBe(false);
    expect(isEligible(recipe({ status: "URL_ONLY" }))).toBe(false);
    expect(isEligible(recipe({ status: "DRAFT" }))).toBe(false);
    expect(isEligible(recipe({ ratings: ["MAKE_AGAIN", "NEVER_AGAIN"] }))).toBe(false);
  });

  it("もう作らない料理は自動候補に入らない", () => {
    const never = recipe({ ratings: ["NEVER_AGAIN"], tags: ["高タンパク"] });
    const result = recommendWeekly([never, ...variedPool(12)], context);
    expect(result.candidates.map((c) => c.recipeId)).not.toContain(never.id);
  });
});

describe("基本スコア", () => {
  it("仕様の点数で内訳を返す", () => {
    const items = baseScore(
      recipe({
        ratings: ["MAKE_AGAIN", "MAKE_AGAIN"],
        favoriteCount: 1,
        tags: ["高タンパク", "低カロリー"],
        highCost: true,
        specialSeasoning: true,
        cookCount: 0,
        lastCookedOn: null,
        mainIngredientIds: ["onion", "pork"],
      }),
      context,
    );
    expect(Object.fromEntries(items.map((i) => [i.label, i.points]))).toEqual({
      "また作りたい（2人）": 28,
      "お気に入り（1人）": 6,
      まだ作っていない: 8,
      高タンパク: 12,
      低カロリー: 10,
      "在庫で主な材料を賄える（1/2）": 5,
      材料費が高め: -8,
      ふだん無い調味料が必要: -4,
    });
  });

  it("30日以内に作った料理は経過日数に応じて減点（直近ほど大きい）", () => {
    const yesterday = baseScore(recipe({ lastCookedOn: "2026-09-30" }), context);
    const twentyDays = baseScore(recipe({ lastCookedOn: "2026-09-11" }), context);
    const old = baseScore(recipe({ lastCookedOn: "2026-08-01" }), context);
    expect(yesterday.find((i) => i.label.includes("日前"))?.points).toBe(-10);
    expect(twentyDays.find((i) => i.label.includes("日前"))?.points).toBe(-3);
    expect(old.some((i) => i.label.includes("日前"))).toBe(false);
  });
});

describe("10候補の選択", () => {
  it("同じ入力とalgorithm versionから同じ10件が同じ順で返る", () => {
    seq = 0;
    const a = recommendWeekly(variedPool(25), context);
    seq = 0;
    const b = recommendWeekly(variedPool(25), context);
    expect(a.algorithmVersion).toBe(ALGORITHM_VERSION);
    expect(a.candidates).toHaveLength(10);
    expect(a.candidates.map((c) => c.recipeId)).toEqual(b.candidates.map((c) => c.recipeId));
  });

  it("未調理は可能なら2品、候補が十分なら3品入る（スコアが低くても）", () => {
    const strong = Array.from({ length: 14 }, (_, i) =>
      recipe({ ratings: ["MAKE_AGAIN", "MAKE_AGAIN"], mainCategory: (["MEAT", "FISH", "NOODLE"] as const)[i % 3] }),
    );
    const uncooked = Array.from({ length: 4 }, () => recipe({ cookCount: 0, lastCookedOn: null, specialSeasoning: true, highCost: false, mainCategory: "RICE" }));
    const result = recommendWeekly([...strong, ...uncooked], context);
    const picked = result.candidates.filter((c) => uncooked.some((u) => u.id === c.recipeId));
    expect(picked).toHaveLength(3);
    expect(picked[0].notes).toContain("まだ作っていない料理の枠");

    const small = recommendWeekly([...strong.slice(0, 9), ...uncooked], context);
    expect(small.candidates.filter((c) => uncooked.some((u) => u.id === c.recipeId))).toHaveLength(2);
  });

  it("高コストは原則1品まで", () => {
    const pricey = Array.from({ length: 5 }, () => recipe({ highCost: true, ratings: ["MAKE_AGAIN", "MAKE_AGAIN"], mainCategory: "FISH" }));
    const result = recommendWeekly([...pricey, ...variedPool(15)], context);
    expect(result.candidates.filter((c) => pricey.some((p) => p.id === c.recipeId))).toHaveLength(1);
  });

  it("同じ大分類が過半数にならない（最大5品）", () => {
    const meat = Array.from({ length: 12 }, () => recipe({ mainCategory: "MEAT", ratings: ["MAKE_AGAIN"] }));
    const others = Array.from({ length: 6 }, (_, i) => recipe({ mainCategory: i % 2 ? "FISH" : "NOODLE" }));
    const result = recommendWeekly([...meat, ...others], context);
    expect(result.candidates.filter((c) => meat.some((m) => m.id === c.recipeId))).toHaveLength(5);
  });

  it("最近作った料理は後回しになる", () => {
    const recent = recipe({ lastCookedOn: "2026-09-30", ratings: ["MAKE_AGAIN"] });
    const same = recipe({ lastCookedOn: "2026-06-01", ratings: ["MAKE_AGAIN"] });
    const result = recommendWeekly([recent, same, ...variedPool(10)], context);
    const ids = result.candidates.map((c) => c.recipeId);
    expect(ids.indexOf(same.id)).toBeLessThan(ids.indexOf(recent.id) === -1 ? Infinity : ids.indexOf(recent.id));
  });

  it("材料を使い回せる候補に加点する", () => {
    const first = recipe({ ratings: ["MAKE_AGAIN", "MAKE_AGAIN"], mainIngredientIds: ["cabbage"], mainCategory: "MEAT" });
    const sharing = recipe({ mainIngredientIds: ["cabbage"], mainCategory: "FISH" });
    const result = recommendWeekly([first, sharing, ...variedPool(3)], context);
    const reused = result.candidates.find((c) => c.recipeId === sharing.id)!;
    expect(reused.breakdown.some((i) => i.label.startsWith("他の候補と材料を使い回せる"))).toBe(true);
  });

  it("候補不足でも重複・例外なく返し、緩和理由を残す", () => {
    const pricey = Array.from({ length: 3 }, () => recipe({ highCost: true, mainCategory: "MEAT" }));
    const result = recommendWeekly(pricey, context);
    expect(result.candidates).toHaveLength(3);
    expect(new Set(result.candidates.map((c) => c.recipeId)).size).toBe(3);
    expect(result.notes.join()).toContain("10品に足りません");
    expect(result.notes.join()).toContain("材料費が高め");
    // 緩和して選んだ理由は候補の内訳（breakdown）にも残る
    expect(result.candidates.some((c) => c.breakdown.some((b) => b.label.includes("材料費が高めの料理を2品目")))).toBe(true);
    expect(recommendWeekly([], context)).toMatchObject({ candidates: [], notes: [expect.stringContaining("0品")] });
  });
});
