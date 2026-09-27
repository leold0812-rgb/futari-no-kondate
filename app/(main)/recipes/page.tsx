import type { Metadata } from "next";
import { RecipeCard } from "@/components/recipes/recipe-card";
import { RecipeFilters } from "@/components/recipes/recipe-filters";
import { Alert } from "@/components/ui/alert";
import { LinkButton } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { PageHeader } from "@/components/ui/page-header";
import { requireMember } from "@/lib/auth/session";
import {
  CUISINES,
  DISH_TYPES,
  MAIN_CATEGORIES,
  RECIPE_SORTS,
  type Cuisine,
  type DishType,
  type MainCategory,
  type RecipeSort,
} from "@/lib/recipes/constants";
import { listRecipes, type RecipeFilters as Filters } from "@/lib/services/recipes";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import styles from "./recipes.module.css";

export const metadata: Metadata = { title: "レシピ | ふたりの献立" };

function pick<T extends string>(value: string | string[] | undefined, allowed: readonly T[]): T | undefined {
  return typeof value === "string" && (allowed as readonly string[]).includes(value) ? (value as T) : undefined;
}

export default async function RecipesPage({ searchParams }: PageProps<"/recipes">) {
  const member = await requireMember();
  const params = await searchParams;
  const filters: Filters = {
    q: typeof params.q === "string" ? params.q.slice(0, 40) : undefined,
    dishType: pick<DishType>(params.type, DISH_TYPES),
    mainCategory: pick<MainCategory>(params.cat, MAIN_CATEGORIES),
    cuisine: pick<Cuisine>(params.cuisine, CUISINES),
    tag: typeof params.tag === "string" && params.tag ? params.tag.slice(0, 20) : undefined,
    favoriteOnly: params.fav === "1",
    sort: pick<RecipeSort>(params.sort, RECIPE_SORTS) ?? "new",
  };
  const supabase = await createSupabaseServerClient();
  const recipes = await listRecipes(supabase, member.userId, filters);
  const hasConditions = Boolean(filters.q || filters.dishType || filters.mainCategory || filters.cuisine || filters.tag || filters.favoriteOnly);

  return (
    <>
      <PageHeader
        title="レシピ"
        action={
          <LinkButton href="/recipes/new" size="small">
            ＋ 追加
          </LinkButton>
        }
      />
      {params.notice === "deleted" ? <Alert tone="success">レシピを削除しました。</Alert> : null}
      <RecipeFilters filters={filters} resultCount={recipes.length} />
      {recipes.length === 0 ? (
        hasConditions ? (
          <EmptyState title="条件に合うレシピがありません" description="検索語や絞り込みの条件を変えてみてください。" />
        ) : (
          <EmptyState
            title="レシピはまだありません"
            description="よく作る料理や作ってみたい料理を登録すると、週の献立候補に使えます。"
          >
            <LinkButton href="/recipes/new" size="large" block>
              最初のレシピを追加する
            </LinkButton>
          </EmptyState>
        )
      ) : (
        <ul className={styles.grid}>
          {recipes.map((recipe) => (
            <RecipeCard key={recipe.id} recipe={recipe} />
          ))}
        </ul>
      )}
    </>
  );
}
