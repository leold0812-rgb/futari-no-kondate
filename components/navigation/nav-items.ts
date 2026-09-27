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

// 設定画面は「記録」タブの右上から開くため、記録タブを現在地として示す
const SECTION_ALIASES: Record<string, string> = { "/settings": "/records" };

export function isActivePath(pathname: string, href: string): boolean {
  const section = Object.entries(SECTION_ALIASES).find(([prefix]) => pathname === prefix || pathname.startsWith(`${prefix}/`));
  if (section) return section[1] === href;
  if (href === "/") return pathname === "/";
  return pathname === href || pathname.startsWith(`${href}/`);
}
