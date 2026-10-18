import { expect, type Page } from "@playwright/test";

/** 画面の確認用スクリーンショット（CIのartifactで見る） */
export async function snap(page: Page, name: string) {
  await page.screenshot({ path: `test-results/screens/${name}.png`, fullPage: true });
}

/** CIの同じ環境で、ホームの表示とページ全体の読込時間を別々に比較する。利用者情報は出力しない。 */
export async function measureHomeNavigation(page: Page, state: "empty" | "planned", heading: string) {
  const started = performance.now();
  await page.goto("/", { waitUntil: "commit" });
  await expect(page.getByRole("heading", { level: 1, name: heading })).toBeVisible();
  const contentReadyMs = Math.round(performance.now() - started);
  await page.waitForLoadState("load");
  const fullLoadMs = Math.round(performance.now() - started);
  const ttfbMs = await page.evaluate(() => {
    const navigation = performance.getEntriesByType("navigation")[0] as PerformanceNavigationTiming | undefined;
    return navigation ? Math.round(navigation.responseStart) : null;
  });
  console.info(`[home-perf] ${JSON.stringify({ state, contentReadyMs, fullLoadMs, ttfbMs })}`);
}
