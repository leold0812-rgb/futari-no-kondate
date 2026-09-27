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

  const meals: HomeMeal[] = current && current.status !== "DRAFT" ? await getHomeMeals(supabase, current.id) : [];

  // 買い物リストの準備が途中なら、ホームからも続きへ進めるようにする
  let shoppingDraftWeek: string | null = null;
  for (const [plan, w] of [
    [current, week],
    [next, nextWeek],
  ] as const) {
    if (!plan || plan.status === "DRAFT") continue;
    const { data: list } = await supabase.from("shopping_lists").select("status").eq("weekly_plan_id", plan.id).maybeSingle();
    if (!list || list.status === "DRAFT") {
      shoppingDraftWeek = w;
      break;
    }
  }

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
