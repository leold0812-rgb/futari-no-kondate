import type { ReactNode } from "react";
import styles from "./field.module.css";

export const controlClassName = styles.control;

type FieldProps = {
  /** 入力要素のid。labelのhtmlForとhint/errorのidに使う */
  id: string;
  label: ReactNode;
  hint?: ReactNode;
  error?: string;
  /** (describedBy) => 入力要素。aria-describedby / aria-invalid を付けるために受け取る */
  children: (a11y: { "aria-describedby"?: string; "aria-invalid"?: true }) => ReactNode;
};

/** 常時表示のlabel・補足・エラーを持つ入力欄（UIガイドライン：入力には常時表示labelを付ける） */
export function Field({ id, label, hint, error, children }: FieldProps) {
  const hintId = hint ? `${id}-hint` : undefined;
  const errorId = error ? `${id}-error` : undefined;
  const describedBy = [hintId, errorId].filter(Boolean).join(" ") || undefined;
  return (
    <div className={styles.field}>
      <label htmlFor={id} className={styles.label}>
        {label}
      </label>
      {hint ? (
        <p id={hintId} className={styles.hint}>
          {hint}
        </p>
      ) : null}
      {children({ "aria-describedby": describedBy, ...(error ? { "aria-invalid": true as const } : {}) })}
      {error ? (
        <p id={errorId} className={styles.error}>
          {error}
        </p>
      ) : null}
    </div>
  );
}
