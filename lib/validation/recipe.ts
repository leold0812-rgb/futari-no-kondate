import { z } from "zod";
import { CUISINES, DISH_TYPES, MAIN_CATEGORIES } from "@/lib/recipes/constants";

/**
 * レシピ保存の入力（Server Actionでサーバー側検証する。DBの制約と同じ上限）。
 * クライアントのフォームはこの形のJSONを送る。数値は空欄をnullにしてから送る。
 */

const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max, `${max}文字以内で入力してください`)
    .nullable()
    .transform((v) => (v ? v : null));

const optionalNumber = (min: number, max: number, message: string) =>
  z.number().min(min, message).max(max, message).nullable();

export const ingredientLineSchema = z.object({
  rawName: z.string().trim().min(1, "材料名を入力してください").max(60, "材料名は60文字以内で入力してください"),
  quantity: z.number().positive("分量は0より大きい数にしてください").max(99999, "分量が大きすぎます").nullable(),
  unit: optionalText(20),
  note: optionalText(60),
  isMain: z.boolean(),
});

export type IngredientLineInput = z.infer<typeof ingredientLineSchema>;

const httpUrl = z
  .string()
  .trim()
  .max(2048, "URLが長すぎます")
  .refine((value) => {
    try {
      const url = new URL(value);
      return url.protocol === "https:" || url.protocol === "http:";
    } catch {
      return false;
    }
  }, "http(s)で始まるURLを入力してください");

export const recipeInputSchema = z.object({
  name: z.string().trim().min(1, "料理名を入力してください").max(80, "料理名は80文字以内で入力してください"),
  dishType: z.enum(DISH_TYPES),
  mainCategory: z.enum(MAIN_CATEGORIES).nullable(),
  cuisine: z.enum(CUISINES).nullable(),
  servings: z.number().int().min(1, "人数は1〜8人にしてください").max(8, "人数は1〜8人にしてください"),
  cookingMinutes: z.number().int().min(1, "調理時間は1〜600分にしてください").max(600, "調理時間は1〜600分にしてください").nullable(),
  sourceUrl: httpUrl.nullable().or(z.literal("").transform(() => null)),
  instructions: z.array(z.string().trim().min(1).max(500, "手順は1つ500文字以内にしてください")).max(50, "手順は50個までです"),
  ingredients: z.array(ingredientLineSchema).max(60, "材料は60行までです"),
  highCost: z.boolean(),
  specialSeasoning: z.boolean(),
  oneDish: z.boolean(),
  tags: z.array(z.string().trim().min(1).max(20)).max(10, "タグは10個までです"),
  memo: optionalText(2000),
  nutrition: z.object({
    energyKcal: optionalNumber(0, 5000, "エネルギーは0〜5000kcalで入力してください"),
    proteinG: optionalNumber(0, 500, "たんぱく質は0〜500gで入力してください"),
    fatG: optionalNumber(0, 500, "脂質は0〜500gで入力してください"),
    carbsG: optionalNumber(0, 1000, "炭水化物は0〜1000gで入力してください"),
  }),
});

export type RecipeInput = z.infer<typeof recipeInputSchema>;

/** 検証エラーを「項目名: 理由」の短い日本語の一覧にする */
export function describeIssues(error: z.ZodError): string[] {
  const labels: Record<string, string> = {
    name: "料理名",
    servings: "人数",
    cookingMinutes: "調理時間",
    sourceUrl: "元のURL",
    instructions: "手順",
    ingredients: "材料",
    tags: "タグ",
    memo: "メモ",
    nutrition: "栄養",
  };
  return [
    ...new Set(
      error.issues.map((issue) => {
        const head = String(issue.path[0] ?? "");
        const row = typeof issue.path[1] === "number" ? `${issue.path[1] + 1}行目の` : "";
        return `${labels[head] ?? "入力"}：${row}${issue.message}`;
      }),
    ),
  ];
}

/** 材料と手順がそろっていれば献立に使える（READY）。足りなければ下書き（DRAFT） */
export function deriveRecipeStatus(input: Pick<RecipeInput, "ingredients" | "instructions">): "READY" | "DRAFT" {
  return input.ingredients.length > 0 && input.instructions.length > 0 ? "READY" : "DRAFT";
}
