"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import type { RecipeFormState } from "@/components/recipes/recipe-form";
import { requireMember } from "@/lib/auth/session";
import { fetchRemoteImage } from "@/lib/import/remote-image";
import { RATINGS, type Rating } from "@/lib/recipes/constants";
import { removeRecipeImage, uploadRecipeImage, validateImageFile, verifyImageContent } from "@/lib/services/recipe-images";
import { refreshCalculatedNutrition } from "@/lib/services/nutrition";
import { saveRecipe, setFavorite, setRating, softDeleteRecipe } from "@/lib/services/recipes";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { describeIssues, recipeInputSchema, type RecipeInput } from "@/lib/validation/recipe";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

async function parseForm(
  formData: FormData,
): Promise<{ input: RecipeInput; image: File | null; removeImage: boolean; importImageUrl: string | null } | { errors: string[] }> {
  let raw: unknown;
  try {
    raw = JSON.parse(String(formData.get("payload") ?? ""));
  } catch {
    return { errors: ["入力内容を読み取れませんでした。画面を再読み込みしてもう一度お試しください。"] };
  }
  const parsed = recipeInputSchema.safeParse(raw);
  if (!parsed.success) return { errors: describeIssues(parsed.error) };

  const imageEntry = formData.get("image");
  const image = imageEntry instanceof File && imageEntry.size > 0 ? imageEntry : null;
  if (image) {
    const problem = validateImageFile(image) ?? (await verifyImageContent(image));
    if (problem) return { errors: [problem] };
  }
  const importImageUrl = formData.get("importImageUrl");
  return {
    input: parsed.data,
    image,
    removeImage: formData.get("removeImage") === "1",
    importImageUrl: typeof importImageUrl === "string" && importImageUrl ? importImageUrl.slice(0, 2048) : null,
  };
}

export async function createRecipeAction(_previous: RecipeFormState, formData: FormData): Promise<RecipeFormState> {
  const member = await requireMember();
  const parsed = await parseForm(formData);
  if ("errors" in parsed) return { errors: parsed.errors };

  const supabase = await createSupabaseServerClient();
  let recipeId: string;
  try {
    recipeId = await saveRecipe(supabase, null, parsed.input);
  } catch {
    return { errors: ["レシピを保存できませんでした。通信状態を確認して、もう一度お試しください。"] };
  }

  let notice = "saved";
  // 自分で選んだ写真を優先し、無ければ（確認済みの場合だけ）取り込み元ページの写真を使う
  const photo = parsed.image ?? (parsed.importImageUrl ? await fetchRemoteImage(parsed.importImageUrl) : null);
  if (!photo && parsed.importImageUrl) notice = "image-failed";
  if (photo) {
    try {
      const path = await uploadRecipeImage(supabase, member.coupleSpaceId, recipeId, photo);
      const { error } = await supabase.from("recipes").update({ image_path: path }).eq("id", recipeId);
      if (error) {
        await removeRecipeImage(supabase, path);
        notice = "image-failed";
      }
    } catch {
      notice = "image-failed";
    }
  }
  await refreshCalculatedNutrition(supabase, recipeId).catch(() => undefined);
  revalidatePath("/recipes");
  redirect(`/recipes/${recipeId}?notice=${notice}`);
}

export async function updateRecipeAction(
  recipeId: string,
  _previous: RecipeFormState,
  formData: FormData,
): Promise<RecipeFormState> {
  const member = await requireMember();
  if (!UUID_PATTERN.test(recipeId)) return { errors: ["対象のレシピが見つかりません。"] };
  const parsed = await parseForm(formData);
  if ("errors" in parsed) return { errors: parsed.errors };

  const supabase = await createSupabaseServerClient();
  const { data: current } = await supabase
    .from("recipes")
    .select("image_path")
    .eq("id", recipeId)
    .is("deleted_at", null)
    .maybeSingle();
  if (!current) return { errors: ["対象のレシピが見つかりません（削除された可能性があります）。"] };
  const oldPath = current.image_path as string | null;

  let newPath: string | null | undefined;
  let notice = "saved";
  const photo = parsed.image ?? (parsed.importImageUrl ? await fetchRemoteImage(parsed.importImageUrl) : null);
  if (!photo && parsed.importImageUrl) notice = "image-failed";
  if (photo) {
    try {
      newPath = await uploadRecipeImage(supabase, member.coupleSpaceId, recipeId, photo);
    } catch {
      notice = "image-failed";
    }
  } else if (parsed.removeImage) {
    newPath = null;
  }

  try {
    await saveRecipe(supabase, recipeId, parsed.input, newPath === undefined ? {} : { imagePath: newPath });
  } catch {
    if (newPath) await removeRecipeImage(supabase, newPath);
    return { errors: ["レシピを保存できませんでした。通信状態を確認して、もう一度お試しください。"] };
  }
  if (newPath !== undefined && oldPath && oldPath !== newPath) await removeRecipeImage(supabase, oldPath);
  await refreshCalculatedNutrition(supabase, recipeId).catch(() => undefined);

  revalidatePath("/recipes");
  revalidatePath(`/recipes/${recipeId}`);
  redirect(`/recipes/${recipeId}?notice=${notice}`);
}

export async function deleteRecipeAction(recipeId: string): Promise<void> {
  await requireMember();
  if (!UUID_PATTERN.test(recipeId)) redirect("/recipes");
  const supabase = await createSupabaseServerClient();
  await softDeleteRecipe(supabase, recipeId);
  revalidatePath("/recipes");
  redirect("/recipes?notice=deleted");
}

export async function setRatingAction(recipeId: string, rating: Rating | null): Promise<{ error?: string }> {
  const member = await requireMember();
  if (!UUID_PATTERN.test(recipeId) || (rating !== null && !RATINGS.includes(rating))) {
    return { error: "評価を保存できませんでした。" };
  }
  try {
    await setRating(await createSupabaseServerClient(), member.userId, recipeId, rating);
  } catch {
    return { error: "評価を保存できませんでした。もう一度お試しください。" };
  }
  revalidatePath(`/recipes/${recipeId}`);
  return {};
}

export async function setFavoriteAction(recipeId: string, favorite: boolean): Promise<{ error?: string }> {
  const member = await requireMember();
  if (!UUID_PATTERN.test(recipeId)) return { error: "お気に入りを保存できませんでした。" };
  try {
    await setFavorite(await createSupabaseServerClient(), member.userId, recipeId, Boolean(favorite));
  } catch {
    return { error: "お気に入りを保存できませんでした。もう一度お試しください。" };
  }
  revalidatePath(`/recipes/${recipeId}`);
  return {};
}
