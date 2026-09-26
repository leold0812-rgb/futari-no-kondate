import type { Metadata } from "next";
import { EMPTY_RECIPE, RecipeForm } from "@/components/recipes/recipe-form";
import { LinkButton } from "@/components/ui/button";
import { PageHeader } from "@/components/ui/page-header";
import { requireMember } from "@/lib/auth/session";
import { createRecipeAction } from "../actions";

export const metadata: Metadata = { title: "レシピを追加 | ふたりの献立" };

export default async function NewRecipePage() {
  await requireMember();
  return (
    <>
      <PageHeader
        title="レシピを追加"
        back={
          <LinkButton href="/recipes" variant="ghost" size="small">
            ‹ レシピ一覧
          </LinkButton>
        }
      />
      <RecipeForm initial={EMPTY_RECIPE} action={createRecipeAction} submitLabel="保存する" />
    </>
  );
}
