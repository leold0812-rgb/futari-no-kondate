import type { Metadata } from "next";
import { EmptyState } from "@/components/ui/empty-state";
import { PageHeader } from "@/components/ui/page-header";

export const metadata: Metadata = { title: "在庫 | ふたりの献立" };

export default function InventoryPage() {
  return (
    <>
      <PageHeader title="在庫" />
      <EmptyState title="在庫はまだありません" description="買ったものや家にある食材の管理はこれから使えるようになります。" />
    </>
  );
}
