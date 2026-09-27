import { expect, test } from "@playwright/test";
import { MEMBER_1, MEMBER_2, PIN_1, PIN_2, login, snap } from "./helpers";

test.describe.serial("記録（Gate 8）", () => {
  test("自分の体重を記録するとグラフに出て、食事の履歴と週平均が見られる", async ({ page }) => {
    await login(page, MEMBER_1, PIN_1);
    await page.getByRole("link", { name: "記録", exact: true }).click();
    await expect(page.getByRole("heading", { level: 1, name: "記録" })).toBeVisible();
    await expect(page.getByText("あなただけが見られます")).toBeVisible();

    await page.getByLabel("体重（kg）").fill("６０．５");
    await page.getByRole("button", { name: "記録する" }).click();
    await expect(page.getByText("記録しました。")).toBeVisible();
    await expect(page.getByText("60.5kg", { exact: true })).toBeVisible();

    // 同じ日に入れ直すと上書きされる
    await page.getByLabel("体重（kg）").fill("60.2");
    await page.getByRole("button", { name: "記録する" }).click();
    await expect(page.getByText("60.2kg", { exact: true })).toBeVisible();
    await expect(page.getByRole("img", { name: /体重の推移。記録1件/ })).toBeVisible();

    // 範囲外は保存しない
    await page.getByLabel("体重（kg）").fill("500");
    await page.getByRole("button", { name: "記録する" }).click();
    await expect(page.getByText("体重は20〜300kgの範囲で")).toBeVisible();

    // Gate 7で作った夕食が履歴と週平均に出る
    await expect(page.getByRole("heading", { name: "食事の履歴" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "夕食のカロリー（週平均）" })).toBeVisible();
    await expect(page.getByText("今週", { exact: true })).toBeVisible();
    await snap(page, "80-records");
  });

  test("相手の画面には自分の体重が出ない", async ({ page }) => {
    await login(page, MEMBER_2, PIN_2);
    await page.goto("/records");
    await expect(page.getByText("まだ記録がありません。")).toBeVisible();
    await expect(page.getByText("60.2kg")).toHaveCount(0);
  });

  test("バックアップのCron routeは正しいsecretが無ければ拒否する", async ({ request }) => {
    const none = await request.get("/api/cron/backup");
    expect(none.status()).toBe(401);
    const wrong = await request.get("/api/cron/backup", { headers: { authorization: "Bearer wrong-secret-value-000000" } });
    expect(wrong.status()).toBe(401);
    expect(await wrong.text()).not.toContain("weight");
  });
});
