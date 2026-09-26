import { render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import HomePage from "@/app/(main)/page";
import { BottomNav } from "@/components/navigation/bottom-nav";

vi.mock("next/navigation", () => ({
  usePathname: () => "/",
}));

describe("ホームの空状態と下部タブ", () => {
  it("今週の献立を決めるアクションを表示する", () => {
    render(<HomePage />);

    expect(screen.getByRole("heading", { level: 1, name: "ホーム" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "今週の献立を決める" })).toBeInTheDocument();
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
