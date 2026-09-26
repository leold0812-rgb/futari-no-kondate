import type { ReactNode } from "react";
import styles from "./empty-state.module.css";

type EmptyStateProps = {
  title: string;
  description: string;
  children?: ReactNode;
};

export function EmptyState({ title, description, children }: EmptyStateProps) {
  return (
    <section className={styles.card} aria-labelledby="empty-state-title">
      <h2 id="empty-state-title" className={styles.title}>
        {title}
      </h2>
      <p className={styles.description}>{description}</p>
      {children ? <div className={styles.actions}>{children}</div> : null}
    </section>
  );
}
