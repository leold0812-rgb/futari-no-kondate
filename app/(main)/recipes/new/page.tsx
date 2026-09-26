import type { Metadata } from "next";
import { NewRecipeFlow } from "@/components/recipes/new-recipe-flow";
import { LinkButton } from "@/components/ui/button";
import { PageHeader } from "@/components/ui/page-header";
import { requireMember } from "@/lib/auth/session";
import { createRecipeAction, updateRecipeAction } from "../actions";
import { importRecipeAction, saveUrlOnlyAction } from "../import-actions";

export const metadata: Metadata = { title: "レシピを追加 | ふたりの献立" };

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * レシピ追加。?url= で取り込むURLを入れた状態で開く。
 * ?replace=<id> は「URLだけ保存」したレシピの再取り込み（保存すると新規ではなくそのレシピを更新する）。
 */
export default async function NewRecipePage({ searchParams }: PageProps<"/recipes/new">) {
  await requireMember();
  const params = await searchParams;
  const initialUrl = typeof params.url === "string" ? params.url.slice(0, 2048) : "";
  const replaceId = typeof params.replace === "string" && UUID_PATTERN.test(params.replace) ? params.replace : null;

  return (
    <>
      <PageHeader
        title={replaceId ? "もう一度取り込む" : "レシピを追加"}
        back={
          <LinkButton href={replaceId ? `/recipes/${replaceId}` : "/recipes"} variant="ghost" size="small">
            ‹ {replaceId ? "レシピに戻る" : "レシピ一覧"}
          </LinkButton>
        }
      />
      <NewRecipeFlow
        initialUrl={initialUrl}
        importAction={importRecipeAction}
        saveUrlOnlyAction={saveUrlOnlyAction}
        saveAction={replaceId ? updateRecipeAction.bind(null, replaceId) : createRecipeAction}
        submitLabel={replaceId ? "取り込んだ内容で保存する" : "保存する"}
        allowUrlOnly={!replaceId}
      />
    </>
  );
}
