import type { NavIconName } from "./nav-items";

// 外部アイコンライブラリを使わず、最小のインラインSVGで表現する
const PATHS: Record<NavIconName, string> = {
  home: "M4 11.5 12 5l8 6.5V20a1 1 0 0 1-1 1h-4.5v-5.5h-5V21H5a1 1 0 0 1-1-1z",
  recipes: "M6 3.5h10.5A1.5 1.5 0 0 1 18 5v15.5H7.5A1.5 1.5 0 0 1 6 19zM9 8h6M9 11.5h6M6 17.5h12",
  inventory: "M4 7.5 12 4l8 3.5v9L12 20l-8-3.5zM4 7.5 12 11l8-3.5M12 11v9",
  shopping: "M5 8h14l-1.2 11a1.5 1.5 0 0 1-1.5 1.3H7.7a1.5 1.5 0 0 1-1.5-1.3zM9 8V6.5a3 3 0 0 1 6 0V8",
  records: "M4.5 19.5h15M7 16v-4M12 16V7M17 16v-6",
};

export function NavIcon({ name }: { name: NavIconName }) {
  return (
    <svg
      aria-hidden="true"
      focusable="false"
      width="24"
      height="24"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.75"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d={PATHS[name]} />
    </svg>
  );
}
