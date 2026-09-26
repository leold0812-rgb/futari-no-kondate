import { markLotUsedUpAction, setLotQuantityAction } from "@/app/(main)/inventory/actions";
import { buttonClassName } from "@/components/ui/button";
import { controlClassName } from "@/components/ui/field";
import { formatJapaneseDate } from "@/lib/dates";
import { describeFreshness } from "@/lib/inventory/status";
import type { InventoryEntry } from "@/lib/services/inventory";
import { formatQuantity, normalizeUnit } from "@/lib/units";
import styles from "./inventory.module.css";

/** 1つの材料の在庫（lotごとに数量・購入日・鮮度と、数量の補正・使い切り） */
export function InventoryEntryCard({ entry }: { entry: InventoryEntry }) {
  return (
    <li className={styles.entry} data-freshness={entry.freshness.status}>
      <p className={styles.entryName}>{entry.ingredient.name}</p>
      <ul className={styles.lots}>
        {entry.lots.map((lot) => (
          <li key={lot.id} className={styles.lot}>
            <div className={styles.lotMain}>
              <span className={styles.amount}>{formatQuantity(lot.quantity, lot.unit)}</span>
              <span className={styles.meta}>{formatJapaneseDate(lot.purchasedOn)}購入</span>
              <span className={styles.freshness} data-status={lot.freshness.status}>
                {describeFreshness(lot.freshness)}
              </span>
            </div>
            <details className={styles.lotEdit}>
              <summary>数量を直す</summary>
              <form action={setLotQuantityAction.bind(null, lot.id)} className={styles.inlineForm}>
                <label className={styles.field}>
                  <span>残りの量（{normalizeUnit(lot.unit) ?? lot.unit ?? "単位なし"}）</span>
                  <input
                    name="quantity"
                    inputMode="decimal"
                    defaultValue={lot.quantity}
                    required
                    className={controlClassName}
                  />
                </label>
                <button type="submit" className={buttonClassName({ variant: "secondary", size: "small" })}>
                  保存
                </button>
              </form>
              <form action={markLotUsedUpAction.bind(null, lot.id)}>
                <button type="submit" className={buttonClassName({ variant: "ghost", size: "small" })}>
                  使い切った（在庫から消す）
                </button>
              </form>
            </details>
          </li>
        ))}
      </ul>
    </li>
  );
}
