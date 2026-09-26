"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireMember } from "@/lib/auth/session";
import { tokyoDate } from "@/lib/dates";
import { resolvePlanWeek } from "@/lib/plan-week";
import {
  addManualCandidate,
  confirmWeeklyPlan,
  decideCandidate,
  generateCandidates,
  getWeeklyPlan,
  MAIN_DISHES_PER_WEEK,
  PlanConflictError,
  type Decision,
} from "@/lib/services/weekly-plan";
import { createSupabaseServerClient } from "@/lib/supabase/server";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DECISIONS: Decision[] = ["PENDING", "ACCEPTED", "SKIPPED"];

function planPath(week: string) {
  return `/plan?week=${week}`;
}

/** 候補がまだ無ければ10候補を出す（画面を開いた直後に呼ぶ。既にあれば何もしない） */
export async function ensureCandidatesAction(planId: string): Promise<{ error?: string }> {
  await requireMember();
  if (!UUID_PATTERN.test(planId)) return { error: "計画が見つかりません。" };
  const supabase = await createSupabaseServerClient();
  const plan = await getWeeklyPlan(supabase, planId);
  if (!plan) return { error: "計画が見つかりません。" };
  if (plan.status !== "DRAFT" || plan.runId) return {};
  try {
    await generateCandidates(supabase, planId, tokyoDate());
  } catch {
    return { error: "候補を作れませんでした。通信状態を確認して、もう一度お試しください。" };
  }
  revalidatePath("/plan");
  return {};
}

export async function regenerateCandidatesAction(planId: string, week: string): Promise<void> {
  await requireMember();
  if (!UUID_PATTERN.test(planId)) return;
  await generateCandidates(await createSupabaseServerClient(), planId, tokyoDate());
  redirect(planPath(resolvePlanWeek(week)));
}

export async function decideAction(candidateId: string, decision: Decision): Promise<{ error?: string }> {
  const member = await requireMember();
  if (!UUID_PATTERN.test(candidateId) || !DECISIONS.includes(decision)) return { error: "判断を保存できませんでした。" };
  try {
    await decideCandidate(await createSupabaseServerClient(), member.userId, candidateId, decision);
  } catch {
    return { error: "判断を保存できませんでした。通信状態を確認して、もう一度お試しください。" };
  }
  return {};
}

export async function removeAcceptedAction(candidateId: string, week: string): Promise<void> {
  const member = await requireMember();
  if (!UUID_PATTERN.test(candidateId)) return;
  await decideCandidate(await createSupabaseServerClient(), member.userId, candidateId, "SKIPPED");
  revalidatePath("/plan/confirm");
  redirect(`/plan/confirm?week=${resolvePlanWeek(week)}`);
}

export async function addManualAction(runId: string, recipeId: string, week: string): Promise<void> {
  await requireMember();
  if (!UUID_PATTERN.test(runId) || !UUID_PATTERN.test(recipeId)) return;
  await addManualCandidate(await createSupabaseServerClient(), runId, recipeId);
  redirect(`/plan/confirm?week=${resolvePlanWeek(week)}`);
}

export type ConfirmState = { error?: string };

export async function confirmPlanAction(planId: string, week: string, _previous: ConfirmState, formData: FormData): Promise<ConfirmState> {
  await requireMember();
  if (!UUID_PATTERN.test(planId)) return { error: "計画が見つかりません。" };
  const supabase = await createSupabaseServerClient();
  const plan = await getWeeklyPlan(supabase, planId);
  if (!plan) return { error: "計画が見つかりません。" };
  const expectedVersion = Number(formData.get("version"));
  const accepted = plan.candidates.filter((c) => c.decision === "ACCEPTED");
  if (plan.status === "DRAFT" && accepted.length !== MAIN_DISHES_PER_WEEK) {
    return { error: `主菜はちょうど${MAIN_DISHES_PER_WEEK}品にしてください（いま${accepted.length}品）。まだ確定していません。` };
  }
  try {
    await confirmWeeklyPlan(
      supabase,
      planId,
      expectedVersion,
      accepted.map((c) => ({ mainRecipeId: c.recipeId, sideRecipeId: null, soupRecipeId: null })),
    );
  } catch (error) {
    if (error instanceof PlanConflictError) return { error: error.message };
    return { error: "献立を確定できませんでした。通信状態を確認して、もう一度お試しください（まだ確定していません）。" };
  }
  revalidatePath("/");
  redirect(`/?notice=plan-confirmed&week=${resolvePlanWeek(week)}`);
}
