import { expect, test } from "@playwright/test";
import { MEMBER_1, PIN_1, login, snap } from "./helpers";
import { seedFood, seedMainRecipes } from "./seed";

test.describe.serial("栄養の計算（Gate 2b）", () => {
  test.beforeAll(async () => {
    await seedMainRecipes(["E2E栄養テスト"]);
    // 架空の値（テスト用）
    await seedFood("E2Eテスト食品", "90001", { energy: 150, protein: 12, fat: 8, carbs: 6 });
  });

  test("材料に食品と重さを設定すると、レシピの1人前の栄養が計算される", async ({ page }) => {
    await login(page, MEMBER_1, PIN_1);
    await page.goto("/inventory/ingredients");
    await page.getByRole("listitem").filter({ hasText: "E2E栄養テストの材料" }).getByRole("link", { name: "栄養の設定" }).click();
    await page.getByLabel("食品名で検索").fill("E2Eテスト食品");
    await page.getByRole("button", { name: "検索" }).click();
    await page.getByRole("button", { name: "E2Eテスト食品にする" }).click();
    await expect(page.getByText("保存しました。")).toBeVisible();
    await page.getByLabel(/あたりの重さ（g）$/).first().fill("200");
    await page.getByRole("button", { name: "保存", exact: true }).click();
    await expect(page.getByText("保存しました。")).toBeVisible();
    await snap(page, "70-ingredient-nutrition");

    // seedのレシピは2人分・材料1個 → 200g × 150kcal/100g ÷ 2人 = 150kcal
    await page.goto("/recipes?q=E2E栄養テスト");
    await page.getByRole("link", { name: /E2E栄養テスト/ }).click();
    await expect(page.getByText("150kcal")).toBeVisible();
    await expect(page.getByText("E2Eテスト用から計算した値（ご飯は含みません）")).toBeVisible();
    await snap(page, "71-recipe-nutrition");
  });
});
