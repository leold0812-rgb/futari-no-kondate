import { expect, test } from "@playwright/test";
import { MEMBER_1, MEMBER_2, PIN_1, PIN_2, login, snap } from "./helpers";

test.describe.serial("買い物（Gate 6）", () => {
  test("確定した献立の副菜・汁物を確認し、家にあるものを外し、保険食材を足して確定できる", async ({ page }) => {
    await login(page, MEMBER_1, PIN_1);
    await page.goto("/plan/shopping");
    await expect(page.getByRole("heading", { level: 1, name: "今週の買い物の準備" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "1. 今週の献立" })).toBeVisible();
    await expect(page.getByText(/副菜：/).first()).toBeVisible();
    await snap(page, "50-shopping-prep");

    // seedした主菜の材料（「E2E主菜Aの材料」など）が買う物に並ぶ。1つを「家にある」にする
    const homeButtons = page.getByRole("button", { name: /は家にある$/ });
    const before = await homeButtons.count();
    expect(before).toBeGreaterThan(0);
    await homeButtons.first().click();
    await expect(page.getByRole("button", { name: /を買う物に戻す$/ })).toHaveCount(1);

    const insurance = page.getByRole("button", { name: /を保険食材として追加$/ });
    if ((await insurance.count()) > 0) await insurance.first().click();

    await page.getByRole("button", { name: "4. この内容で買い物リストを確定" }).click();
    await expect(page.getByText("買い物リストを確定しました。")).toBeVisible();
    await snap(page, "51-shopping-list");
  });

  test("買った物を押すと薄く残り、在庫に入る。相手の画面にも反映される", async ({ page, browser }) => {
    await login(page, MEMBER_1, PIN_1);
    await page.goto("/shopping");
    const summary = page.getByText(/残り \d+ \/ \d+ 品/);
    await expect(summary).toBeVisible();
    const first = page.getByRole("button", { name: /（押すと購入済み）/ }).first();
    const itemName = (await first.textContent())?.replace(/（.*$/, "").trim() ?? "";
    await first.click();
    await expect(page.getByRole("button", { name: /（購入済み。押すと未購入に戻す）/ }).first()).toBeVisible();

    // もう1人の画面（別のブラウザ）でも購入済みになっている
    const partner = await browser.newContext({ viewport: { width: 390, height: 844 } });
    const partnerPage = await partner.newPage();
    await login(partnerPage, MEMBER_2, PIN_2);
    await partnerPage.goto("/shopping");
    await expect(partnerPage.getByRole("button", { name: /（購入済み。押すと未購入に戻す）/ })).toHaveCount(1);
    await partner.close();

    await page.goto("/inventory");
    expect(itemName.length).toBeGreaterThan(0);
    await expect(page.getByRole("main")).toContainText(itemName.slice(0, 4));
  });

  test("ほかに買う物を追加でき、カテゴリ順を変えられる", async ({ page }) => {
    await login(page, MEMBER_2, PIN_2);
    await page.goto("/shopping");
    await page.getByText("ほかに買う物を追加する").click();
    await page.getByLabel("品名").fill("E2Eティッシュ");
    await page.getByLabel("分量（任意）").fill("1箱");
    await page.getByRole("button", { name: "追加", exact: true }).click();
    await expect(page.getByText("E2Eティッシュを追加しました。")).toBeVisible();
    await expect(page.getByRole("button", { name: /E2Eティッシュ/ })).toBeVisible();

    await page.goto("/settings");
    await page.getByRole("button", { name: "肉を上へ" }).click();
    await page.getByRole("button", { name: "この並び順で保存" }).click();
    await expect(page.getByText("並び順を保存しました。")).toBeVisible();
  });
});
