import { expect, type Page } from "@playwright/test";

export const MEMBER_1 = process.env.E2E_MEMBER_1_NAME ?? "E2E太郎";
export const MEMBER_2 = process.env.E2E_MEMBER_2_NAME ?? "E2E花子";
export const PIN_1 = process.env.E2E_PIN_1 ?? "";
export const PIN_2 = process.env.E2E_PIN_2 ?? "";

/** 画面の確認用スクリーンショット（CIのartifactで見る） */
export async function snap(page: Page, name: string) {
  await page.screenshot({ path: `test-results/screens/${name}.png`, fullPage: true });
}

/** ログインする。`stay: true` なら現在のログイン画面（next付きなど）のまま入力する */
export async function login(page: Page, member: string, pin: string, options: { stay?: boolean } = {}) {
  if (!options.stay) await page.goto("/login");
  await page.getByText(member, { exact: true }).click();
  await page.getByLabel(`${member}さんのPIN`).fill(pin);
  await page.getByRole("button", { name: "ログイン" }).click();
  await expect(page).not.toHaveURL(/\/login/);
}
