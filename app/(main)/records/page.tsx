import type { Metadata } from "next";
import { LinkButton } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { PageHeader } from "@/components/ui/page-header";

export const metadata: Metadata = { title: "記録 | ふたりの献立" };

export default function RecordsPage() {
  return (
    <>
      <PageHeader
        title="記録"
        action={
          <LinkButton href="/settings" variant="secondary" size="small">
            設定
          </LinkButton>
        }
      />
      <EmptyState title="記録はまだありません" description="食事の履歴や体重の記録はこれから使えるようになります。" />
    </>
  );
}
