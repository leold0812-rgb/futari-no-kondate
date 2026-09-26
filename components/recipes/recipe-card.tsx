import Link from "next/link";
import { DISH_TYPE_LABELS, RECIPE_STATUS_LABELS } from "@/lib/recipes/constants";
import type { RecipeSummary } from "@/lib/services/recipes";
import { RecipeImage } from "./recipe-image";
import styles from "./recipe-card.module.css";

/** レシピ一覧（2列）の1枚。画像・料理名・時間・主要タグだけを表示し、詰め込みすぎない */
export function RecipeCard({ recipe }: { recipe: RecipeSummary }) {
  const tags = recipe.tags.slice(0, 2);
  return (
    <li className={styles.item}>
      <Link href={`/recipes/${recipe.id}`} className={styles.card}>
        <RecipeImage url={recipe.imageUrl} name={recipe.name} className={styles.image} />
        <div className={styles.body}>
          <p className={styles.name}>{recipe.name}</p>
          <p className={styles.meta}>
            <span>{DISH_TYPE_LABELS[recipe.dishType]}</span>
            {recipe.cookingMinutes ? <span>{recipe.cookingMinutes}分</span> : null}
            {recipe.myFavorite ? <span aria-label="お気に入り">★</span> : null}
          </p>
          {recipe.status !== "READY" ? (
            <p className={styles.status}>{RECIPE_STATUS_LABELS[recipe.status]}</p>
          ) : tags.length > 0 ? (
            <p className={styles.tags}>{tags.join("・")}</p>
          ) : null}
        </div>
      </Link>
    </li>
  );
}
