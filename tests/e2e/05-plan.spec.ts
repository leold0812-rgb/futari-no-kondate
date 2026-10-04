import { expect, test } from "@playwright/test";
import { MEMBER_1, MEMBER_2, PIN_1, PIN_2, login, measureHomeNavigation, snap } from "./helpers";
import { seedMainRecipes } from "./seed";

test.describe.serial("週間計画（Gate 5）", () => {
  test.beforeAll(async () => {
    await seedMainRecipes(["E2E主菜A", "E2E主菜B", "E2E主菜C", "E2E主菜D", "E2E主菜E", "E2E主菜F", "E2E主菜G"]);
  });

  test("候補を1枚ずつ選び、1つ戻して、5品で確定できる", async ({ page }) => {
    await login(page, MEMBER_1, PIN_1);
    await expect(page.getByRole("heading", { level: 1, name: "今週、なに作ろう？" })).toBeVisible();
    await page.getByRole("link", { name: "献立を決める" }).click();

    await expect(page.getByText(/作る：0 \/ 5品/)).toBeVisible({ timeout: 20_000 });
    await snap(page, "40-plan-deck");

    const accept = page.getByRole("button", { name: "作る →" });
    const skip = page.getByRole("button", { name: "← スキップ" });
    await accept.click();
    await expect(page.getByText(/作る：1 \/ 5品/)).toBeVisible();
    await skip.click();
    await page.getByRole("button", { name: "↶ 1つ戻る" }).click();
    await expect(page.getByText(/作る：1 \/ 5品/)).toBeVisible();

    // キーボード（右矢印）でも選べる。保存中（「1つ戻る」の送信中）のキー入力は受け付けないため、
    // ボタンが押せる状態に戻ってから押す（「作る：1」は戻す前後で同じ表示なので完了の目印にならない）
    await expect(accept).toBeEnabled();
    await page.getByRole("group", { name: /右矢印で作る/ }).press("ArrowRight");
    await expect(page.getByText(/作る：2 \/ 5品/)).toBeVisible();
    for (let i = 3; i <= 5; i += 1) {
      await accept.click();
      await expect(page.getByText(new RegExp(`作る：${i} / 5品`))).toBeVisible();
    }
    await expect(page.getByText("5品そろいました")).toBeVisible();
    await page.getByRole("link", { name: "5品を確認する" }).click();

    await expect(page.getByRole("heading", { level: 1, name: "今週の主菜を確認" })).toBeVisible();
    await expect(page.getByRole("button", { name: /を外す$/ })).toHaveCount(5);
    await snap(page, "41-plan-confirm");
    await page.getByRole("button", { name: "この5品で決める" }).click();

    // 確定すると副菜・汁物と買い物リストの下書きが用意され、買い物の準備画面へ進む（Gate 6）
    await expect(page.getByText("献立を決めました。副菜・汁物と買い物リストを用意しました。")).toBeVisible();
    await measureHomeNavigation(page, "planned", "今週の食卓");
    await expect(page.getByRole("region", { name: "今週の献立" }).getByRole("listitem")).toHaveCount(5);
    await snap(page, "42-home-planned");
  });

  test("もう1人のホームにも決まった献立が出て、計画画面は決定済みになる", async ({ page }) => {
    await login(page, MEMBER_2, PIN_2);
    await expect(page.getByRole("heading", { level: 1, name: "今週の食卓" })).toBeVisible();
    await expect(page.getByRole("region", { name: "今週の献立" }).getByRole("listitem")).toHaveCount(5);
    await page.goto("/plan");
    await expect(page.getByText("この週の献立は決定済みです")).toBeVisible();
    await expect(page.getByRole("link", { name: "来週の献立を決める" })).toHaveCount(0);
    await page.goto("/");
    await expect(page.getByRole("link", { name: "来週の献立を決める" })).toBeVisible();
  });
});
