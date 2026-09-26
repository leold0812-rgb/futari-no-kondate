import { BottomNav } from "@/components/navigation/bottom-nav";
import styles from "./main-layout.module.css";

// 下部タブを持つ画面群。将来の (auth)/login にはタブを出さない
export default function MainLayout({ children }: LayoutProps<"/">) {
  return (
    <>
      <main className={styles.main}>{children}</main>
      <BottomNav />
    </>
  );
}
