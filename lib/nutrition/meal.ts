/**
 * 献立セットの1人分の栄養（Gate 7）。副作用のない純粋関数。
 * 主菜・副菜・汁物の「1人前」の値と、各自のご飯量（ご飯100g当たりの栄養が分かる場合）を合計する。
 * 値の無い料理がある場合は complete=false とし、推測で補わない（画面で「一部未登録」と示す）。
 */

export type Nutrition = { energyKcal: number | null; proteinG: number | null; fatG: number | null; carbsG: number | null };

export type PersonNutrition = {
  energyKcal: number;
  proteinG: number;
  fatG: number;
  carbsG: number;
  riceGrams: number;
  /** すべての料理（とご飯）の値がそろっている */
  complete: boolean;
  /** 値が未登録の料理名 */
  missing: string[];
};

const round1 = (n: number) => Math.round(n * 10) / 10;

export function personNutrition(
  dishes: { name: string; nutrition: Nutrition }[],
  riceGrams: number,
  ricePer100g: Nutrition | null,
): PersonNutrition {
  const missing: string[] = [];
  const total = { energyKcal: 0, proteinG: 0, fatG: 0, carbsG: 0 };
  for (const dish of dishes) {
    const n = dish.nutrition;
    if (n.energyKcal === null || n.proteinG === null || n.fatG === null || n.carbsG === null) {
      missing.push(dish.name);
      continue;
    }
    total.energyKcal += n.energyKcal;
    total.proteinG += n.proteinG;
    total.fatG += n.fatG;
    total.carbsG += n.carbsG;
  }
  if (riceGrams > 0) {
    if (ricePer100g?.energyKcal != null) {
      const factor = riceGrams / 100;
      total.energyKcal += ricePer100g.energyKcal * factor;
      total.proteinG += (ricePer100g.proteinG ?? 0) * factor;
      total.fatG += (ricePer100g.fatG ?? 0) * factor;
      total.carbsG += (ricePer100g.carbsG ?? 0) * factor;
    } else {
      missing.push("ご飯");
    }
  }
  return {
    energyKcal: Math.round(total.energyKcal),
    proteinG: round1(total.proteinG),
    fatG: round1(total.fatG),
    carbsG: round1(total.carbsG),
    riceGrams,
    complete: missing.length === 0,
    missing,
  };
}
