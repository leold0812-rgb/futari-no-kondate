import type { Metadata } from "next";
import { LinkButton } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import styles from "./offline/offline.module.css";

export const metadata: Metadata = { title: "見つかりません | ふたりの献立" };

export default function NotFound() {
  return (
    <main className={styles.page}>
      <EmptyState title="ページが見つかりません" description="削除されたレシピや、古いリンクかもしれません。">
        <LinkButton href="/" variant="primary">
          ホームへ
        </LinkButton>
      </EmptyState>
    </main>
  );
}
