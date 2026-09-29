import { HomeView, type HomeMeal } from "@/components/home/home-view";
import { requireMember } from "@/lib/auth/session";
import { addDays, formatJapaneseDate, tokyoWeekStart } from "@/lib/dates";
import { getHomeMeals } from "@/lib/services/meals";
import { findWeeklyPlan } from "@/lib/services/weekly-plan";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export default async function HomePage({ searchParams }: PageProps<"/">) {
  await requireMember();
  const params = await searchParams;
  const supabase = await createSupabaseServerClient();
  const week = tokyoWeekStart();
  const nextWeek = addDays(week, 7);
  const [current, next] = await Promise.all([findWeeklyPlan(supabase, week), findWeeklyPlan(supabase, nextWeek)]);

  const plans = [
    [current, week],
    [next, nextWeek],
  ] as const;
  const shoppingDraftPromise = (async (): Promise<string | null> => {
    const planIds = plans.flatMap(([plan]) => (plan && plan.status !== "DRAFT" ? [plan.id] : []));
    if (planIds.length === 0) return null;
    const { data: lists } = await supabase.from("shopping_lists").select("weekly_plan_id, status").in("weekly_plan_id", planIds);
    // 買い物リストの準備が途中なら、今週を優先してホームから再開できるようにする
    return plans.find(([plan]) =>
      plan && plan.status !== "DRAFT" && !lists?.some((list) => list.weekly_plan_id === plan.id && list.status !== "DRAFT"),
    )?.[1] ?? null;
  })();
  const [meals, shoppingDraftWeek]: [HomeMeal[], string | null] = await Promise.all([
    current && current.status !== "DRAFT" ? getHomeMeals(supabase, current.id) : [],
    shoppingDraftPromise,
  ]);

  return (
    <HomeView
      weekRange={`${formatJapaneseDate(week)}〜${formatJapaneseDate(addDays(week, 6))}`}
      status={current?.status ?? "NONE"}
      meals={meals}
      nextWeek={nextWeek}
      nextWeekStatus={next?.status ?? "NONE"}
      justConfirmed={params.notice === "plan-confirmed"}
      shoppingDraftWeek={shoppingDraftWeek}
    />
  );
}
