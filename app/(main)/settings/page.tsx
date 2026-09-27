import type { Metadata } from "next";
import { LinkButton, Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { PageHeader } from "@/components/ui/page-header";
import { RiceForm } from "@/components/meals/rice-form";
import { CategoryOrderEditor } from "@/components/shopping/category-order-editor";
import { getRicePortions } from "@/lib/services/meals";
import { getPartner } from "@/lib/services/members";
import { setRiceAction } from "../meals/actions";
import { requireMember } from "@/lib/auth/session";
import { INGREDIENT_CATEGORIES, type IngredientCategory } from "@/lib/ingredients";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { setCategoryOrderAction } from "../shopping/actions";
import { logoutAction } from "./actions";
import styles from "./settings.module.css";

export const metadata: Metadata = { title: "設定 | ふたりの献立" };

export default async function SettingsPage() {
  const member = await requireMember();
  const supabase = await createSupabaseServerClient();
  const [portions, partner] = await Promise.all([getRicePortions(supabase), getPartner(supabase, member)]);
  const { data: orders } = await supabase
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
        <Card aria-labelledby="rice-heading">
          <h2 id="rice-heading" className={styles.heading}>
            ご飯の量
          </h2>
          <p className={styles.muted}>献立画面の栄養の計算に使います。相手の画面でも表示されます。</p>
          <RiceForm action={setRiceAction} initialGrams={portions.get(member.userId) ?? null} />
          {partner ? (
            <p className={styles.muted}>
              {partner.displayName}さん：{portions.has(partner.userId) ? `${portions.get(partner.userId)}g` : "未設定"}
            </p>
          ) : null}
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
