import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { CompleteButton } from "@/components/meals/complete-button";
import styles from "@/components/meals/meals.module.css";
import { RecipeImage } from "@/components/recipes/recipe-image";
import { Alert } from "@/components/ui/alert";
import { buttonClassName, LinkButton } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { PageHeader } from "@/components/ui/page-header";
import { requireMember } from "@/lib/auth/session";
import { getMealSetDetail, listAlternatives } from "@/lib/services/meals";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { setRatingAction } from "../../recipes/actions";
import { completeMealSetAction, swapDishAction } from "../actions";

export const metadata: Metadata = { title: "今日の献立 | ふたりの献立" };

const KIND_LABEL = { MAIN: "主菜", SIDE: "副菜", SOUP: "汁物" } as const;

export default async function MealSetPage({ params, searchParams }: PageProps<"/meals/[id]">) {
  const member = await requireMember();
  const { id } = await params;
  const query = await searchParams;
  const supabase = await createSupabaseServerClient();
  const detail = await getMealSetDetail(supabase, member, id).catch(() => null);
  if (!detail) notFound();
  const planned = detail.status === "PLANNED";
  const [sideAlternatives, soupAlternatives] = planned
    ? await Promise.all([listAlternatives(supabase, detail, "SIDE"), listAlternatives(supabase, detail, "SOUP")])
    : [[], []];
  const main = detail.dishes.find((d) => d.kind === "MAIN");

  return (
    <div className={styles.page}>
      <PageHeader
        title={main?.name ?? "献立"}
        description={`${detail.servings}人分の献立セット`}
        back={
          <LinkButton href="/" variant="ghost" size="small">
            ‹ ホーム
          </LinkButton>
        }
      />
      {query.notice === "swapped" ? <Alert tone="success">差し替えました。</Alert> : null}
      {query.error === "conflict" ? <Alert tone="error">相手が先に献立を変更しました。最新の内容を表示しています。</Alert> : null}
      {query.error === "swap" ? <Alert tone="error">差し替えできませんでした。もう一度お試しください。</Alert> : null}
      {!planned ? <Alert tone="success">この献立は作った記録がついています。</Alert> : null}

      {detail.dishes.map((dish) => {
        const alternatives = dish.kind === "SIDE" ? sideAlternatives : dish.kind === "SOUP" ? soupAlternatives : [];
        return (
          <Card key={dish.kind} aria-label={`${KIND_LABEL[dish.kind]}：${dish.name}`}>
            <div className={styles.dish}>
              <RecipeImage url={dish.imageUrl} name={dish.name} className={styles.dishImage} />
              <div>
                <span className={styles.kind}>{KIND_LABEL[dish.kind]}</span>
                <p className={styles.dishName}>
                  <Link href={`/recipes/${dish.recipeId}`}>{dish.name}</Link>
                </p>
                <p className={styles.muted}>
                  {dish.cookingMinutes ? `約${dish.cookingMinutes}分・` : ""}
                  {dish.nutrition.energyKcal !== null ? `1人前 ${dish.nutrition.energyKcal}kcal` : "栄養は未登録"}
                </p>
                <ul className={styles.ingredients}>
                  {dish.ingredients.map((i, index) => (
                    <li key={`${i.name}-${index}`}>
                      {i.name} {i.amount}
                    </li>
                  ))}
                </ul>
              </div>
            </div>
            <LinkButton href={`/recipes/${dish.recipeId}/cook`} variant="secondary" size="small">
              調理モード
            </LinkButton>
            {planned && dish.kind !== "MAIN" ? (
              <details className={styles.swap}>
                <summary>{KIND_LABEL[dish.kind]}を差し替える</summary>
                <ul className={styles.alternatives}>
                  {alternatives.map((alt) => (
                    <li key={alt.dish.id} className={styles.alternative}>
                      <span>
                        {alt.dish.name}
                        {alt.reasons.length > 0 ? <span className={styles.muted}>（{alt.reasons.join("・")}）</span> : null}
                      </span>
                      <form action={swapDishAction.bind(null, detail.id, dish.kind as "SIDE" | "SOUP", alt.dish.id, detail.version)}>
                        <button type="submit" className={buttonClassName({ variant: "secondary", size: "small" })} aria-label={`${alt.dish.name}に差し替える`}>
                          これにする
                        </button>
                      </form>
                    </li>
                  ))}
                  <li className={styles.alternative}>
                    <span>{KIND_LABEL[dish.kind]}なしにする</span>
                    <form action={swapDishAction.bind(null, detail.id, dish.kind as "SIDE" | "SOUP", null, detail.version)}>
                      <button type="submit" className={buttonClassName({ variant: "ghost", size: "small" })}>
                        なしにする
                      </button>
                    </form>
                  </li>
                </ul>
              </details>
            ) : null}
          </Card>
        );
      })}

      {planned && !detail.dishes.some((d) => d.kind === "SIDE") ? (
        <form action={swapDishAction.bind(null, detail.id, "SIDE", sideAlternatives[0]?.dish.id ?? null, detail.version)}>
          {sideAlternatives[0] ? (
            <button type="submit" className={buttonClassName({ variant: "ghost", size: "small" })}>
              副菜を足す（{sideAlternatives[0].dish.name}）
            </button>
          ) : null}
        </form>
      ) : null}

      <Card aria-labelledby="nutrition-heading">
        <h2 id="nutrition-heading">ご飯と栄養（1人分）</h2>
        <div className={styles.people}>
          {detail.people.map((p) => (
            <div key={p.userId} className={styles.person}>
              <p className={styles.personName}>{p.isMe ? `${p.name}（自分）` : p.name}</p>
              <p className={styles.muted}>ご飯 {p.nutrition.riceGrams}g</p>
              <p className={styles.big}>{p.nutrition.energyKcal}kcal</p>
              <p className={styles.muted}>
                P {p.nutrition.proteinG}g・F {p.nutrition.fatG}g・C {p.nutrition.carbsG}g
              </p>
              {!p.nutrition.complete ? <p className={styles.muted}>未登録：{p.nutrition.missing.join("、")}（合計に含めていません）</p> : null}
            </div>
          ))}
        </div>
        <Link href="/settings" className={styles.muted}>
          ご飯の量を変える
        </Link>
      </Card>

      {planned ? (
        <CompleteButton targetId={detail.id} label="作った" action={completeMealSetAction} setRatingAction={setRatingAction} />
      ) : null}
    </div>
  );
}
