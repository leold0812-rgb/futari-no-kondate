import styles from "./recipe-image.module.css";

/**
 * 料理画像。private bucketの一時URL（期限付き）を直接表示するため next/image は使わない
 * （URLが毎回変わり最適化キャッシュが効かず、2人専用で配信量も小さい）。画像が無ければ落ち着いたプレースホルダー。
 */
export function RecipeImage({ url, name, className }: { url: string | null; name: string; className?: string }) {
  if (!url) {
    const tone = (name.codePointAt(0) ?? 0) % 4;
    return (
      <div className={`${styles.placeholder} ${className ?? ""}`} data-tone={tone} aria-hidden="true">
        <svg viewBox="0 0 180 130" role="presentation">
          <ellipse cx="90" cy="111" rx="46" ry="8" className={styles.shadow} />
          <circle cx="90" cy="65" r="48" className={styles.plate} />
          <circle cx="90" cy="65" r="37" className={styles.food} />
          <path d="M62 67c9-20 16 18 26-1s16 12 28-2" className={styles.noodle} />
          <path d="M72 49c-8-11-4-20 5-23 11 7 11 17 2 25m20-4c1-12 10-16 19-11 2 11-4 17-16 17" className={styles.leaf} />
          <circle cx="74" cy="78" r="6" className={styles.tomato} />
          <circle cx="108" cy="81" r="5.5" className={styles.tomato} />
          <path d="M73 77l2-5m31 8 2-5" className={styles.stem} />
          <path d="M31 51l3-7m-8 20 6 1m113-26 2-7m10 16 7-2" className={styles.sparkle} />
        </svg>
      </div>
    );
  }
  return (
    // eslint-disable-next-line @next/next/no-img-element -- 期限付きの署名URLを直接表示する（上記コメント参照）
    <img src={url} alt={`${name}の写真`} className={`${styles.image} ${className ?? ""}`} loading="lazy" decoding="async" />
  );
}
