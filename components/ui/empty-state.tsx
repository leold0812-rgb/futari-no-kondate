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
      <div className={styles.art} aria-hidden="true">
        <svg viewBox="0 0 120 100" fill="none">
          <ellipse cx="60" cy="81" rx="36" ry="6" fill="#53634B" opacity=".12" />
          <circle cx="60" cy="51" r="35" fill="#FFFDF8" />
          <circle cx="60" cy="51" r="28" fill="#E9C36E" />
          <circle cx="60" cy="51" r="22" fill="#F7E6B2" />
          <path d="M43 52c7-13 13 13 20-1s12 8 16-1" stroke="#FFF9E8" strokeWidth="4" strokeLinecap="round" />
          <path d="M48 39c-4-7 0-12 6-13 6 5 5 10 0 15m12-6c0-7 5-10 10-8 2 6-1 11-8 12" fill="#718765" />
          <circle cx="49" cy="59" r="3.5" fill="#C8664F" /><circle cx="69" cy="61" r="3.5" fill="#C8664F" />
          <path d="M28 29l2-5m-8 15 5 1m64 22 5-1m-6-39 2-5" stroke="#C8664F" strokeWidth="2.5" strokeLinecap="round" />
        </svg>
      </div>
      <h2 id="empty-state-title" className={styles.title}>
        {title}
      </h2>
      <p className={styles.description}>{description}</p>
      {children ? <div className={styles.actions}>{children}</div> : null}
    </section>
  );
}
