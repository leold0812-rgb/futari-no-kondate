import type { Metadata } from "next";
import { notFound } from "next/navigation";
import styles from "@/components/inventory/inventory.module.css";
import { Alert } from "@/components/ui/alert";
import { buttonClassName, LinkButton } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { controlClassName } from "@/components/ui/field";
import { PageHeader } from "@/components/ui/page-header";
import { requireMember } from "@/lib/auth/session";
import { hasFoodComposition, searchFoods } from "@/lib/services/nutrition";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { setIngredientFoodAction, setIngredientWeightsAction } from "../../actions";

export const metadata: Metadata = { title: "材料の栄養 | ふたりの献立" };

const NOTICES: Record<string, { tone: "success" | "error"; text: string }> = {
  saved: { tone: "success", text: "保存しました。この材料を使うレシピの栄養を計算し直しました。" },
  weights: { tone: "error", text: "重さは0より大きい数字で入力してください（1ml当たりは10g以下）。まだ保存されていません。" },
  save: { tone: "error", text: "保存できませんでした。もう一度お試しください。" },
};

/** 材料と食品成分表の食品の対応付け、重さへの換算（Gate 2b） */
export default async function IngredientNutritionPage({ params, searchParams }: PageProps<"/inventory/ingredients/[id]">) {
  await requireMember();
  const { id } = await params;
  const query = await searchParams;
  const supabase = await createSupabaseServerClient();
  const { data: ingredient } = await supabase
    .from("ingredients")
    .select("id, name, default_unit, grams_per_unit, grams_per_ml, food_composition_items(name, food_number, source_version)")
    .eq("id", id)
    .maybeSingle();
  if (!ingredient) notFound();
  const food = (Array.isArray(ingredient.food_composition_items) ? ingredient.food_composition_items[0] : ingredient.food_composition_items) as
    | { name: string; food_number: string; source_version: string }
    | null;
  const q = typeof query.q === "string" ? query.q : (ingredient.name as string);
  const [available, results] = await Promise.all([hasFoodComposition(supabase), searchFoods(supabase, q).catch(() => [])]);
  const notice = NOTICES[String(query.error ?? query.notice ?? "")];

  return (
    <>
      <PageHeader
        title={`${ingredient.name}の栄養`}
        description="食品成分表の食品を選ぶと、この材料を使うレシピの1人前の栄養を自動で計算します。"
        back={
          <LinkButton href="/inventory/ingredients" variant="ghost" size="small">
            ‹ 材料の設定
          </LinkButton>
        }
      />
      {notice ? <Alert tone={notice.tone}>{notice.text}</Alert> : null}
      <div className={styles.list}>
        <Card aria-labelledby="current-heading">
          <h2 id="current-heading" className={styles.sectionTitle}>
            対応する食品
          </h2>
          {food ? (
            <>
              <p>
                {food.name}（食品番号 {food.food_number}）
              </p>
              <p className={styles.sectionNote}>出典：{food.source_version}</p>
              <form action={setIngredientFoodAction.bind(null, ingredient.id as string, null)}>
                <button type="submit" className={buttonClassName({ variant: "ghost", size: "small" })}>
                  対応を外す
                </button>
              </form>
            </>
          ) : (
            <p className={styles.sectionNote}>まだ選ばれていません。</p>
          )}
        </Card>

        <Card aria-labelledby="search-heading">
          <h2 id="search-heading" className={styles.sectionTitle}>
            食品を選ぶ
          </h2>
          {!available ? (
            <Alert tone="info">
              <p>食品成分表がまだ取り込まれていません。管理者が手順書（食品成分表の取り込み）に沿って取り込むと選べます。</p>
            </Alert>
          ) : (
            <>
              <form method="get" className={styles.inlineForm}>
                <label className={styles.field}>
                  <span>食品名で検索</span>
                  <input name="q" defaultValue={q} className={controlClassName} />
                </label>
                <button type="submit" className={buttonClassName({ variant: "secondary", size: "small" })}>
                  検索
                </button>
              </form>
              {results.length === 0 ? (
                <p className={styles.sectionNote}>見つかりません。別の名前（ひらがな・一般名）で探してください。</p>
              ) : (
                <ul className={styles.lots}>
                  {results.map((f) => (
                    <li key={f.id} className={styles.inlineForm}>
                      <span>
                        {f.name}
                        <span className={styles.meta}>（100g {f.energyKcal}kcal）</span>
                      </span>
                      <form action={setIngredientFoodAction.bind(null, ingredient.id as string, f.id)}>
                        <button type="submit" className={buttonClassName({ variant: "secondary", size: "small" })} aria-label={`${f.name}にする`}>
                          これにする
                        </button>
                      </form>
                    </li>
                  ))}
                </ul>
              )}
            </>
          )}
        </Card>

        <Card aria-labelledby="weights-heading">
          <h2 id="weights-heading" className={styles.sectionTitle}>
            重さへの換算
          </h2>
          <p className={styles.sectionNote}>
            レシピが「個」「本」や「大さじ」で書かれている場合に使います。分かる場合だけ入れてください（推測の値は使いません）。
          </p>
          <form action={setIngredientWeightsAction.bind(null, ingredient.id as string)} className={styles.list}>
            <label className={styles.field}>
              <span>1{(ingredient.default_unit as string | null) ?? "個"}あたりの重さ（g）</span>
              <input name="gramsPerUnit" inputMode="decimal" defaultValue={ingredient.grams_per_unit ?? ""} className={controlClassName} />
            </label>
            <label className={styles.field}>
              <span>1mlあたりの重さ（g、液体・調味料）</span>
              <input name="gramsPerMl" inputMode="decimal" defaultValue={ingredient.grams_per_ml ?? ""} className={controlClassName} />
            </label>
            <button type="submit" className={buttonClassName({ variant: "secondary" })}>
              保存
            </button>
          </form>
        </Card>
      </div>
    </>
  );
}
