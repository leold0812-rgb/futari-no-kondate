import type { Metadata } from "next";
import { RealtimeRefresh } from "@/components/realtime/realtime-refresh";
import { AddItemForm } from "@/components/shopping/add-item-form";
import { ShoppingList } from "@/components/shopping/shopping-list";
import { Alert } from "@/components/ui/alert";
import { LinkButton } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { PageHeader } from "@/components/ui/page-header";
import { requireMember } from "@/lib/auth/session";
import { addDays, tokyoWeekStart } from "@/lib/dates";
import { getShoppingListForPlan, type ShoppingListView } from "@/lib/services/shopping";
import { findWeeklyPlan } from "@/lib/services/weekly-plan";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { addManualItemAction, setPurchasedAction } from "./actions";

export const metadata: Metadata = { title: "買い物 | ふたりの献立" };

export default async function ShoppingPage({ searchParams }: PageProps<"/shopping">) {
  const member = await requireMember();
  const params = await searchParams;
  const supabase = await createSupabaseServerClient();
  const week = tokyoWeekStart();
  const weeks = [week, addDays(week, 7)];
  const lists: { week: string; label: string; list: ShoppingListView }[] = [];
  let draftWeek: string | null = null;
  for (const [index, w] of weeks.entries()) {
    const plan = await findWeeklyPlan(supabase, w);
    if (!plan || plan.status === "DRAFT") continue;
    const list = await getShoppingListForPlan(supabase, plan.id);
    if (!list) continue;
    if (list.status === "DRAFT") draftWeek ??= w;
    else lists.push({ week: w, label: index === 0 ? "今週" : "来週", list });
  }

  return (
    <>
      <PageHeader title="買い物" />
      <RealtimeRefresh tables={["shopping_items", "shopping_lists"]} coupleSpaceId={member.coupleSpaceId} />
      {params.error === "remove" ? <Alert tone="error">項目を外せませんでした。もう一度お試しください。</Alert> : null}
      {params.notice === "confirmed" ? <Alert tone="success">買い物リストを確定しました。買った物を押すと在庫に入ります。</Alert> : null}
      {draftWeek ? (
        <Alert tone="info">
          <p>買い物リストの準備が途中です。</p>
          <LinkButton href={`/plan/shopping?week=${draftWeek}`} size="small">
            準備を続ける
          </LinkButton>
        </Alert>
      ) : null}
      {lists.length === 0 ? (
        !draftWeek ? (
          <EmptyState title="買い物リストはまだありません" description="週の献立を決めると、必要な材料をまとめたリストができます。">
            <LinkButton href="/plan" block>
              今週の献立を決める
            </LinkButton>
          </EmptyState>
        ) : null
      ) : (
        lists.map(({ week: w, label, list }) => (
          <section key={w} aria-label={`${label}の買い物`}>
            {lists.length > 1 ? <h2>{label}の買い物</h2> : null}
            <ShoppingList items={list.items} categoryOrder={list.categoryOrder} setPurchasedAction={setPurchasedAction} />
            <details>
              <summary>ほかに買う物を追加する</summary>
              <AddItemForm action={addManualItemAction.bind(null, list.id)} />
            </details>
          </section>
        ))
      )}
    </>
  );
}
