import type { Metadata } from "next";
import styles from "@/components/plan/plan.module.css";
import { RecipeImage } from "@/components/recipes/recipe-image";
import { Alert } from "@/components/ui/alert";
import { buttonClassName, LinkButton } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { PageHeader } from "@/components/ui/page-header";
import { requireMember } from "@/lib/auth/session";
import { resolvePlanWeek } from "@/lib/plan-week";
import { listRecipes } from "@/lib/services/recipes";
import { ensureWeeklyPlan, getWeeklyPlan } from "@/lib/services/weekly-plan";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { addManualAction } from "../actions";

export const metadata: Metadata = { title: "レシピから追加 | ふたりの献立" };

/** 候補に出なかった主菜を手動で追加する（「もう作らない」の料理も、手動なら追加できる：docs/recommendation.md） */
export default async function AddCandidatePage({ searchParams }: PageProps<"/plan/add">) {
  const member = await requireMember();
  const week = resolvePlanWeek((await searchParams).week);
  const supabase = await createSupabaseServerClient();
  const plan = await getWeeklyPlan(supabase, await ensureWeeklyPlan(supabase, week));
  const chosen = new Set((plan?.candidates ?? []).filter((c) => c.decision === "ACCEPTED").map((c) => c.recipeId));
  const recipes = (await listRecipes(supabase, member.userId, { dishType: "MAIN", sort: "rating" })).filter(
    (r) => r.status === "READY" && !chosen.has(r.id),
  );

  return (
    <>
      <PageHeader
        title="レシピから追加"
        description="材料と作り方がそろった主菜から選べます。"
        back={
          <LinkButton href={`/plan/confirm?week=${week}`} variant="ghost" size="small">
            ‹ 主菜の確認へ
          </LinkButton>
        }
      />
      {!plan?.runId || plan.status !== "DRAFT" ? (
        <Alert tone="info">
          <p>先に候補を表示してください。</p>
          <LinkButton href={`/plan?week=${week}`} size="small">
            献立を決める画面へ
          </LinkButton>
        </Alert>
      ) : recipes.length === 0 ? (
        <EmptyState title="追加できる主菜がありません" description="材料と作り方がそろった主菜のレシピを登録すると、ここに並びます。" />
      ) : (
        <ul className={styles.list}>
          {recipes.map((r) => (
            <li key={r.id} className={styles.row}>
              <RecipeImage url={r.imageUrl} name={r.name} className={styles.thumb} />
              <div>
                <p className={styles.rowName}>{r.name}</p>
                <p className={styles.rowMeta}>
                  {r.cookingMinutes ? `約${r.cookingMinutes}分` : ""}
                  {r.myRating === "NEVER_AGAIN" || r.partnerRating === "NEVER_AGAIN" ? "・「もう作らない」の評価あり" : ""}
                </p>
              </div>
              <form action={addManualAction.bind(null, plan.runId!, r.id, week)}>
                <button type="submit" className={buttonClassName({ variant: "secondary", size: "small" })} aria-label={`${r.name}を追加`}>
                  追加
                </button>
              </form>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}
