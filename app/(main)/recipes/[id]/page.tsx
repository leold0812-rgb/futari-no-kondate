import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { PreferenceControls } from "@/components/recipes/preference-controls";
import { RecipeImage } from "@/components/recipes/recipe-image";
import { ServingsIngredients } from "@/components/recipes/servings-ingredients";
import { Alert } from "@/components/ui/alert";
import { Button, LinkButton } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { requireMember } from "@/lib/auth/session";
import {
  CUISINE_LABELS,
  DISH_TYPE_LABELS,
  MAIN_CATEGORY_LABELS,
  RECIPE_STATUS_LABELS,
} from "@/lib/recipes/constants";
import { getPartner } from "@/lib/services/members";
import { getRecipeDetail } from "@/lib/services/recipes";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { deleteRecipeAction, setFavoriteAction, setRatingAction } from "../actions";
import styles from "./recipe-detail.module.css";

export const metadata: Metadata = { title: "レシピ | ふたりの献立" };

function formatNutrition(value: number | null, unit: string) {
  return value === null ? "—" : `${value}${unit}`;
}

export default async function RecipeDetailPage({ params, searchParams }: PageProps<"/recipes/[id]">) {
  const member = await requireMember();
  const { id } = await params;
  const { notice } = await searchParams;
  const supabase = await createSupabaseServerClient();
  const [recipe, partner] = await Promise.all([
    getRecipeDetail(supabase, member.userId, id).catch(() => null),
    getPartner(supabase, member),
  ]);
  if (!recipe) notFound();

  const hasNutrition = Object.values(recipe.nutrition).some((v) => typeof v === "number");
  const flags = [recipe.highCost && "材料費が高め", recipe.specialSeasoning && "ふだん無い調味料", recipe.oneDish && "一品で完結"].filter(
    Boolean,
  ) as string[];

  return (
    <article className={styles.page}>
      <LinkButton href="/recipes" variant="ghost" size="small" className={styles.back}>
        ‹ レシピ一覧
      </LinkButton>

      {notice === "saved" ? <Alert tone="success">保存しました。</Alert> : null}
      {notice === "image-failed" ? (
        <Alert tone="error" title="写真だけ保存できませんでした">
          <p>レシピは保存されています。「編集」から写真をもう一度選んでください。</p>
        </Alert>
      ) : null}

      <RecipeImage url={recipe.imageUrl} name={recipe.name} className={styles.hero} />

      <header className={styles.header}>
        <h1 className={styles.title}>{recipe.name}</h1>
        <p className={styles.meta}>
          <span className={styles.badge}>{DISH_TYPE_LABELS[recipe.dishType]}</span>
          {recipe.mainCategory ? <span>{MAIN_CATEGORY_LABELS[recipe.mainCategory]}</span> : null}
          {recipe.cuisine ? <span>{CUISINE_LABELS[recipe.cuisine]}</span> : null}
          {recipe.cookingMinutes ? <span>約{recipe.cookingMinutes}分</span> : null}
        </p>
        {recipe.tags.length > 0 || flags.length > 0 ? (
          <ul className={styles.tags} aria-label="タグと特徴">
            {[...recipe.tags, ...flags].map((tag) => (
              <li key={tag}>{tag}</li>
            ))}
          </ul>
        ) : null}
      </header>

      {recipe.status !== "READY" ? (
        <Alert tone="info" title={RECIPE_STATUS_LABELS[recipe.status]}>
          <p>
            {recipe.status === "URL_ONLY"
              ? "URLだけ保存されています。材料と作り方を入力すると、週の献立候補に使えます。"
              : "材料と作り方がそろうと、週の献立候補に使えます。"}
          </p>
          <LinkButton href={`/recipes/${recipe.id}/edit`} variant="secondary" size="small">
            材料と作り方を入力する
          </LinkButton>
        </Alert>
      ) : null}

      <div className={styles.primaryActions}>
        <LinkButton href={`/recipes/${recipe.id}/cook`} size="large" block>
          調理モードで作る
        </LinkButton>
      </div>

      <Card aria-labelledby="pref-heading">
        <h2 id="pref-heading" className={styles.sectionTitle}>
          評価
        </h2>
        <PreferenceControls
          recipeId={recipe.id}
          myRating={recipe.myRating}
          partnerRating={recipe.partnerRating}
          partnerName={partner?.displayName ?? null}
          myFavorite={recipe.myFavorite}
          setRatingAction={setRatingAction}
          setFavoriteAction={setFavoriteAction}
        />
      </Card>

      <Card aria-labelledby="ingredients-heading">
        <h2 id="ingredients-heading" className={styles.sectionTitle}>
          材料
        </h2>
        <ServingsIngredients baseServings={recipe.servings} ingredients={recipe.ingredients} />
      </Card>

      <Card aria-labelledby="steps-heading">
        <h2 id="steps-heading" className={styles.sectionTitle}>
          作り方
        </h2>
        {recipe.instructions.length === 0 ? (
          <p className={styles.muted}>作り方はまだ登録されていません。</p>
        ) : (
          <ol className={styles.steps}>
            {recipe.instructions.map((step, index) => (
              <li key={`${index}-${step.slice(0, 10)}`}>{step}</li>
            ))}
          </ol>
        )}
      </Card>

      <Card aria-labelledby="nutrition-heading">
        <h2 id="nutrition-heading" className={styles.sectionTitle}>
          栄養（1人前）
        </h2>
        {hasNutrition ? (
          <>
            <dl className={styles.nutrition}>
              <div>
                <dt>エネルギー</dt>
                <dd>{formatNutrition(recipe.nutrition.energyKcal, "kcal")}</dd>
              </div>
              <div>
                <dt>たんぱく質</dt>
                <dd>{formatNutrition(recipe.nutrition.proteinG, "g")}</dd>
              </div>
              <div>
                <dt>脂質</dt>
                <dd>{formatNutrition(recipe.nutrition.fatG, "g")}</dd>
              </div>
              <div>
                <dt>炭水化物</dt>
                <dd>{formatNutrition(recipe.nutrition.carbsG, "g")}</dd>
              </div>
            </dl>
            <p className={styles.muted}>
              {recipe.nutrition.source === "CALCULATED" ? "食品成分表から計算した値（ご飯は含みません）" : "手入力の値（ご飯は含みません）"}
            </p>
          </>
        ) : (
          <p className={styles.muted}>栄養の値は未登録です。わかる場合は編集から入力できます。</p>
        )}
      </Card>

      {recipe.memo || recipe.sourceUrl ? (
        <Card aria-labelledby="memo-heading">
          <h2 id="memo-heading" className={styles.sectionTitle}>
            メモ・出典
          </h2>
          {recipe.memo ? <p className={styles.memo}>{recipe.memo}</p> : null}
          {recipe.sourceUrl ? (
            <p>
              <a href={recipe.sourceUrl} target="_blank" rel="noopener noreferrer nofollow" className={styles.link}>
                元のページを開く（外部サイト）
              </a>
            </p>
          ) : null}
        </Card>
      ) : null}

      <div className={styles.footerActions}>
        <LinkButton href={`/recipes/${recipe.id}/edit`} variant="secondary" block>
          編集する
        </LinkButton>
        <details className={styles.danger}>
          <summary>このレシピを削除する</summary>
          <p>一覧と献立候補から消えます（作った記録は残ります）。</p>
          <form action={deleteRecipeAction.bind(null, recipe.id)}>
            <Button type="submit" variant="danger" block>
              削除する
            </Button>
          </form>
        </details>
      </div>
    </article>
  );
}
