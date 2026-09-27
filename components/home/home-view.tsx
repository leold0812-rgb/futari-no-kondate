import Link from "next/link";
import { RecipeImage } from "@/components/recipes/recipe-image";
import { Alert } from "@/components/ui/alert";
import { LinkButton } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { PageHeader } from "@/components/ui/page-header";
import styles from "./home.module.css";

export type HomeMeal = {
  id: string;
  mainRecipeId: string;
  name: string;
  sideName?: string | null;
  soupName?: string | null;
  imageUrl: string | null;
  cooked: boolean;
  useSoon?: boolean;
};

type Props = {
  weekRange: string;
  status: "NONE" | "DRAFT" | "CONFIRMED" | "COMPLETED";
  meals: HomeMeal[];
  nextWeek: string;
  nextWeekStatus: "NONE" | "DRAFT" | "CONFIRMED" | "COMPLETED";
  justConfirmed?: boolean;
  /** 買い物リストの準備が途中の週 */
  shoppingDraftWeek?: string | null;
};

/** ホーム：今週の献立が未決定なら「今週の献立を決める」を最優先の1アクションにする（UIガイドライン） */
export function HomeView({ weekRange, status, meals, nextWeek, nextWeekStatus, justConfirmed, shoppingDraftWeek }: Props) {
  const decided = status === "CONFIRMED" || status === "COMPLETED";
  return (
    <>
      <PageHeader title="ホーム" description={`今週：${weekRange}`} />
      {justConfirmed ? <Alert tone="success">献立を決めました。</Alert> : null}
      {shoppingDraftWeek ? (
        <Alert tone="info">
          <p>買い物リストの準備が途中です。</p>
          <LinkButton href={`/plan/shopping?week=${shoppingDraftWeek}`} size="small">
            準備を続ける
          </LinkButton>
        </Alert>
      ) : null}
      {!decided ? (
        <EmptyState
          title="今週の献立はまだ決まっていません"
          description="保存したレシピから5つの主菜を選ぶと、買い物リストまでまとめて用意できます。"
        >
          <LinkButton href="/plan" size="large" block>
            {status === "DRAFT" ? "今週の献立の続きを決める" : "今週の献立を決める"}
          </LinkButton>
        </EmptyState>
      ) : (
        <section aria-labelledby="week-meals" className={styles.section}>
          <h2 id="week-meals" className={styles.sectionTitle}>
            今週の献立（{meals.filter((m) => !m.cooked).length}つ残り）
          </h2>
          <ul className={styles.meals}>
            {meals.map((meal) => (
              <li key={meal.id} className={styles.meal} data-cooked={meal.cooked}>
                <Link href={`/meals/${meal.id}`} className={styles.mealLink}>
                  <RecipeImage url={meal.imageUrl} name={meal.name} className={styles.mealImage} />
                  <span className={styles.mealName}>{meal.name}</span>
                  {meal.sideName || meal.soupName ? (
                    <span className={styles.mealSub}>{[meal.sideName, meal.soupName].filter(Boolean).join("・")}</span>
                  ) : null}
                  {meal.cooked ? <span className={styles.cooked}>✓ 作った</span> : meal.useSoon ? <span className={styles.useSoon}>⚠ そろそろ使いたい食材</span> : null}
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}
      {decided ? (
        <LinkButton href="/free-day" variant="ghost" block>
          献立の無い日（余裕日）のごはんを探す
        </LinkButton>
      ) : null}
      {decided ? (
        <LinkButton href={`/plan?week=${nextWeek}`} variant="secondary" block>
          {nextWeekStatus === "CONFIRMED" || nextWeekStatus === "COMPLETED" ? "来週の献立を見る" : "来週の献立を決める"}
        </LinkButton>
      ) : null}
    </>
  );
}
