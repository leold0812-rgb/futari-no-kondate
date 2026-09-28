"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import styles from "./bottom-nav.module.css";
import { NavIcon } from "./nav-icon";
import { isActivePath, NAV_ITEMS } from "./nav-items";

export function BottomNav() {
  const pathname = usePathname();

  return (
    <nav className={styles.nav} aria-label="メインメニュー">
      <ul className={styles.list}>
        {NAV_ITEMS.map((item) => {
          const active = isActivePath(pathname, item.href);
          return (
            <li key={item.href} className={styles.item}>
              <Link
                href={item.href}
                className={styles.link}
                aria-current={active ? "page" : undefined}
              >
                <span className={styles.icon}><NavIcon name={item.icon} /></span>
                <span className={styles.label}>{item.label}</span>
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
