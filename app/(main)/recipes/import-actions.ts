"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireMember } from "@/lib/auth/session";
import { startOfTokyoDay } from "@/lib/dates";
import { DAILY_AI_IMPORT_LIMIT, importRecipeFromUrl, type ImportResult } from "@/lib/import/import-recipe";
import { checkImportUrl } from "@/lib/import/url-safety";
import { saveRecipe } from "@/lib/services/recipes";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export type ImportActionResult = ImportResult | { ok: false; method: "NONE"; reason: string; title: null; sourceUrl: string; host: null };

export async function importRecipeAction(url: string): Promise<ImportActionResult> {
  await requireMember();
  const input = String(url ?? "").trim().slice(0, 2048);
  const checked = checkImportUrl(input);
  if (!checked.ok) return { ok: false, method: "NONE", reason: checked.reason, title: null, sourceUrl: input, host: null };

  const supabase = await createSupabaseServerClient();
  const { count } = await supabase
    .from("recipe_import_logs")
    .select("id", { count: "exact", head: true })
    .eq("method", "AI")
    .gte("created_at", startOfTokyoDay().toISOString());
  const aiAllowed = (count ?? 0) < DAILY_AI_IMPORT_LIMIT;

  // OPENAI_API_KEY は必要になった時だけ読む（未設定でもJSON-LDのページは取り込める）
  const apiKey = process.env.OPENAI_API_KEY?.trim() || null;
  const result = await importRecipeFromUrl(checked.url.toString(), {
    aiAllowed,
    apiKey,
    model: process.env.OPENAI_IMPORT_MODEL?.trim() || undefined,
  });

  if (result.host) {
    await supabase.from("recipe_import_logs").insert({
      source_host: result.host.slice(0, 255),
      method: result.method,
      outcome: result.ok ? "SUCCESS" : "FAILED",
    });
  }
  return result;
}

/** 取り込めなかったURLを「URLのみ」のレシピとして保存する（あとで材料と作り方を入力・再取り込みできる） */
export async function saveUrlOnlyAction(url: string, title: string | null): Promise<{ error: string }> {
  await requireMember();
  const checked = checkImportUrl(String(url ?? "").trim().slice(0, 2048));
  if (!checked.ok) return { error: checked.reason };
  const name = (title?.trim() || checked.url.hostname).slice(0, 80);

  let recipeId: string;
  try {
    recipeId = await saveRecipe(
      await createSupabaseServerClient(),
      null,
      {
        name,
        dishType: "MAIN",
        mainCategory: null,
        cuisine: null,
        servings: 2,
        cookingMinutes: null,
        sourceUrl: checked.url.toString(),
        instructions: [],
        ingredients: [],
        highCost: false,
        specialSeasoning: false,
        oneDish: false,
        tags: [],
        memo: null,
        nutrition: { energyKcal: null, proteinG: null, fatG: null, carbsG: null },
      },
      { status: "URL_ONLY" },
    );
  } catch {
    return { error: "保存できませんでした。通信状態を確認して、もう一度お試しください。" };
  }
  revalidatePath("/recipes");
  redirect(`/recipes/${recipeId}?notice=saved`);
}
