import type { Metadata } from "next";
import { RealtimeRefresh } from "@/components/realtime/realtime-refresh";
import styles from "@/components/shopping/shopping.module.css";
import { Alert } from "@/components/ui/alert";
import { Button, buttonClassName, LinkButton } from "@/components/ui/button";
import { PageHeader } from "@/components/ui/page-header";
import { requireMember } from "@/lib/auth/session";
import { INGREDIENT_CATEGORY_LABELS } from "@/lib/ingredients";
import { planWeekLabel, resolvePlanWeek } from "@/lib/plan-week";
import { describeAmount } from "@/lib/shopping/aggregate";
import { getShoppingListForPlan, insuranceSuggestionsFor } from "@/lib/services/shopping";
import { findWeeklyPlan, getWeeklyPlan } from "@/lib/services/weekly-plan";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { addInsuranceAction, confirmShoppingListAction, homeCheckAction, prepareShoppingAction, removeItemAction } from "../../shopping/actions";

export const metadata: Metadata = { title: "買い物の準備 | ふたりの献立" };

/**
 * 献立確定後の買い物の準備（仕様：週間計画 4〜7）。
 * 副菜・汁物の確認 → 家にあるものチェック → 保険食材（任意）→ 買い物リストを確定。
 */
export default async function ShoppingPrepPage({ searchParams }: PageProps<"/plan/shopping">) {
  const member = await requireMember();
  const params = await searchParams;
  const week = resolvePlanWeek(params.week);
  const supabase = await createSupabaseServerClient();
  const found = await findWeeklyPlan(supabase, week);
  const header = (
    <PageHeader
      title={`${planWeekLabel(week)}の買い物の準備`}
      back={
        <LinkButton href="/" variant="ghost" size="small">
          ‹ ホーム
        </LinkButton>
      }
    />
  );
  if (!found || found.status === "DRAFT") {
    return (
      <>
        {header}
        <Alert tone="info">
          <p>先に主菜を5品決めてください。</p>
          <LinkButton href={`/plan?week=${week}`} size="small">
            献立を決める
          </LinkButton>
        </Alert>
      </>
    );
  }
  let loaded: [Awaited<ReturnType<typeof getWeeklyPlan>>, Awaited<ReturnType<typeof getShoppingListForPlan>>];
  try {
    loaded = await Promise.all([getWeeklyPlan(supabase, found.id), getShoppingListForPlan(supabase, found.id)]);
  } catch {
    return (
      <>
        {header}
        <Alert tone="error" title="買い物リストを読み込めませんでした">
          <p>通信状態を確認して、画面を再読み込みしてください（献立と買い物の準備はそのまま残っています）。</p>
        </Alert>
      </>
    );
  }
  const [plan, list] = loaded;
  if (!list) {
    return (
      <>
        {header}
        {params.error === "prepare" ? (
          <Alert tone="error" title="買い物リストを作れませんでした">
            <p>献立は決まっています。下のボタンで、副菜・汁物と買い物リストの準備をもう一度行えます。</p>
          </Alert>
        ) : null}
        <form action={prepareShoppingAction.bind(null, found.id, week)}>
          <Button type="submit" size="large" block>
            副菜・汁物と買い物リストを用意する
          </Button>
        </form>
      </>
    );
  }
  if (list.status === "CONFIRMED") {
    return (
      <>
        {header}
        <Alert tone="success" title="買い物リストは確定済みです">
          <LinkButton href="/shopping" block>
            買い物リストを開く
          </LinkButton>
        </Alert>
      </>
    );
  }

  const recipeIds = (plan?.mealSets ?? []).flatMap((m) => [m.mainRecipeId, m.sideRecipeId, m.soupRecipeId]).filter((x): x is string => Boolean(x));
  const { data: recipes } = await supabase.from("recipes").select("id, name").in("id", recipeIds.length ? recipeIds : ["00000000-0000-0000-0000-000000000000"]);
  const nameOf = (id: string | null) => (id ? (recipes?.find((r) => r.id === id)?.name as string | undefined) ?? "" : null);
  const insurance = await insuranceSuggestionsFor(supabase, list);
  const { data: insuranceInfo } = await supabase
    .from("ingredients")
    .select("id, category, default_unit")
    .in("id", insurance.length ? insurance.map((i) => i.ingredientId) : ["00000000-0000-0000-0000-000000000000"]);
  const toCheck = list.items.filter((i) => i.source === "PLAN" && i.toBuy !== null && (i.toBuy > 0 || i.homeChecked));
  const uncounted = list.items.filter((i) => i.toBuy === null && i.source === "PLAN");
  const covered = list.items.filter((i) => i.source === "PLAN" && i.toBuy === 0 && !i.homeChecked);
  const extras = list.items.filter((i) => i.source !== "PLAN");

  return (
    <>
      {header}
      {params.notice === "plan-confirmed" ? <Alert tone="success">献立を決めました。副菜・汁物と買い物リストを用意しました。</Alert> : null}
      <RealtimeRefresh tables={["shopping_items", "shopping_lists", "meal_sets"]} coupleSpaceId={member.coupleSpaceId} />
      {params.error === "save" || params.error === "remove" ? <Alert tone="error">保存できませんでした。もう一度お試しください。</Alert> : null}
      {params.error === "confirm" ? (
        <Alert tone="error">買い物リストを確定できませんでした（まだ確定していません）。通信状態を確認して、もう一度「確定」を押してください。</Alert>
      ) : null}

      <section className={styles.section} aria-labelledby="meals-heading">
        <h2 id="meals-heading" className={styles.sectionTitle}>
          1. 今週の献立
        </h2>
        <ul className={styles.meals}>
          {(plan?.mealSets ?? []).map((m) => (
            <li key={m.id} className={styles.meal}>
              <p>
                <strong>{nameOf(m.mainRecipeId)}</strong>
              </p>
              <p className={styles.mealDishes}>
                副菜：{nameOf(m.sideRecipeId) ?? "なし"}　汁物：{nameOf(m.soupRecipeId) ?? "なし"}
              </p>
            </li>
          ))}
        </ul>
        <p className={styles.meta}>副菜・汁物は、平日に献立ごとに差し替えられます。</p>
      </section>

      <section className={styles.section} aria-labelledby="home-heading">
        <h2 id="home-heading" className={styles.sectionTitle}>
          2. 家にあるものチェック
        </h2>
        <p className={styles.meta}>家に十分あるものは「家にある」にすると、買う物から外れて在庫に入ります。</p>
        <ul className={styles.meals}>
          {toCheck.map((item) => (
            <li key={item.id} className={styles.prepRow} data-checked={item.homeChecked}>
              <div>
                <p>
                  <strong>{item.name}</strong> {item.homeChecked ? "（家にある）" : describeAmount(item.toBuy, item.group)}
                </p>
                <p className={styles.meta}>
                  {INGREDIENT_CATEGORY_LABELS[item.category]}・{item.recipeNames.join("、")}
                  {item.inStock ? `・在庫 ${describeAmount(item.inStock, item.group)}を差し引き済み` : ""}
                </p>
              </div>
              <form action={homeCheckAction.bind(null, item.id, !item.homeChecked, week)}>
                <button type="submit" className={buttonClassName({ variant: item.homeChecked ? "ghost" : "secondary", size: "small" })} aria-label={item.homeChecked ? `${item.name}を買う物に戻す` : `${item.name}は家にある`}>
                  {item.homeChecked ? "買う物に戻す" : "家にある"}
                </button>
              </form>
            </li>
          ))}
        </ul>
        {uncounted.length > 0 ? (
          <p className={styles.meta}>
            量の決まっていない材料（家にあるか確認）：{uncounted.map((i) => i.name).join("、")}
          </p>
        ) : null}
        {covered.length > 0 ? <p className={styles.meta}>在庫で足りる材料：{covered.map((i) => i.name).join("、")}</p> : null}
      </section>

      <section className={styles.section} aria-labelledby="insurance-heading">
        <h2 id="insurance-heading" className={styles.sectionTitle}>
          3. 保険食材（任意）
        </h2>
        <p className={styles.meta}>予定が崩れた日にも1品作れるよう、日持ちする材料を足せます。</p>
        {extras.length > 0 ? (
          <ul className={styles.meals}>
            {extras.map((item) => (
              <li key={item.id} className={styles.prepRow}>
                <p>
                  <strong>{item.name}</strong> {item.toBuy === null ? "" : describeAmount(item.toBuy, item.group)}
                </p>
                <form action={removeItemAction.bind(null, item.id, `/plan/shopping?week=${week}`)}>
                  <button type="submit" className={buttonClassName({ variant: "ghost", size: "small" })} aria-label={`${item.name}を外す`}>
                    外す
                  </button>
                </form>
              </li>
            ))}
          </ul>
        ) : null}
        {insurance.length === 0 ? (
          <p className={styles.meta}>提案できる保険食材はありません。</p>
        ) : (
          <ul className={styles.meals}>
            {insurance.map((s) => {
              const info = insuranceInfo?.find((i) => i.id === s.ingredientId);
              return (
                <li key={s.ingredientId} className={styles.prepRow}>
                  <div>
                    <p>
                      <strong>{s.name}</strong>
                    </p>
                    <p className={styles.meta}>{s.reason}</p>
                  </div>
                  <form action={addInsuranceAction.bind(null, list.id, s.ingredientId, s.name, info?.category ?? "OTHER", (info?.default_unit as string | null) ?? null, week)}>
                    <button type="submit" className={buttonClassName({ variant: "secondary", size: "small" })} aria-label={`${s.name}を保険食材として追加`}>
                      追加
                    </button>
                  </form>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      <form action={confirmShoppingListAction.bind(null, list.id, week)}>
        <Button type="submit" size="large" block>
          4. この内容で買い物リストを確定
        </Button>
      </form>
    </>
  );
}
