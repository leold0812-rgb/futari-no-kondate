import type { Metadata } from "next";
import { buttonClassName } from "@/components/ui/button";
import styles from "./offline.module.css";

export const metadata: Metadata = { title: "オフライン | ふたりの献立" };

// Service Workerが保存しておき、通信できないときに表示する案内（ログイン不要・利用データを含まない）
export const dynamic = "force-static";

export default function OfflinePage() {
  return (
    <main className={styles.page}>
      <h1 className={styles.title}>通信できません</h1>
      <p className={styles.text}>電波の届く場所で、もう一度開いてください。</p>
      <p className={styles.text}>献立・買い物リスト・在庫は、つながると最新の内容で表示されます。通信できない間の操作は保存されていません。</p>
      {/* 通信が戻ったかを確かめるため、クライアント遷移ではなくページ全体を読み込み直す */}
      {/* eslint-disable-next-line @next/next/no-html-link-for-pages */}
      <a href="/" className={buttonClassName({ variant: "primary", block: true })}>
        もう一度開く
      </a>
    </main>
  );
}
