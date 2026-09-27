"use client";

import { Button, LinkButton } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";

/**
 * 画面の表示中に予期しないエラーが起きたとき（UIガイドライン：回復方法を示す）。
 * エラーの詳細（メッセージ・データ）は画面に出さない。
 */
export default function MainError({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <EmptyState title="表示できませんでした" description="通信状態を確かめて、もう一度お試しください。続く場合はアプリを開き直してください。">
      <Button variant="primary" onClick={() => reset()}>
        もう一度読み込む
      </Button>
      <LinkButton href="/" variant="secondary">
        ホームへ
      </LinkButton>
    </EmptyState>
  );
}
