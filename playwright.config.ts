import { defineConfig } from "@playwright/test";

/**
 * E2E（CIのローカルSupabase＋本番build）。hosted Supabaseには接続しない。
 * 実行前提：`npm run build` 済み、ローカルSupabaseにbootstrap済みの2人（PINは E2E_PIN_1 / E2E_PIN_2）。
 * DBの状態を共有するため直列に実行する。specはファイル名の番号順（01-, 02-, …）に流れる前提で書いている。
 */
const port = Number(process.env.E2E_PORT ?? 3000);
const baseURL = `http://127.0.0.1:${port}`;

export default defineConfig({
  testDir: "tests/e2e",
  outputDir: "test-results/e2e",
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 60_000,
  expect: { timeout: 10_000 },
  reporter: [["list"], ["html", { outputFolder: "playwright-report", open: "never" }]],
  use: {
    baseURL,
    locale: "ja-JP",
    timezoneId: "Asia/Tokyo",
    // iPhone 14相当の表示領域（CIはChromiumで確認する）
    viewport: { width: 390, height: 844 },
    deviceScaleFactor: 2,
    isMobile: true,
    hasTouch: true,
    screenshot: "only-on-failure",
    trace: "retain-on-failure",
  },
  projects: [{ name: "mobile-chromium", use: { browserName: "chromium" } }],
  webServer: {
    command: `npm run start -- -p ${port} -H 127.0.0.1`,
    url: `${baseURL}/login`,
    reuseExistingServer: false,
    timeout: 120_000,
  },
});
