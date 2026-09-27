import type { Metadata } from "next";
import { LinkButton, Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { PageHeader } from "@/components/ui/page-header";
import { requireMember } from "@/lib/auth/session";
import { logoutAction } from "./actions";
import styles from "./settings.module.css";

export const metadata: Metadata = { title: "設定 | ふたりの献立" };

export default async function SettingsPage() {
  const member = await requireMember();
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
      </div>
    </>
  );
}
