import styles from "./recipe-image.module.css";

/**
 * 料理画像。private bucketの一時URL（期限付き）を直接表示するため next/image は使わない
 * （URLが毎回変わり最適化キャッシュが効かず、2人専用で配信量も小さい）。画像が無ければ落ち着いたプレースホルダー。
 */
export function RecipeImage({ url, name, className }: { url: string | null; name: string; className?: string }) {
  if (!url) {
    return (
      <div className={`${styles.placeholder} ${className ?? ""}`} aria-hidden="true">
        <svg viewBox="0 0 48 48" width="40" height="40" fill="none" stroke="currentColor" strokeWidth="2">
          <circle cx="24" cy="26" r="12" />
          <path d="M8 26h4M36 26h4M24 10v2" strokeLinecap="round" />
        </svg>
      </div>
    );
  }
  return (
    // eslint-disable-next-line @next/next/no-img-element -- 期限付きの署名URLを直接表示する（上記コメント参照）
    <img src={url} alt={`${name}の写真`} className={`${styles.image} ${className ?? ""}`} loading="lazy" decoding="async" />
  );
}
