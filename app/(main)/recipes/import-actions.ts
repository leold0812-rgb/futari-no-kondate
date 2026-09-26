"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireMember } from "@/lib/auth/session";
import { importRecipeFromUrl, type ImportResult } from "@/lib/import/import-recipe";
import { checkImportUrl } from "@/lib/import/url-safety";
import { saveRecipe } from "@/lib/services/recipes";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export type ImportActionResult = ImportResult | { ok: false; method: "NONE"; reason: string; title: null; sourceUrl: string; host: null };

export async function importRecipeAction(url: string): Promise<ImportActionResult> {
  const member = await requireMember();
  const input = String(url ?? "").trim().slice(0, 2048);
  const checked = checkImportUrl(input);
  if (!checked.ok) return { ok: false, method: "NONE", reason: checked.reason, title: null, sourceUrl: input, host: null };
  const host = checked.url.hostname.slice(0, 255);

  // OPENAI_API_KEY は必要になった時だけ読む（未設定でもJSON-LDのページは取り込める）
  const apiKey = process.env.OPENAI_API_KEY?.trim() || null;
  // 上限の判定と記録はDB関数で一体に行う（同時リクエストでも上限を超えない）。
  // 関数はservice_role専用で、利用者が枠を返したり消費を偽ったりできないよう、sessionで確かめた利用者とspaceだけを渡す
  const admin = createSupabaseAdminClient();
  const { data: reservation, error } = await admin
    .rpc("begin_recipe_import", {
      p_couple_space_id: member.coupleSpaceId,
      p_user_id: member.userId,
      p_source_host: host,
      p_want_ai: Boolean(apiKey),
    })
    .single<{ import_id: string | null; allowed: boolean; ai_allowed: boolean }>();
  if (error || !reservation) {
    return { ok: false, method: "NONE", reason: "取り込みを開始できませんでした。少し待ってからもう一度お試しください。", title: null, sourceUrl: checked.url.toString(), host };
  }
  if (!reservation.allowed || !reservation.import_id) {
    return {
      ok: false,
      method: "NONE",
      reason: "短い時間に取り込みが続いたため、一時的に止めています。1時間ほど待つか、手入力で続けてください。",
      title: null,
      sourceUrl: checked.url.toString(),
      host,
    };
  }

  let result: ImportResult;
  try {
    result = await importRecipeFromUrl(checked.url.toString(), {
      aiAllowed: reservation.ai_allowed,
      apiKey,
      model: process.env.OPENAI_IMPORT_MODEL?.trim() || undefined,
    });
  } catch {
    result = { ok: false, method: "NONE", reason: "ページを読み取れませんでした。", title: null, sourceUrl: checked.url.toString(), host };
  }
  // 完了の記録は1回だけ再試行する。記録できなかった予約は10分後に自動で枠へ戻る（begin_recipe_import）
  const finish = () =>
    admin.rpc("finish_recipe_import", {
      p_import_id: reservation.import_id,
      p_method: result.method,
      p_outcome: result.ok ? "SUCCESS" : "FAILED",
    });
  const { error: finishError } = await finish();
  if (finishError) await finish();
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
