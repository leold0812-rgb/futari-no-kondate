import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { RecipeForm, type RecipeFormValues } from "@/components/recipes/recipe-form";
import { LinkButton } from "@/components/ui/button";
import { PageHeader } from "@/components/ui/page-header";
import { requireMember } from "@/lib/auth/session";
import { getRecipeDetail } from "@/lib/services/recipes";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { updateRecipeAction } from "../../actions";

export const metadata: Metadata = { title: "レシピを編集 | ふたりの献立" };

export default async function EditRecipePage({ params }: PageProps<"/recipes/[id]/edit">) {
  const member = await requireMember();
  const { id } = await params;
  const recipe = await getRecipeDetail(await createSupabaseServerClient(), member.userId, id).catch(() => null);
  if (!recipe) notFound();

  const initial: RecipeFormValues = {
    name: recipe.name,
    dishType: recipe.dishType,
    mainCategory: recipe.mainCategory,
    cuisine: recipe.cuisine,
    servings: recipe.servings,
    cookingMinutes: recipe.cookingMinutes,
    sourceUrl: recipe.sourceUrl,
    ingredients: recipe.ingredients.map((i) => ({
      rawName: i.rawName,
      quantity: i.quantity,
      unit: i.unit,
      note: i.note,
      isMain: i.isMain,
    })),
    instructions: recipe.instructions,
    highCost: recipe.highCost,
    specialSeasoning: recipe.specialSeasoning,
    oneDish: recipe.oneDish,
    tags: recipe.tags,
    memo: recipe.memo,
    nutrition: {
      energyKcal: recipe.nutrition.energyKcal,
      proteinG: recipe.nutrition.proteinG,
      fatG: recipe.nutrition.fatG,
      carbsG: recipe.nutrition.carbsG,
    },
    imageUrl: recipe.imageUrl,
  };

  return (
    <>
      <PageHeader
        title="レシピを編集"
        back={
          <LinkButton href={`/recipes/${recipe.id}`} variant="ghost" size="small">
            ‹ {recipe.name}
          </LinkButton>
        }
      />
      <RecipeForm initial={initial} action={updateRecipeAction.bind(null, recipe.id)} submitLabel="変更を保存する" />
    </>
  );
}
