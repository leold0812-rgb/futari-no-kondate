import type { Metadata } from "next";
import Link from "next/link";
import { CompleteButton } from "@/components/meals/complete-button";
import styles from "@/components/meals/meals.module.css";
import { Card } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { LinkButton } from "@/components/ui/button";
import { PageHeader } from "@/components/ui/page-header";
import { requireMember } from "@/lib/auth/session";
import { tokyoDate } from "@/lib/dates";
import { freshnessOf } from "@/lib/inventory/status";
import { recommendFreeDay, type FreeDayRecipe } from "@/lib/recommendation/free-day";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { toBaseQuantity, unitGroup } from "@/lib/units";
import { setRatingAction } from "../recipes/actions";
import { completeFreeMealAction } from "../meals/actions";

export const metadata: Metadata = { title: "余裕日のごはん | ふたりの献立" };

/** 余裕日（週5献立以外の日）：在庫で作れる料理を提案する。AIは使わない */
export default async function FreeDayPage() {
  await requireMember();
  const supabase = await createSupabaseServerClient();
  const today = tokyoDate();
  const [{ data: recipes }, { data: lines }, { data: stock }, { data: never }, { data: histories }] = await Promise.all([
    supabase.from("recipes").select("id, name, cooking_minutes, servings").eq("status", "READY").is("deleted_at", null).in("dish_type", ["MAIN", "SIDE", "SOUP"]).limit(1000),
    supabase.from("recipe_ingredients").select("recipe_id, ingredient_id, raw_name, quantity, unit").limit(20000),
    supabase.from("inventory_items").select("ingredient_id, quantity, unit, purchased_on, ingredients(storage_days)").gt("quantity", 0),
    supabase.from("recipe_ratings").select("recipe_id").eq("rating", "NEVER_AGAIN"),
    supabase.from("recipe_histories").select("recipe_id, cooked_on"),
  ]);
  const stockMap = new Map<string, Map<string, number>>();
  const useSoon = new Set<string>();
  for (const s of (stock ?? []) as unknown as { ingredient_id: string; quantity: number; unit: string | null; purchased_on: string; ingredients: { storage_days: number | null } | { storage_days: number | null }[] | null }[]) {
    const groups = stockMap.get(s.ingredient_id) ?? new Map<string, number>();
    const group = unitGroup(s.unit);
    groups.set(group, (groups.get(group) ?? 0) + (toBaseQuantity(Number(s.quantity), s.unit) ?? Number(s.quantity)));
    stockMap.set(s.ingredient_id, groups);
    const ing = Array.isArray(s.ingredients) ? s.ingredients[0] : s.ingredients;
    const status = freshnessOf(s.purchased_on, ing?.storage_days ?? null, today).status;
    if (status === "USE_SOON" || status === "PAST_ESTIMATE") useSoon.add(s.ingredient_id);
  }
  const neverIds = new Set((never ?? []).map((r) => r.recipe_id as string));
  const last = new Map<string, string>();
  for (const h of histories ?? []) if ((last.get(h.recipe_id) ?? "") < h.cooked_on) last.set(h.recipe_id, h.cooked_on);
  const input: FreeDayRecipe[] = (recipes ?? []).map((r) => ({
    id: r.id as string,
    name: r.name as string,
    cookingMinutes: r.cooking_minutes as number | null,
    servings: r.servings as number,
    neverAgain: neverIds.has(r.id as string),
    lastCookedOn: last.get(r.id as string) ?? null,
    lines: (lines ?? [])
      .filter((l) => l.recipe_id === r.id)
      .map((l) => ({ ingredientId: l.ingredient_id as string | null, name: l.raw_name as string, quantity: l.quantity === null ? null : Number(l.quantity), unit: l.unit as string | null })),
  }));
  const candidates = recommendFreeDay(input, { today, stock: stockMap, useSoonIngredientIds: useSoon, servings: 2 });

  return (
    <div className={styles.page}>
      <PageHeader
        title="余裕日のごはん"
        description="献立の無い日に、在庫・そろそろ使いたい食材で作れる料理です。"
        back={
          <LinkButton href="/" variant="ghost" size="small">
            ‹ ホーム
          </LinkButton>
        }
      />
      {candidates.length === 0 ? (
        <EmptyState title="提案できる料理がありません" description="材料のそろったレシピを登録すると、在庫から作れる料理を提案します。" />
      ) : (
        candidates.map((c) => (
          <Card key={c.recipeId} aria-label={c.name}>
            <p className={styles.dishName}>
              <Link href={`/recipes/${c.recipeId}`}>{c.name}</Link>
            </p>
            <p className={styles.muted}>{c.reasons.join("・")}</p>
            <p className={styles.muted}>{c.missing.length === 0 ? "買い足しなし" : `買い足し：${c.missing.join("、")}`}</p>
            <CompleteButton targetId={c.recipeId} label="これを作った" action={completeFreeMealAction} setRatingAction={setRatingAction} sticky={false} />
          </Card>
        ))
      )}
    </div>
  );
}
