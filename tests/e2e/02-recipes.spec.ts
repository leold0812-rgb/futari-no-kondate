import { expect, test } from "@playwright/test";
import { MEMBER_1, MEMBER_2, PIN_1, PIN_2, login, snap } from "./helpers";

// 1x1のPNG（写真アップロードの確認用）
const PNG_1X1 = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=",
  "base64",
);

test.describe.serial("レシピ（Gate 2）", () => {
  test("レシピを登録し、人数換算・評価・お気に入り・調理モードを使える", async ({ page }) => {
    await login(page, MEMBER_1, PIN_1);
    await page.goto("/recipes");
    await expect(page.getByText("レシピはまだありません")).toBeVisible();
    await snap(page, "10-recipes-empty");
    await page.getByRole("link", { name: "最初のレシピを追加する" }).click();
    // 追加画面はURL取り込みが既定（Gate 3）。ここでは手入力で登録する
    await page.getByRole("button", { name: "URLなしで手入力する" }).click();

    await page.getByLabel("料理名（必須）").fill("E2E照り焼き");
    await page.getByLabel("調理時間（分）").fill("20");
    await page.getByLabel("1行目の材料名").fill("鶏もも肉");
    await page.getByLabel("1行目の分量").fill("300g");
    await page.getByLabel("主な材料").first().check();
    await page.getByRole("button", { name: "＋ 材料を追加" }).click();
    await page.getByLabel("2行目の材料名").fill("醤油");
    await page.getByLabel("2行目の分量").fill("大さじ2");
    await page.getByLabel("手順（1行に1つ）").fill("1. 鶏肉を皮目から焼く\n2. タレを絡める");
    await page.getByLabel("高タンパク").check();
    await page.getByLabel("写真を選ぶ（任意）").setInputFiles({ name: "photo.png", mimeType: "image/png", buffer: PNG_1X1 });
    await expect(page.getByAltText("選んだ写真のプレビュー")).toBeVisible();
    await snap(page, "11-recipe-form");
    await page.getByRole("button", { name: "保存する" }).click();

    await expect(page.getByRole("heading", { level: 1, name: "E2E照り焼き" })).toBeVisible();
    await expect(page.getByText("保存しました。")).toBeVisible();
    await expect(page.getByAltText("E2E照り焼きの写真")).toBeVisible();
    await expect(page.getByRole("listitem").filter({ hasText: "鶏もも肉" })).toContainText("300g");

    await page.getByRole("button", { name: "4人分" }).click();
    await expect(page.getByRole("listitem").filter({ hasText: "鶏もも肉" })).toContainText("600g");
    await expect(page.getByRole("listitem").filter({ hasText: "醤油" })).toContainText("大さじ4");

    await page.getByRole("button", { name: "また作りたい" }).click();
    await expect(page.getByRole("button", { name: /また作りたい/ })).toHaveAttribute("aria-pressed", "true");
    await page.getByRole("button", { name: "お気に入りに追加" }).click();
    await expect(page.getByRole("button", { name: /お気に入り登録済み/ })).toBeVisible();
    await snap(page, "12-recipe-detail");

    await page.getByRole("link", { name: "調理モードで作る" }).click();
    await expect(page.getByText("手順 1 / 2")).toBeVisible();
    await expect(page.getByText("鶏肉を皮目から焼く")).toBeVisible();
    await snap(page, "13-cook-mode");
    await page.getByRole("button", { name: "次へ ›" }).click();
    await expect(page.getByText("手順 2 / 2")).toBeVisible();
    await page.getByRole("link", { name: "完了" }).click();
    await expect(page.getByRole("heading", { level: 1, name: "E2E照り焼き" })).toBeVisible();
  });

  test("一覧で検索・絞り込みができ、編集できる", async ({ page }) => {
    await login(page, MEMBER_1, PIN_1);
    await page.goto("/recipes");
    await expect(page.getByRole("link", { name: /E2E照り焼き/ })).toBeVisible();
    await snap(page, "14-recipes-list");

    await page.getByLabel("料理名・材料名で検索").fill("醤油");
    await page.getByRole("button", { name: "検索", exact: true }).click();
    await expect(page.getByRole("link", { name: /E2E照り焼き/ })).toBeVisible();
    await page.getByLabel("料理名・材料名で検索").fill("存在しない料理");
    await page.getByRole("button", { name: "検索", exact: true }).click();
    await expect(page.getByText("条件に合うレシピがありません")).toBeVisible();

    await page.goto("/recipes?type=SOUP");
    await expect(page.getByText("条件に合うレシピがありません")).toBeVisible();

    await page.goto("/recipes");
    await page.getByRole("link", { name: /E2E照り焼き/ }).click();
    await page.getByRole("link", { name: "編集する" }).click();
    await page.getByLabel("料理名（必須）").fill("E2E鶏の照り焼き");
    await page.getByRole("button", { name: "変更を保存する" }).click();
    await expect(page.getByRole("heading", { level: 1, name: "E2E鶏の照り焼き" })).toBeVisible();
  });

  test("もう1人も同じレシピを見られ、相手の評価が表示される", async ({ page }) => {
    await login(page, MEMBER_2, PIN_2);
    await page.goto("/recipes");
    await page.getByRole("link", { name: /E2E鶏の照り焼き/ }).click();
    await expect(page.getByText(`${MEMBER_1}さんの評価：また作りたい`)).toBeVisible();
    await expect(page.getByRole("button", { name: "お気に入りに追加" })).toBeVisible();
  });

  test("入力に誤りがあると、保存せずに理由を示す", async ({ page }) => {
    await login(page, MEMBER_1, PIN_1);
    await page.goto("/recipes/new");
    await page.getByRole("button", { name: "URLなしで手入力する" }).click();
    await page.getByRole("button", { name: "保存する" }).click();
    await expect(page.getByRole("alert").filter({ hasText: "料理名を入力してください" })).toBeVisible();
    await expect(page.getByText("まだ保存されていません")).toBeVisible();
  });

  test("レシピを削除すると一覧から消える", async ({ page }) => {
    await login(page, MEMBER_1, PIN_1);
    await page.goto("/recipes/new");
    await page.getByRole("button", { name: "URLなしで手入力する" }).click();
    await page.getByLabel("料理名（必須）").fill("E2E削除用");
    await page.getByRole("button", { name: "保存する" }).click();
    await expect(page.getByRole("heading", { level: 1, name: "E2E削除用" })).toBeVisible();
    await expect(page.getByText("材料と作り方がそろうと、週の献立候補に使えます。")).toBeVisible();
    await page.getByText("このレシピを削除する").click();
    await page.getByRole("button", { name: "削除する" }).click();
    await expect(page.getByText("レシピを削除しました。")).toBeVisible();
    await expect(page.getByRole("link", { name: /E2E削除用/ })).toHaveCount(0);
  });
});
