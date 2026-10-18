import { expect, test } from "@playwright/test";
import { snap } from "./helpers";

test.describe.serial("記録（Gate 8）", () => {
  test("食事の履歴と週平均カロリーが見られ、体重の記録は無い", async ({ page }) => {
    await page.goto("/");
    await page.getByRole("link", { name: "記録", exact: true }).click();
    await expect(page.getByRole("heading", { level: 1, name: "記録" })).toBeVisible();

    // Gate 7で作った夕食が履歴と週平均に出る
    await expect(page.getByRole("heading", { name: "食事の履歴" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "夕食のカロリー（週平均）" })).toBeVisible();
    await expect(page.getByText("今週", { exact: true })).toBeVisible();

    // 体重の記録は削除済み
    await expect(page.getByText("体重")).toHaveCount(0);
    await snap(page, "80-records");
  });

  test("バックアップのCron routeは正しいsecretが無ければ拒否する", async ({ request }) => {
    const none = await request.get("/api/cron/backup");
    expect(none.status()).toBe(401);
    const wrong = await request.get("/api/cron/backup", { headers: { authorization: "Bearer wrong-secret-value-000000" } });
    expect(wrong.status()).toBe(401);
  });
});
