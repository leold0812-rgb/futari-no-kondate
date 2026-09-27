import { daysBetween, formatJapaneseDate } from "@/lib/dates";
import type { WeightSeries } from "@/lib/records/summary";
import styles from "./records.module.css";

const WIDTH = 320;
const HEIGHT = 160;
const PAD = { top: 12, right: 12, bottom: 24, left: 40 };

/**
 * 体重の推移（本人だけに表示）。依存ライブラリを使わずSVGで描く。
 * 横軸は日付（記録の無い日は間を空ける）、縦軸は範囲内の最小〜最大に0.5kgの余白。
 */
export function WeightChart({ series, from, to }: { series: WeightSeries; from: string; to: string }) {
  if (series.points.length === 0) return null;
  const span = Math.max(1, daysBetween(from, to));
  const low = Math.floor((series.minKg - 0.5) * 2) / 2;
  const high = Math.ceil((series.maxKg + 0.5) * 2) / 2;
  const x = (date: string) => PAD.left + ((WIDTH - PAD.left - PAD.right) * daysBetween(from, date)) / span;
  const y = (kg: number) => PAD.top + ((HEIGHT - PAD.top - PAD.bottom) * (high - kg)) / (high - low);
  const path = series.points.map((p, i) => `${i === 0 ? "M" : "L"}${x(p.measuredOn).toFixed(1)},${y(p.weightKg).toFixed(1)}`).join(" ");
  const summary =
    `${formatJapaneseDate(from)}から${formatJapaneseDate(to)}までの体重の推移。記録${series.points.length}件、` +
    `最小${series.minKg}kg、最大${series.maxKg}kg、最新${series.latest?.weightKg}kg。`;
  return (
    <figure className={styles.chart}>
      <svg viewBox={`0 0 ${WIDTH} ${HEIGHT}`} role="img" aria-label={summary} className={styles.chartSvg}>
        {[high, (high + low) / 2, low].map((kg) => (
          <g key={kg}>
            <line x1={PAD.left} x2={WIDTH - PAD.right} y1={y(kg)} y2={y(kg)} className={styles.gridLine} />
            <text x={PAD.left - 6} y={y(kg) + 4} textAnchor="end" className={styles.axisLabel}>
              {kg.toFixed(1)}
            </text>
          </g>
        ))}
        <text x={PAD.left} y={HEIGHT - 6} className={styles.axisLabel}>
          {formatJapaneseDate(from)}
        </text>
        <text x={WIDTH - PAD.right} y={HEIGHT - 6} textAnchor="end" className={styles.axisLabel}>
          {formatJapaneseDate(to)}
        </text>
        {series.points.length > 1 ? <path d={path} className={styles.line} /> : null}
        {series.points.map((p) => (
          <circle key={p.measuredOn} cx={x(p.measuredOn)} cy={y(p.weightKg)} r={3} className={styles.dot} />
        ))}
      </svg>
    </figure>
  );
}
