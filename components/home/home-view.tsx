import Link from "next/link";
import { RecipeImage } from "@/components/recipes/recipe-image";
import { Alert } from "@/components/ui/alert";
import { LinkButton } from "@/components/ui/button";
import styles from "./home.module.css";

export type HomeMeal = {
  id: string;
  mainRecipeId: string;
  name: string;
  sideName?: string | null;
  soupName?: string | null;
  imageUrl: string | null;
  cooked: boolean;
  useSoon?: boolean;
};

type Props = {
  weekRange: string;
  status: "NONE" | "DRAFT" | "CONFIRMED" | "COMPLETED";
  meals: HomeMeal[];
  nextWeek: string;
  nextWeekStatus: "NONE" | "DRAFT" | "CONFIRMED" | "COMPLETED";
  justConfirmed?: boolean;
  /** 買い物リストの準備が途中の週 */
  shoppingDraftWeek?: string | null;
};

/** ホーム：今週の献立が未決定なら「今週の献立を決める」を最優先の1アクションにする（UIガイドライン） */
export function HomeView({ weekRange, status, meals, nextWeek, nextWeekStatus, justConfirmed, shoppingDraftWeek }: Props) {
  const decided = status === "CONFIRMED" || status === "COMPLETED";
  return (
    <div className={styles.home}>
      <header className={styles.header}>
        <div>
          <p className={styles.eyebrow}><span className={styles.brandMark} aria-hidden="true">✳</span> FUTARI NO KONDATE</p>
          <h1 className={styles.title}>{decided ? "今週の食卓" : "今週、なに作ろう？"}</h1>
          <p className={styles.date}><span aria-hidden="true">☼</span> {weekRange}</p>
        </div>
        <span className={styles.headerStamp} aria-label="ふたりの台所">ふたり<br />の台所</span>
      </header>
      {justConfirmed ? <Alert tone="success">献立を決めました。</Alert> : null}
      {shoppingDraftWeek ? (
        <Alert tone="info">
          <p>買い物リストの準備が途中です。</p>
          <LinkButton href={`/plan/shopping?week=${shoppingDraftWeek}`} size="small">
            準備を続ける
          </LinkButton>
        </Alert>
      ) : null}
      {!decided ? (
        <>
          <section className={styles.hero} aria-labelledby="welcome-title">
            <div className={styles.heroCopy}>
              <p className={styles.heroKicker}><span aria-hidden="true">✦</span> WEEKLY TABLE</p>
              <h2 id="welcome-title">ふたりで囲む、<br />今週のごはん。</h2>
              <p className={styles.heroText}>食べたいものを選んだら、買い物の準備までできあがり。</p>
              <LinkButton href="/plan" size="large" className={styles.heroButton}>
                {status === "DRAFT" ? "つづきから決める" : "献立を決める"}
                <span aria-hidden="true">→</span>
              </LinkButton>
            </div>
            <div className={styles.heroArt} aria-hidden="true">
              <svg viewBox="0 0 260 230" role="presentation">
                <ellipse cx="142" cy="198" rx="94" ry="14" fill="#344636" opacity=".12" />
                <circle cx="146" cy="119" r="89" fill="#fffaf0" />
                <circle cx="146" cy="119" r="75" fill="#e7b85b" />
                <circle cx="146" cy="119" r="64" fill="#f4d67f" />
                <path d="M96 123c18-31 45 31 65-6s37 18 39-7M102 145c22-20 35 16 54-4s30 13 42-6" fill="none" stroke="#fff5d7" strokeWidth="8" strokeLinecap="round" />
                <path d="M106 93c-11-17-3-29 9-34 14 10 15 25 3 36M153 76c-4-18 7-28 21-27 10 14 5 29-11 35M183 105c5-17 19-20 31-12 2 18-9 28-26 23" fill="#64815d" />
                <path d="M112 87l-1-20M165 76l3-18M192 107l13-9" fill="none" stroke="#456342" strokeWidth="3" strokeLinecap="round" />
                <circle cx="124" cy="134" r="9" fill="#cf624a" /><circle cx="171" cy="147" r="8" fill="#cf624a" /><circle cx="183" cy="91" r="7" fill="#cf624a" />
                <path d="M122 134l2-7M169 147l2-6M181 91l2-5" stroke="#78914f" strokeWidth="3" strokeLinecap="round" />
                <path d="M53 84c-10-19-4-34 11-43 16 8 20 23 8 40M64 74l-1-21" fill="#80936d" />
                <path d="M220 159c8-15 20-17 31-9 0 15-10 23-25 17" fill="#91a578" />
                <path d="M39 145l3-8m-7-9 7 2m174-77 2-8m8 2 6-3" stroke="#bf6950" strokeWidth="4" strokeLinecap="round" />
                <path d="M69 180c-8 0-14-7-14-15 0-7 5-12 11-13 3-10 18-10 22-1 8 1 12 7 12 14 0 9-7 15-16 15z" fill="#f5d98b" />
                <path d="M176 48c7-10 18-9 23 0-2 10-13 14-23 7" fill="#e6a05b" />
                <circle cx="183" cy="53" r="2" fill="#fff5d7" />
              </svg>
              <span className={styles.artNote}>おいしい時間、<br />いっしょに。</span>
            </div>
            <span className={styles.heroSun} aria-hidden="true">✳</span>
          </section>
          <div className={styles.howItWorks} aria-label="献立づくりの流れ">
            <span><span className={styles.stepDot} aria-hidden="true">1</span> 5つ選ぶ</span>
            <span className={styles.stepArrow} aria-hidden="true">→</span>
            <span><span className={`${styles.stepDot} ${styles.stepDotYellow}`} aria-hidden="true">2</span> 買い物リスト</span>
            <span className={styles.stepArrow} aria-hidden="true">→</span>
            <span><span className={`${styles.stepDot} ${styles.stepDotCoral}`} aria-hidden="true">3</span> 作って食べる</span>
          </div>
          <section className={styles.tip}>
            <span className={styles.tipIcon} aria-hidden="true">🥬</span>
            <p><strong>冷蔵庫の食材から、ちょうどいい献立を。</strong><br /><span>ふたりの好みと在庫を見ながら提案します。</span></p>
            <span className={styles.tipSparkle} aria-hidden="true">✧</span>
          </section>
        </>
      ) : (
        <section aria-labelledby="week-meals" className={styles.section}>
          <div className={styles.sectionHeading}>
            <div><p className={styles.sectionEyebrow}>GOOD FOOD, GOOD MOOD</p><h2 id="week-meals" className={styles.sectionTitle}>今週の献立</h2></div>
            <span className={styles.remaining}>{meals.filter((m) => !m.cooked).length}<small>品のこり</small></span>
          </div>
          <ul className={styles.meals}>
            {meals.map((meal) => (
              <li key={meal.id} className={styles.meal} data-cooked={meal.cooked}>
                <Link href={`/meals/${meal.id}`} className={styles.mealLink}>
                  <RecipeImage url={meal.imageUrl} name={meal.name} className={styles.mealImage} />
                  <span className={styles.mealName}>{meal.name}</span>
                  {meal.sideName || meal.soupName ? (
                    <span className={styles.mealSub}>{[meal.sideName, meal.soupName].filter(Boolean).join("・")}</span>
                  ) : null}
                  {meal.cooked ? <span className={styles.cooked}>✓ 作った</span> : meal.useSoon ? <span className={styles.useSoon}>⚠ そろそろ使いたい食材</span> : null}
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}
      {decided ? (
        <LinkButton href="/free-day" variant="ghost" block>
          <span aria-hidden="true">☀ </span>献立のない日のごはんを探す
        </LinkButton>
      ) : null}
      {decided ? (
        <LinkButton href={`/plan?week=${nextWeek}`} variant="secondary" block>
          <span aria-hidden="true">✦ </span>{nextWeekStatus === "CONFIRMED" || nextWeekStatus === "COMPLETED" ? "来週の献立を見る" : "来週の献立を決める"}
        </LinkButton>
      ) : null}
    </div>
  );
}
