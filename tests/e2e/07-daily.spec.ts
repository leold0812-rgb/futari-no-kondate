import { expect, test } from "@playwright/test";
import { MEMBER_1, PIN_1, login, snap } from "./helpers";
import { seedMainRecipes } from "./seed";

test.describe.serial("平日の献立と作った（Gate 7）", () => {
  test.beforeAll(async () => {
    await seedMainRecipes(["E2E副菜1", "E2E副菜2"], { dishType: "SIDE" });
    await seedMainRecipes(["E2E汁物"], { dishType: "SOUP" });
  });

  test("ご飯の量を設定できる", async ({ page }) => {
    await login(page, MEMBER_1, PIN_1);
    await page.goto("/settings");
    await page.getByLabel("自分のご飯（g）").fill("150");
    await page.getByRole("button", { name: "保存", exact: true }).click();
    await expect(page.getByText("ご飯の量を150gにしました。")).toBeVisible();
  });

  test("献立を開き、副菜を差し替え、作ったを記録して初回評価をつける", async ({ page }) => {
    await login(page, MEMBER_1, PIN_1);
    await expect(page.getByRole("heading", { name: /今週の献立（\d+つ残り）/ })).toBeVisible();
    await page.getByRole("listitem").filter({ hasText: /E2E/ }).first().getByRole("link").click();
    await expect(page).toHaveURL(/\/meals\//);
    await expect(page.getByText("ご飯 150g")).toBeVisible();

    // 副菜が無ければ足し、あれば差し替える
    const add = page.getByRole("button", { name: /副菜を足す/ });
    if (await add.count()) {
      await add.click();
      await expect(page.getByText("差し替えました。")).toBeVisible();
    }
    await page.getByText("副菜を差し替える").click();
    await page.getByRole("button", { name: /に差し替える$/ }).first().click();
    await expect(page.getByText("差し替えました。")).toBeVisible();
    await snap(page, "60-meal-detail");

    await page.getByRole("button", { name: "作った", exact: true }).click();
    await expect(page.getByText("作った記録をつけました")).toBeVisible();
    const firstRating = page.getByRole("group", { name: /の評価$/ }).first();
    await expect(firstRating).toBeVisible();
    await firstRating.getByRole("button", { name: "また作りたい" }).click();
    await expect(firstRating.getByRole("button", { name: "また作りたい" })).toHaveAttribute("aria-pressed", "true");
    await snap(page, "61-meal-done");

    await page.getByRole("link", { name: "ホームへ戻る" }).click();
    await expect(page.getByText("✓ 作った")).toBeVisible();
    await snap(page, "62-home-after-cooked");
  });

  test("余裕日のごはんを提案し、作ったを記録できる", async ({ page }) => {
    await login(page, MEMBER_1, PIN_1);
    await page.goto("/free-day");
    await expect(page.getByRole("heading", { level: 1, name: "余裕日のごはん" })).toBeVisible();
    await snap(page, "63-free-day");
    const button = page.getByRole("button", { name: "これを作った" }).first();
    await button.click();
    await expect(page.getByText(/作った記録をつけました|記録済みです/).first()).toBeVisible();
  });
});
