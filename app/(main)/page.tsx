import { HomeView, type HomeMeal } from "@/components/home/home-view";
import { requireMember } from "@/lib/auth/session";
import { addDays, formatJapaneseDate, tokyoWeekStart } from "@/lib/dates";
import { signImagePaths } from "@/lib/services/recipes";
import { findWeeklyPlan, getWeeklyPlan } from "@/lib/services/weekly-plan";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export default async function HomePage({ searchParams }: PageProps<"/">) {
  await requireMember();
  const params = await searchParams;
  const supabase = await createSupabaseServerClient();
  const week = tokyoWeekStart();
  const nextWeek = addDays(week, 7);
  const [current, next] = await Promise.all([findWeeklyPlan(supabase, week), findWeeklyPlan(supabase, nextWeek)]);

  let meals: HomeMeal[] = [];
  if (current && current.status !== "DRAFT") {
    const plan = await getWeeklyPlan(supabase, current.id);
    const ids = (plan?.mealSets ?? []).map((m) => m.mainRecipeId);
    const { data: recipes } = await supabase.from("recipes").select("id, name, image_path").in("id", ids.length ? ids : ["00000000-0000-0000-0000-000000000000"]);
    const images = await signImagePaths(supabase, (recipes ?? []).map((r) => r.image_path as string | null));
    meals = (plan?.mealSets ?? []).map((m) => {
      const recipe = recipes?.find((r) => r.id === m.mainRecipeId);
      return {
        id: m.id,
        mainRecipeId: m.mainRecipeId,
        name: (recipe?.name as string | undefined) ?? "（削除されたレシピ）",
        imageUrl: recipe?.image_path ? (images.get(recipe.image_path as string) ?? null) : null,
        cooked: m.status === "COOKED",
      };
    });
  }

  return (
    <HomeView
      weekRange={`${formatJapaneseDate(week)}〜${formatJapaneseDate(addDays(week, 6))}`}
      status={current?.status ?? "NONE"}
      meals={meals}
      nextWeek={nextWeek}
      nextWeekStatus={next?.status ?? "NONE"}
      justConfirmed={params.notice === "plan-confirmed"}
    />
  );
}
