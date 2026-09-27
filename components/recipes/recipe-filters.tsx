import Link from "next/link";
import { buttonClassName } from "@/components/ui/button";
import { controlClassName } from "@/components/ui/field";
import {
  CUISINE_LABELS,
  CUISINES,
  DISH_TYPE_LABELS,
  DISH_TYPES,
  KNOWN_TAGS,
  MAIN_CATEGORIES,
  MAIN_CATEGORY_LABELS,
  RECIPE_SORT_LABELS,
  RECIPE_SORTS,
} from "@/lib/recipes/constants";
import type { RecipeFilters as Filters } from "@/lib/services/recipes";
import styles from "./recipe-filters.module.css";

/**
 * 検索・絞り込み・並べ替え。URLのクエリで状態を持つ（JSなしでも動き、戻る操作で条件が戻る）。
 */
export function RecipeFilters({ filters, resultCount }: { filters: Filters; resultCount: number }) {
  const activeCount = [filters.dishType, filters.mainCategory, filters.cuisine, filters.tag, filters.favoriteOnly].filter(Boolean).length;
  return (
    <form method="get" action="/recipes" className={styles.form} role="search">
      <div className={styles.searchRow}>
        <label htmlFor="recipe-q" className={styles.srOnly}>
          料理名・材料名で検索
        </label>
        <input
          id="recipe-q"
          name="q"
          type="search"
          defaultValue={filters.q ?? ""}
          placeholder="料理名・材料名で検索"
          className={controlClassName}
          enterKeyHint="search"
        />
        <button type="submit" className={buttonClassName({ variant: "primary", size: "small" })}>
          検索
        </button>
      </div>
      <details className={styles.details} open={activeCount > 0}>
        <summary>
          絞り込み・並べ替え{activeCount > 0 ? `（${activeCount}件の条件）` : ""}
        </summary>
        <div className={styles.grid}>
          <label className={styles.field}>
            <span>種類</span>
            <select name="type" defaultValue={filters.dishType ?? ""} className={controlClassName}>
              <option value="">すべて</option>
              {DISH_TYPES.map((t) => (
                <option key={t} value={t}>
                  {DISH_TYPE_LABELS[t]}
                </option>
              ))}
            </select>
          </label>
          <label className={styles.field}>
            <span>大分類</span>
            <select name="cat" defaultValue={filters.mainCategory ?? ""} className={controlClassName}>
              <option value="">すべて</option>
              {MAIN_CATEGORIES.map((c) => (
                <option key={c} value={c}>
                  {MAIN_CATEGORY_LABELS[c]}
                </option>
              ))}
            </select>
          </label>
          <label className={styles.field}>
            <span>ジャンル</span>
            <select name="cuisine" defaultValue={filters.cuisine ?? ""} className={controlClassName}>
              <option value="">すべて</option>
              {CUISINES.map((c) => (
                <option key={c} value={c}>
                  {CUISINE_LABELS[c]}
                </option>
              ))}
            </select>
          </label>
          <label className={styles.field}>
            <span>タグ</span>
            <select name="tag" defaultValue={filters.tag ?? ""} className={controlClassName}>
              <option value="">すべて</option>
              {KNOWN_TAGS.map((t) => (
                <option key={t} value={t}>
                  {t}
                </option>
              ))}
            </select>
          </label>
          <label className={styles.field}>
            <span>並べ替え</span>
            <select name="sort" defaultValue={filters.sort ?? "new"} className={controlClassName}>
              {RECIPE_SORTS.map((s) => (
                <option key={s} value={s}>
                  {RECIPE_SORT_LABELS[s]}
                </option>
              ))}
            </select>
          </label>
          <label className={styles.checkbox}>
            <input type="checkbox" name="fav" value="1" defaultChecked={filters.favoriteOnly} />
            自分のお気に入りだけ
          </label>
        </div>
        <div className={styles.actions}>
          <button type="submit" className={buttonClassName({ variant: "primary" })}>
            この条件で表示
          </button>
          <Link href="/recipes" className={buttonClassName({ variant: "ghost" })}>
            条件をクリア
          </Link>
        </div>
      </details>
      <p className={styles.count} aria-live="polite">
        {resultCount}件
      </p>
    </form>
  );
}
