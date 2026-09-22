/**
 * 声で稼働を入力：話した（または書いた）言葉から稼働の行を作り、確認してから保存する。
 *
 * テストではマイクを使えないため、同じ入口の文字入力で確かめる
 * （画面は「音声が使えない端末では文字で入力する」つくりになっている）。
 * 前提：§8.6 の初期データ（resetToSeed）。テストは順番に依存するため serial
 */
import { test, expect } from "@playwright/test";
import { E2E, loginViaMagicLink, readState, resetToSeed, saveScreenshot, toast } from "./helpers";

test.describe.configure({ mode: "serial" });

test.beforeEach(async () => {
  const state = readState();
  test.skip(!state || state.appSkipped, "E2E_SKIP_APP=1 のため Next.js を起動していません");
});

test.describe("声で稼働を入力", () => {
  test.beforeAll(async () => {
    const state = readState();
    if (!state || state.appSkipped) return;
    await resetToSeed();
  });

  test.beforeEach(async ({ page }) => {
    await loginViaMagicLink(page, E2E.users.owner.email, "/entries?m=2026-09");
  });

  test("言葉を読み取って下書きにし、確認してからまとめて保存できる", async ({ page }, testInfo) => {
    const isMobile = testInfo.project.name === "mobile";
    await expect(page.getByText("2026年9月の稼働行 10 件")).toBeVisible();

    await page.getByRole("button", { name: "声で入力" }).click();
    const dialog = page.getByRole("dialog");
    await expect(dialog.getByRole("heading", { name: "声で稼働を入力" })).toBeVisible();

    // 「アマゾン」と話しても、英字で登録された「三郷Amazon」に当たる
    await dialog.getByLabel("聞き取った内容").fill("吉田 三郷アマゾン 15、相曽 三郷アマゾン 22");
    await expect(dialog.getByText("読み取り中")).toBeVisible();
    await expect(dialog.getByText("吉田雅一")).toBeVisible();
    await expect(dialog.getByText("相曽慧")).toBeVisible();
    if (isMobile) await saveScreenshot(page, "voice-entry-mobile.png", { fullPage: false });

    await dialog.getByRole("button", { name: "内容を確認する" }).click();

    // 既にある行（相曽慧 × 三郷Amazon 21 日）だけが「いまの数量 21 → 22」を見せる
    const nowLines = dialog.locator("li p").filter({ hasText: "いまの数量" });
    await expect(nowLines).toHaveCount(1);
    await expect(nowLines.first()).toContainText("21");
    await expect(nowLines.first()).toContainText("22");
    await dialog.getByRole("button", { name: "2 件を保存" }).click();

    await expect(toast(page, "保存しました")).toBeVisible();
    await expect(page.getByText("2026年9月の稼働行 11 件")).toBeVisible();
  });

  test("どの画面からでも ⌘K から声で入力を開ける", async ({ page }) => {
    await page.getByRole("link", { name: "ホーム" }).first().click();
    await expect(page.getByRole("heading", { name: "ダッシュボード" })).toBeVisible();

    await page.getByRole("button", { name: "検索" }).first().click();
    await page.getByLabel("検索語").fill("こえ");
    await page.keyboard.press("Enter");

    await expect(page.getByRole("dialog").getByRole("heading", { name: "声で稼働を入力" })).toBeVisible();
  });

  test("ドライバーや案件が足りない行は保存しない", async ({ page }) => {
    await page.getByRole("button", { name: "声で入力" }).click();
    const dialog = page.getByRole("dialog");
    await dialog.getByLabel("聞き取った内容").fill("沼田 12");
    await dialog.getByRole("button", { name: "内容を確認する" }).click();

    await expect(dialog.getByText("未入力 1 行")).toBeVisible();
    await expect(dialog.getByRole("button", { name: /件を保存/ })).toBeDisabled();
  });
});
