import { expect, test } from "@playwright/test";
import { measureHomeNavigation, snap } from "./helpers";

test.describe("開いたらすぐ使える（ログイン画面なし）", () => {
  test("トップを開くとホームが表示される", async ({ page }) => {
    await page.goto("/");
    await expect(page).toHaveURL(/\/$/);
    await expect(page.getByRole("heading", { level: 1, name: "今週、なに作ろう？" })).toBeVisible();
    await measureHomeNavigation(page, "empty", "今週、なに作ろう？");
    await snap(page, "03-home");
  });

  test("保護された画面も直接開ける（入口でsessionを発行する）", async ({ page }) => {
    await page.goto("/records");
    await expect(page).toHaveURL(/\/records$/);
    await expect(page.getByRole("heading", { level: 1, name: "記録" })).toBeVisible();
  });

  test("設定画面にログアウトもPINの変更も無い", async ({ page }) => {
    await page.goto("/settings");
    await expect(page.getByRole("heading", { level: 1, name: "設定" })).toBeVisible();
    await expect(page.getByRole("button", { name: /ログアウト/ })).toHaveCount(0);
    await expect(page.getByText(/PIN/)).toHaveCount(0);
    await snap(page, "04-settings");
  });
});
