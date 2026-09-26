import type { ReactNode } from "react";
import styles from "./alert.module.css";

type AlertProps = {
  tone?: "error" | "info" | "success";
  title?: string;
  children: ReactNode;
};

/**
 * 画面内の通知。エラーは role="alert"（読み上げを割り込ませる）、それ以外は role="status"。
 * 色だけで区別しないよう、先頭に種類の文字も付ける。
 */
export function Alert({ tone = "info", title, children }: AlertProps) {
  const label = tone === "error" ? "エラー" : tone === "success" ? "完了" : "お知らせ";
  return (
    <div className={`${styles.alert} ${styles[tone]}`} role={tone === "error" ? "alert" : "status"}>
      <p className={styles.title}>
        <span className={styles.label}>{label}</span>
        {title ? <span>{title}</span> : null}
      </p>
      <div className={styles.body}>{children}</div>
    </div>
  );
}
