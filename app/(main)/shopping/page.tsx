import type { Metadata } from "next";
import { EmptyState } from "@/components/ui/empty-state";
import { PageHeader } from "@/components/ui/page-header";

export const metadata: Metadata = { title: "買い物 | ふたりの献立" };

export default function ShoppingPage() {
  return (
    <>
      <PageHeader title="買い物" />
      <EmptyState title="買い物リストはまだありません" description="献立を決めると、必要な食材がここにまとまる予定です。" />
    </>
  );
}
