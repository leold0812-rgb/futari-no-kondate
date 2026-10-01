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
  test("投稿の文章を貼り付けると、材料の単位と数量が選ばれた状態で入力欄に入る", async ({ page }) => {
    await login(page, MEMBER_1, PIN_1);
    await page.goto("/recipes/new");
    await page.getByText("投稿の文章を貼り付けて取り込む").click();
    await page
      .getByLabel(/Instagramの投稿の文章/)
      .fill("E2E貼り付けの照り焼き\n\n【材料】2人分\n・鶏もも肉300g\n・醤油 大2\n・卵 1/2個\n・塩 少々\n\n【作り方】\n① 鶏肉を焼く\n② たれをからめる\n\n#レシピ");
    await page.getByRole("button", { name: "文章から取り込む" }).click();

    await expect(page.getByText("文章からレシピを読み取りました")).toBeVisible();
    await expect(page.getByLabel("料理名（必須）")).toHaveValue("E2E貼り付けの照り焼き");
    await expect(page.getByLabel("1行目の材料名")).toHaveValue("鶏もも肉");
    await expect(page.getByLabel("1行目の単位")).toHaveValue("g");
    await expect(page.getByLabel("1行目の数量")).toHaveValue("300");
    await expect(page.getByLabel("2行目の単位")).toHaveValue("大さじ");
    await expect(page.getByLabel("2行目の数量")).toHaveValue("2");
    await expect(page.getByLabel("3行目の単位")).toHaveValue("個");
    await expect(page.getByLabel("3行目の数量")).toHaveValue("0.5");
    await expect(page.getByLabel("4行目の単位")).toHaveValue("少々");
    await expect(page.getByLabel("4行目の数量")).toBeDisabled();
    await snap(page, "22-import-text");
    // 保存はしない（後続の献立・買い物のテストの候補を変えないため）
  });

  test("レシピの書かれていない文章は、理由を示して取り込まない", async ({ page }) => {
    await login(page, MEMBER_1, PIN_1);
    await page.goto("/recipes/new");
    await page.getByText("投稿の文章を貼り付けて取り込む").click();
    await page.getByLabel(/Instagramの投稿の文章/).fill("「動画」とコメントで受け取れます。ご案内をDMでお送りします。");
    await page.getByRole("button", { name: "文章から取り込む" }).click();
    await expect(page.getByRole("alert").filter({ hasText: "レシピを読み取れませんでした" })).toContainText("「材料」の見出しが見つかりませんでした");
  });
});
