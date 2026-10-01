import { expect, test } from "@playwright/test";
import { MEMBER_1, MEMBER_2, PIN_1, login, measureHomeNavigation, snap } from "./helpers";

test.describe("ログイン（Gate 1.5 / 1.6）", () => {
  test("未ログインで開くとログイン画面になり、2人の名前を選べる", async ({ page }) => {
    await page.goto("/");
    await expect(page).toHaveURL(/\/login$/);
    await expect(page.getByRole("heading", { name: "ログイン" })).toBeVisible();
    await expect(page.getByText(MEMBER_1, { exact: true })).toBeVisible();
    await expect(page.getByText(MEMBER_2, { exact: true })).toBeVisible();
    await snap(page, "01-login");
  });

  test("PINが違うと理由と次の行動を示し、正しいPINでホームへ入れる", async ({ page }) => {
    await page.goto("/login");
    await page.getByText(MEMBER_1, { exact: true }).click();
    await page.getByLabel(`${MEMBER_1}さんのPIN`).fill("274950");
    await page.getByRole("button", { name: "ログイン" }).click();
    // Next.jsのroute announcerもrole="alert"を持つため、文言で特定する
    await expect(page.getByRole("alert").filter({ hasText: "PINが違います" })).toBeVisible();
    await snap(page, "02-login-error");
    // 失敗後も選んだ名前は選択されたまま（PIN欄だけが空に戻る）
    await expect(page.getByRole("radio", { name: MEMBER_1 })).toBeChecked();
    await expect(page.getByLabel(`${MEMBER_1}さんのPIN`)).toHaveValue("");

    await page.getByLabel(`${MEMBER_1}さんのPIN`).fill(PIN_1);
    await page.getByRole("button", { name: "ログイン" }).click();
    await expect(page).toHaveURL(/\/$/);
    await expect(page.getByRole("heading", { level: 1, name: "今週、なに作ろう？" })).toBeVisible();
    await measureHomeNavigation(page, "empty", "今週、なに作ろう？");
    await snap(page, "03-home");
  });

  test("ログイン前に開こうとした画面へ、ログイン後に戻る", async ({ page }) => {
    await page.goto("/records");
    await expect(page).toHaveURL(/\/login\?next=%2Frecords$/);
    await login(page, MEMBER_1, PIN_1, { stay: true });
    await expect(page).toHaveURL(/\/records$/);
  });

  test("ログアウトするとログイン画面へ戻り、保護された画面を開けない", async ({ page }) => {
    await login(page, MEMBER_1, PIN_1);
    await page.goto("/settings");
    await expect(page.getByText(`ログイン中：${MEMBER_1}`)).toBeVisible();
    await snap(page, "04-settings");
    await page.getByRole("button", { name: "この端末でログアウト" }).click();
    await expect(page).toHaveURL(/\/login$/);
    await page.goto("/recipes");
    await expect(page).toHaveURL(/\/login\?next=%2Frecipes$/);
  });
});
