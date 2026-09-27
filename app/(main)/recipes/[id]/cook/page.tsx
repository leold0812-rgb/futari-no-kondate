import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { CookMode } from "@/components/recipes/cook-mode";
import { LinkButton } from "@/components/ui/button";
import { requireMember } from "@/lib/auth/session";
import { getRecipeDetail } from "@/lib/services/recipes";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "調理モード | ふたりの献立" };

export default async function CookPage({ params }: PageProps<"/recipes/[id]/cook">) {
  const member = await requireMember();
  const { id } = await params;
  const recipe = await getRecipeDetail(await createSupabaseServerClient(), member.userId, id).catch(() => null);
  if (!recipe) notFound();
  return (
    <>
      <LinkButton href={`/recipes/${recipe.id}`} variant="ghost" size="small">
        ‹ レシピに戻る
      </LinkButton>
      <h1 className="visually-hidden">調理モード：{recipe.name}</h1>
      <CookMode recipeId={recipe.id} name={recipe.name} steps={recipe.instructions} ingredients={recipe.ingredients} />
    </>
  );
}
