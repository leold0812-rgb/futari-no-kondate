import type { ReactNode } from "react";
import styles from "./page-header.module.css";

type PageHeaderProps = {
  title: string;
  /** 見出しの下に出す補足 */
  description?: ReactNode;
  /** 右上の操作（設定へのリンクなど） */
  action?: ReactNode;
  /** 戻り先などを見出しの上に出す */
  back?: ReactNode;
};

export function PageHeader({ title, description, action, back }: PageHeaderProps) {
  return (
    <header className={styles.header}>
      {back ? <div className={styles.back}>{back}</div> : null}
      <div className={styles.row}>
        <h1 className={styles.title}>{title}</h1>
        {action ? <div className={styles.action}>{action}</div> : null}
      </div>
      {description ? <p className={styles.description}>{description}</p> : null}
    </header>
  );
}
