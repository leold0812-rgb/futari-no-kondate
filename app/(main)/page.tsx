import { EmptyState } from "@/components/ui/empty-state";
import { PageHeader } from "@/components/ui/page-header";
import styles from "./home.module.css";

// ホーム（献立未決定）の空状態。週間計画フローはGate 5で実装する
export default function HomePage() {
  return (
    <>
      <PageHeader title="ホーム" />
      <EmptyState
        title="今週の献立はまだ決まっていません"
        description="保存したレシピから5つの主菜を選ぶと、買い物リストまでまとめて用意できます。"
      >
        <button type="button" className={styles.primaryAction} disabled aria-describedby="plan-note">
          今週の献立を決める
        </button>
        <p id="plan-note" className={styles.note}>
          献立づくりは準備中です。
        </p>
      </EmptyState>
    </>
  );
}
