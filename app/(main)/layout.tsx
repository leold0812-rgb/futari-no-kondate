import { BottomNav } from "@/components/navigation/bottom-nav";
import { requireMember } from "@/lib/auth/session";
import styles from "./main-layout.module.css";

// 下部タブを持つ画面群（ログイン必須）。proxy.tsでも未ログインを弾くが、ここでも確認する（多層防御）
export default async function MainLayout({ children }: LayoutProps<"/">) {
  await requireMember();
  return (
    <>
      <main className={styles.main}>{children}</main>
      <BottomNav />
    </>
  );
}
