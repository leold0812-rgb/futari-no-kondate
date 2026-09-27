import type { Metadata } from "next";
import { LinkButton, Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { PageHeader } from "@/components/ui/page-header";
import { CategoryOrderEditor } from "@/components/shopping/category-order-editor";
import { requireMember } from "@/lib/auth/session";
import { INGREDIENT_CATEGORIES, type IngredientCategory } from "@/lib/ingredients";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { setCategoryOrderAction } from "../shopping/actions";
import { logoutAction } from "./actions";
import styles from "./settings.module.css";

export const metadata: Metadata = { title: "設定 | ふたりの献立" };

export default async function SettingsPage() {
  const member = await requireMember();
  const { data: orders } = await (await createSupabaseServerClient())
    .from("shopping_category_orders")
    .select("category, position")
    .order("position");
  const saved = (orders ?? []).map((o) => o.category as IngredientCategory);
  const categoryOrder = [...saved, ...INGREDIENT_CATEGORIES.filter((c) => !saved.includes(c))];
  return (
    <>
      <PageHeader
        title="設定"
        back={
          <LinkButton href="/records" variant="ghost" size="small">
            ‹ 記録へ戻る
          </LinkButton>
        }
      />
      <div className={styles.stack}>
        <Card aria-labelledby="account-heading">
          <h2 id="account-heading" className={styles.heading}>
            アカウント
          </h2>
          <p>
            <span className={styles.muted}>ログイン中：</span>
            {member.displayName}
          </p>
          <form action={logoutAction}>
            <Button type="submit" variant="secondary" block>
              この端末でログアウト
            </Button>
          </form>
        </Card>
        <Card aria-labelledby="order-heading">
          <h2 id="order-heading" className={styles.heading}>
            買い物リストの並び順
          </h2>
          <p className={styles.muted}>いつものお店の売り場の順に並べると、買い物が早く終わります。</p>
          <CategoryOrderEditor initial={categoryOrder} action={setCategoryOrderAction} />
        </Card>
      </div>
    </>
  );
}
