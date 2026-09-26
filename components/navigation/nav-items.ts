export type NavIconName = "home" | "recipes" | "inventory" | "shopping" | "records";

export type NavItem = {
  href: string;
  label: string;
  icon: NavIconName;
};

// 下部5タブ（docs/ui-guidelines.md）。順序は仕様どおり固定する
export const NAV_ITEMS: readonly NavItem[] = [
  { href: "/", label: "ホーム", icon: "home" },
  { href: "/recipes", label: "レシピ", icon: "recipes" },
  { href: "/inventory", label: "在庫", icon: "inventory" },
  { href: "/shopping", label: "買い物", icon: "shopping" },
  { href: "/records", label: "記録", icon: "records" },
];

export function isActivePath(pathname: string, href: string): boolean {
  if (href === "/") return pathname === "/";
  return pathname === href || pathname.startsWith(`${href}/`);
}
