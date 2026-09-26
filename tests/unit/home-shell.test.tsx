import { render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { HomeView } from "@/components/home/home-view";
import { BottomNav } from "@/components/navigation/bottom-nav";

vi.mock("next/navigation", () => ({
  usePathname: () => "/",
}));

describe("ホームの空状態と下部タブ", () => {
  it("今週の献立が未決定なら「今週の献立を決める」を最優先で表示する", () => {
    render(<HomeView weekRange="9月28日(月)〜10月4日(日)" status="NONE" meals={[]} nextWeek="2026-10-05" nextWeekStatus="NONE" />);

    expect(screen.getByRole("heading", { level: 1, name: "ホーム" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "今週の献立を決める" })).toHaveAttribute("href", "/plan");
    expect(screen.queryByRole("link", { name: "来週の献立を決める" })).not.toBeInTheDocument();
  });

  it("決定済みなら5つの献立と、来週の献立への導線を表示する", () => {
    const meals = Array.from({ length: 5 }, (_, i) => ({
      id: `m${i}`,
      mainRecipeId: `r${i}`,
      name: `料理${i}`,
      imageUrl: null,
      cooked: i === 0,
    }));
    render(<HomeView weekRange="x" status="CONFIRMED" meals={meals} nextWeek="2026-10-05" nextWeekStatus="NONE" />);

    expect(screen.getByRole("heading", { name: "今週の献立（4つ残り）" })).toBeInTheDocument();
    expect(screen.getAllByRole("listitem")).toHaveLength(5);
    expect(screen.getByText("✓ 作った")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "来週の献立を決める" })).toHaveAttribute("href", "/plan?week=2026-10-05");
  });

  it("5タブを仕様どおりの順で表示し、現在地を示す", () => {
    render(<BottomNav />);

    const nav = screen.getByRole("navigation", { name: "メインメニュー" });
    const links = within(nav).getAllByRole("link");
    expect(links.map((link) => link.textContent)).toEqual([
      "ホーム",
      "レシピ",
      "在庫",
      "買い物",
      "記録",
    ]);
    expect(within(nav).getByRole("link", { name: "ホーム" })).toHaveAttribute("aria-current", "page");
    expect(within(nav).getByRole("link", { name: "レシピ" })).not.toHaveAttribute("aria-current");
  });
});
