import { expect, test } from "@playwright/test";
import { MEMBER_1, MEMBER_2, PIN_1, PIN_2, login, snap } from "./helpers";

function daysAgo(days: number): string {
  const date = new Date(Date.now() + 9 * 3600_000 - days * 86_400_000);
  return date.toISOString().slice(0, 10);
}

test.describe.serial("在庫（Gate 4）", () => {
  test("手で在庫を追加でき、保存目安が近いものは「そろそろ使いたい」に出る", async ({ page }) => {
    await login(page, MEMBER_1, PIN_1);
    await page.goto("/inventory");
    await expect(page.getByText("在庫はまだありません")).toBeVisible();

    await page.getByLabel("材料名").fill("玉ねぎ");
    await page.getByLabel("分量").fill("3個");
    await page.getByRole("button", { name: "在庫に追加" }).click();
    await expect(page.getByText("玉ねぎを在庫に追加しました。")).toBeVisible();

    // 卵・乳製品の保存目安は10日。10日前に買った牛乳は「目安は今日まで」
    await page.getByLabel("材料名").fill("牛乳");
    await page.getByLabel("分量").fill("1000ml");
    await page.getByLabel("購入日").fill(daysAgo(10));
    await page.getByRole("button", { name: "在庫に追加" }).click();
    await expect(page.getByText("牛乳を在庫に追加しました。")).toBeVisible();

    const useSoon = page.getByRole("region", { name: /そろそろ使いたい/ });
    await expect(useSoon).toContainText("牛乳");
    await expect(useSoon).toContainText("目安は今日まで");
    await expect(page.getByRole("region", { name: "野菜・果物" })).toContainText("3個");
    await snap(page, "30-inventory");
  });

  test("数量の補正と使い切りができ、相手の画面にも反映される", async ({ page }) => {
    await login(page, MEMBER_2, PIN_2);
    await page.goto("/inventory");
    const onion = page.getByRole("listitem").filter({ hasText: "玉ねぎ" }).first();
    await onion.getByText("数量を直す").click();
    await onion.getByLabel(/残りの量/).fill("1");
    await onion.getByRole("button", { name: "保存" }).click();
    await expect(page.getByRole("region", { name: "野菜・果物" })).toContainText("1個");

    const milk = page.getByRole("listitem").filter({ hasText: "牛乳" }).first();
    await milk.getByText("数量を直す").click();
    await milk.getByRole("button", { name: /使い切った/ }).click();
    await expect(page.getByRole("listitem").filter({ hasText: "牛乳" })).toHaveCount(0);
  });

  test("材料の設定で保存目安を変えられる", async ({ page }) => {
    await login(page, MEMBER_1, PIN_1);
    await page.goto("/inventory/ingredients");
    await page.getByLabel("玉ねぎの保存目安（日）").fill("14");
    await page.getByRole("listitem").filter({ hasText: "玉ねぎ" }).getByRole("button", { name: "保存" }).click();
    await expect(page.getByLabel("玉ねぎの保存目安（日）")).toHaveValue("14");
    await snap(page, "31-ingredients");
  });
});
