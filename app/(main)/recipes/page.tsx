import type { Metadata } from "next";
import { EmptyState } from "@/components/ui/empty-state";
import { PageHeader } from "@/components/ui/page-header";

export const metadata: Metadata = { title: "レシピ | ふたりの献立" };

export default function RecipesPage() {
  return (
    <>
      <PageHeader title="レシピ" />
      <EmptyState title="レシピはまだありません" description="レシピの保存・一覧はこれから使えるようになります。" />
    </>
  );
}
