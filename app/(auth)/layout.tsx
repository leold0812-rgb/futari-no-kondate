import styles from "./auth-layout.module.css";

// ログイン画面群。下部タブは出さない
export default function AuthLayout({ children }: LayoutProps<"/">) {
  return <main className={styles.main}>{children}</main>;
}
