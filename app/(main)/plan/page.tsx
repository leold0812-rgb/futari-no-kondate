import type { Metadata } from "next";
import { AutoGenerate } from "@/components/plan/auto-generate";
import { PlanDeck } from "@/components/plan/plan-deck";
import { Alert } from "@/components/ui/alert";
import { Button, LinkButton } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { PageHeader } from "@/components/ui/page-header";
import { requireMember } from "@/lib/auth/session";
import { addDays, formatJapaneseDate } from "@/lib/dates";
import { planWeekLabel, resolvePlanWeek } from "@/lib/plan-week";
import { ensureWeeklyPlan, getWeeklyPlan, MAIN_DISHES_PER_WEEK } from "@/lib/services/weekly-plan";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { decideAction, ensureCandidatesAction, regenerateCandidatesAction } from "./actions";

export const metadata: Metadata = { title: "献立を決める | ふたりの献立" };

export default async function PlanPage({ searchParams }: PageProps<"/plan">) {
  await requireMember();
  const week = resolvePlanWeek((await searchParams).week);
  const supabase = await createSupabaseServerClient();
  const planId = await ensureWeeklyPlan(supabase, week);
  const plan = await getWeeklyPlan(supabase, planId);
  const title = `${planWeekLabel(week)}の献立を決める`;
  const range = `${formatJapaneseDate(week)}〜${formatJapaneseDate(addDays(week, 6))}`;

  const header = (
    <PageHeader
      title={title}
      description={`${range}。候補を1枚ずつ「作る」か「スキップ」で選び、主菜を${MAIN_DISHES_PER_WEEK}品決めます。`}
      back={
        <LinkButton href="/" variant="ghost" size="small">
          ‹ ホーム
        </LinkButton>
      }
    />
  );

  if (!plan) {
    return (
      <>
        {header}
        <Alert tone="error">計画を開けませんでした。もう一度お試しください。</Alert>
      </>
    );
  }
  if (plan.status !== "DRAFT") {
    return (
      <>
        {header}
        <Alert tone="success" title="この週の献立は決定済みです">
          <p>ホームで献立を確認できます。</p>
          <LinkButton href="/" block>
            ホームへ
          </LinkButton>
        </Alert>
      </>
    );
  }
  if (!plan.runId) {
    return (
      <>
        {header}
        <AutoGenerate planId={plan.id} action={ensureCandidatesAction} />
      </>
    );
  }
  if (plan.candidates.length === 0) {
    return (
      <>
        {header}
        <EmptyState
          title="候補にできる主菜がありません"
          description="材料と作り方がそろった主菜のレシピを登録すると、ここに候補が出ます。"
        >
          <LinkButton href="/recipes/new" block>
            レシピを追加する
          </LinkButton>
        </EmptyState>
      </>
    );
  }

  return (
    <>
      {header}
      {plan.runNotes.length > 0 ? (
        <Alert tone="info">
          {plan.runNotes.map((note) => (
            <p key={note}>{note}</p>
          ))}
        </Alert>
      ) : null}
      <PlanDeck
        key={plan.runId}
        candidates={plan.candidates}
        target={MAIN_DISHES_PER_WEEK}
        week={week}
        decideAction={decideAction}
        regenerateSlot={
          <form action={regenerateCandidatesAction.bind(null, plan.id, week)}>
            <Button type="submit" block>
              候補を出し直す
            </Button>
          </form>
        }
      />
    </>
  );
}
