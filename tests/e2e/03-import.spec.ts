import { expect, test } from "@playwright/test";
import { MEMBER_1, PIN_1, login, snap } from "./helpers";

// CIではOpenAIのキーを設定しない。JSON-LDの無いページや取得できないページは失敗の経路になる
test.describe.serial("URL取り込み（Gate 3）", () => {
  test("内部向けURLは取り込まず、手入力で続けられる", async ({ page }) => {
    await login(page, MEMBER_1, PIN_1);
    await page.goto("/recipes/new");
    await page.getByLabel("レシピのページのURL").fill("http://127.0.0.1/recipe");
    await page.getByRole("button", { name: "取り込む" }).click();
    const alert = page.getByRole("alert").filter({ hasText: "レシピを読み取れませんでした" });
    await expect(alert).toContainText("端末内");
    // 取得先として不適切なURLは「URLだけ保存」も出さない
    await expect(page.getByRole("button", { name: "URLだけ保存する" })).toHaveCount(0);
    await snap(page, "20-import-blocked");

    await page.getByRole("button", { name: "手入力で続ける" }).click();
    await page.getByLabel("料理名（必須）").fill("E2E手入力の副菜");
    await page.getByText("副菜", { exact: true }).click();
    await page.getByRole("button", { name: "保存する" }).click();
    await expect(page.getByRole("heading", { level: 1, name: "E2E手入力の副菜" })).toBeVisible();
  });

  test("読み取れないページはURLだけ保存でき、あとで再取り込みへ進める", async ({ page }) => {
    await login(page, MEMBER_1, PIN_1);
    await page.goto("/recipes/new");
    await page.getByLabel("レシピのページのURL").fill("https://example.com/");
    await page.getByRole("button", { name: "取り込む" }).click();
    await expect(page.getByRole("alert").filter({ hasText: "レシピを読み取れませんでした" })).toBeVisible({ timeout: 30_000 });
    await snap(page, "21-import-failed");

    await page.getByRole("button", { name: "URLだけ保存する" }).click();
    await expect(page.getByText("URLだけ保存されています。")).toBeVisible();
    await snap(page, "22-url-only");

    await page.getByRole("link", { name: "もう一度取り込む" }).click();
    await expect(page.getByRole("heading", { level: 1, name: "もう一度取り込む" })).toBeVisible();
    await expect(page.getByLabel("レシピのページのURL")).toHaveValue("https://example.com/");
    // 再取り込みでは既に保存済みのため「URLだけ保存」は出さない
    await page.getByRole("button", { name: "取り込む" }).click();
    await expect(page.getByRole("button", { name: "手入力で続ける" })).toBeVisible({ timeout: 30_000 });
    await expect(page.getByRole("button", { name: "URLだけ保存する" })).toHaveCount(0);
  });
});
