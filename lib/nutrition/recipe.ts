/**
 * 食品成分表からレシピの1人前の栄養を計算する（Gate 2b）。副作用のない純粋関数。
 *
 * 材料ごとに「食品成分表の食品（100g当たりの値）」と、必要なら重さへの換算（1個当たりg・1ml当たりg）を登録しておく。
 * 重さが分からない材料・食品が未対応の材料があれば complete=false とし、推測で補わない。
 * 「少々」「適量」など数量の無い行は計算に入れない（量が分からないため。一覧で示す）。
 */
import { normalizeUnit, toBaseQuantity, unitKind } from "@/lib/units";
import type { Nutrition } from "./meal";

export type FoodValues = { energyKcal: number; proteinG: number; fatG: number; carbsG: number };

export type NutritionLine = {
  name: string;
  quantity: number | null;
  unit: string | null;
  /** 対応付けた食品の100g当たりの値（未対応はnull） */
  food: FoodValues | null;
  /** 個数の単位1つ当たりの重さ（g） */
  gramsPerUnit: number | null;
  /** 1ml当たりの重さ（g）。水・醤油などの液体 */
  gramsPerMl: number | null;
};

export type RecipeNutritionResult = {
  perServing: Nutrition;
  complete: boolean;
  /** 食品成分表に未対応の材料 */
  unmapped: string[];
  /** 重さに換算できなかった材料 */
  unconvertible: string[];
  /** 数量が無く計算に入れなかった材料 */
  uncounted: string[];
};

/** 材料1行の重さ（g）。換算できなければnull */
export function gramsOf(line: Pick<NutritionLine, "quantity" | "unit" | "gramsPerUnit" | "gramsPerMl">): number | null {
  if (line.quantity === null) return null;
  const kind = unitKind(line.unit);
  if (kind === "mass") return toBaseQuantity(line.quantity, line.unit);
  if (kind === "volume") {
    const ml = toBaseQuantity(line.quantity, line.unit);
    return ml !== null && line.gramsPerMl !== null ? ml * line.gramsPerMl : null;
  }
  if (kind === "count" || (!normalizeUnit(line.unit) && !line.unit)) {
    return line.gramsPerUnit !== null ? line.quantity * line.gramsPerUnit : null;
  }
  return null;
}

const round1 = (n: number) => Math.round(n * 10) / 10;

export function calculateRecipeNutrition(lines: NutritionLine[], servings: number): RecipeNutritionResult {
  const total = { energyKcal: 0, proteinG: 0, fatG: 0, carbsG: 0 };
  const unmapped: string[] = [];
  const unconvertible: string[] = [];
  const uncounted: string[] = [];
  for (const line of lines) {
    if (line.quantity === null) {
      uncounted.push(line.name);
      continue;
    }
    if (!line.food) {
      unmapped.push(line.name);
      continue;
    }
    const grams = gramsOf(line);
    if (grams === null) {
      unconvertible.push(line.name);
      continue;
    }
    const factor = grams / 100;
    total.energyKcal += line.food.energyKcal * factor;
    total.proteinG += line.food.proteinG * factor;
    total.fatG += line.food.fatG * factor;
    total.carbsG += line.food.carbsG * factor;
  }
  const per = Math.max(1, servings);
  const complete = unmapped.length === 0 && unconvertible.length === 0 && lines.some((l) => l.quantity !== null);
  return {
    perServing: {
      energyKcal: Math.round(total.energyKcal / per),
      proteinG: round1(total.proteinG / per),
      fatG: round1(total.fatG / per),
      carbsG: round1(total.carbsG / per),
    },
    complete,
    unmapped,
    unconvertible,
    uncounted,
  };
}
