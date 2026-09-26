import type { Metadata } from "next";
import { ConfirmForm } from "@/components/plan/confirm-form";
import styles from "@/components/plan/plan.module.css";
import { RecipeImage } from "@/components/recipes/recipe-image";
import { Alert } from "@/components/ui/alert";
import { buttonClassName, LinkButton } from "@/components/ui/button";
import { PageHeader } from "@/components/ui/page-header";
import { requireMember } from "@/lib/auth/session";
import { planWeekLabel, resolvePlanWeek } from "@/lib/plan-week";
import { ensureWeeklyPlan, getWeeklyPlan, MAIN_DISHES_PER_WEEK } from "@/lib/services/weekly-plan";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { confirmPlanAction, removeAcceptedAction } from "../actions";

export const metadata: Metadata = { title: "主菜を確認 | ふたりの献立" };

export default async function ConfirmPlanPage({ searchParams }: PageProps<"/plan/confirm">) {
  await requireMember();
  const week = resolvePlanWeek((await searchParams).week);
  const supabase = await createSupabaseServerClient();
  const plan = await getWeeklyPlan(supabase, await ensureWeeklyPlan(supabase, week));
  const accepted = (plan?.candidates ?? [])
    .filter((c) => c.decision === "ACCEPTED")
    .sort((a, b) => (a.decidedAt ?? "").localeCompare(b.decidedAt ?? "") || a.position - b.position);
  const diff = MAIN_DISHES_PER_WEEK - accepted.length;

  return (
    <>
      <PageHeader
        title={`${planWeekLabel(week)}の主菜を確認`}
        back={
          <LinkButton href={`/plan?week=${week}`} variant="ghost" size="small">
            ‹ 候補に戻る
          </LinkButton>
        }
      />
      {plan?.status !== "DRAFT" ? (
        <Alert tone="success" title="この週の献立は決定済みです">
          <LinkButton href="/" block>
            ホームへ
          </LinkButton>
        </Alert>
      ) : (
        <>
          <ul className={styles.list}>
            {accepted.map((c) => (
              <li key={c.id} className={styles.row}>
                <RecipeImage url={c.imageUrl} name={c.name} className={styles.thumb} />
                <div>
                  <p className={styles.rowName}>{c.name}</p>
                  <p className={styles.rowMeta}>
                    {c.manual ? "手動で追加" : `候補${c.position}番目`}
                    {c.cookingMinutes ? `・約${c.cookingMinutes}分` : ""}
                  </p>
                </div>
                <form action={removeAcceptedAction.bind(null, c.id, week)}>
                  <button type="submit" className={buttonClassName({ variant: "ghost", size: "small" })} aria-label={`${c.name}を外す`}>
                    外す
                  </button>
                </form>
              </li>
            ))}
          </ul>
          {diff > 0 ? (
            <Alert tone="info">
              <p>あと{diff}品選んでください。</p>
              <LinkButton href={`/plan?week=${week}`} variant="secondary" size="small">
                候補から選ぶ
              </LinkButton>{" "}
              <LinkButton href={`/plan/add?week=${week}`} variant="secondary" size="small">
                レシピから追加
              </LinkButton>
            </Alert>
          ) : diff < 0 ? (
            <Alert tone="info">{-diff}品多いので、「外す」で{MAIN_DISHES_PER_WEEK}品にしてください。</Alert>
          ) : null}
          <ConfirmForm
            action={confirmPlanAction.bind(null, plan.id, week)}
            version={plan.version}
            disabled={diff !== 0}
            count={MAIN_DISHES_PER_WEEK}
          />
        </>
      )}
    </>
  );
}
