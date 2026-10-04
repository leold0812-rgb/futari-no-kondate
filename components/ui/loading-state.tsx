import styles from "./loading-state.module.css";

/** ページ遷移中の共通表示。読み込みの理由が分からない空白を避ける。 */
export function LoadingState({ fullPage = false }: { fullPage?: boolean }) {
  return (
    <div className={`${styles.wrap} ${fullPage ? styles.fullPage : ""}`} role="status" aria-live="polite">
      <div className={styles.lines} aria-hidden="true">
        <span className={styles.shortLine} />
        <span className={styles.longLine} />
      </div>
      <div className={styles.card} aria-hidden="true">
        <span className={styles.art} />
        <span className={styles.cardLine} />
        <span className={styles.cardLineShort} />
      </div>
      <p className={styles.message}>画面を読み込んでいます…</p>
    </div>
  );
}
