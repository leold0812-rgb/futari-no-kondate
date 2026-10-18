import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { MealHistoryRow } from "@/lib/records/summary";

/** 記録画面（Gate 8）。利用者のsession（RLS）で呼ぶ */

type Loaded<T> = { ok: true; data: T } | { ok: false };

export async function getMealHistories(supabase: SupabaseClient, since: string): Promise<Loaded<MealHistoryRow[]>> {
  const { data, error } = await supabase
    .from("meal_histories")
    .select("id, eaten_on, dishes, nutrition_per_person, created_at")
    .gte("eaten_on", since)
    .order("eaten_on", { ascending: false })
    .order("created_at", { ascending: false })
    .limit(200);
  if (error) return { ok: false };
  return {
    ok: true,
    data: (data ?? []).map((r) => ({
      id: r.id as string,
      eatenOn: r.eaten_on as string,
      dishes: ((r.dishes as { name?: unknown; dish_type?: unknown }[] | null) ?? []).map((d) => ({
        name: String(d.name ?? ""),
        dishType: typeof d.dish_type === "string" ? d.dish_type : null,
      })),
      nutrition: Object.fromEntries(
        Object.entries((r.nutrition_per_person as Record<string, { energyKcal?: unknown; complete?: unknown }> | null) ?? {}).map(
          ([userId, n]) => [userId, { energyKcal: Number(n?.energyKcal ?? 0), complete: n?.complete === true }],
        ),
      ),
    })),
  };
}
