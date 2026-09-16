/**
 * 移行（§8.5）：データ全削除 → 試作アプリ JSON の取り込み（プレビューで検算）→ ダッシュボードの合計が一致 → 再取り込みで重複しない（冪等）
 */
import path from "node:path";
import { test, expect } from "@playwright/test";
import { E2E, ROOT_DIR, countEntries, kpiCard, loginViaMagicLink, readState, saveScreenshot, seedInitialData, toast, yen } from "./helpers";

const FIXTURE = path.join(ROOT_DIR, "tests/fixtures/prototype-sample.json");

test.describe.configure({ mode: "serial" });

test.beforeEach(async () => {
  const state = readState();
  test.skip(!state || state.appSkipped, "E2E_SKIP_APP=1 のため Next.js を起動していません");
});

test.describe("データ移行", () => {
  test.beforeAll(async () => {
    const state = readState();
    if (!state || state.appSkipped) return;
    await seedInitialData();
  });

  test("全削除（会社名で確認）→ 試作 JSON を取り込み → KPI が一致 → 再取り込みしても 10 行のまま", async ({ page }, testInfo) => {
    const isMobile = testInfo.project.name === "mobile";
    await loginViaMagicLink(page, E2E.users.owner.email, "/settings/data");
    await expect(page.getByRole("heading", { name: "データ", exact: true })).toBeVisible();

    // データ全削除：会社名が一致するまでボタンは無効
    const resetButton = page.getByRole("button", { name: "データを全削除" });
    await expect(resetButton).toBeDisabled();
    await page.getByLabel(/確認のため会社名/).fill("別の会社");
    await expect(resetButton).toBeDisabled();
    await page.getByLabel(/確認のため会社名/).fill(E2E.companyName);
    await expect(resetButton).toBeEnabled();
    await resetButton.click();
    const confirm = page.getByRole("dialog");
    await expect(confirm.getByRole("heading", { name: "本当にすべて削除しますか？" })).toBeVisible();
    await confirm.getByRole("button", { name: "すべて削除する" }).click();
    await expect(toast(page, "会社のデータをすべて削除しました。")).toBeVisible();
    expect(countEntries("2026-09")).toBe(0);
    // ドライバーが 0 件になったので初期データ投入パネルが出る
    await expect(page.getByRole("heading", { name: "初期データ投入" })).toBeVisible();

    // 試作アプリ JSON を選ぶ → プレビュー（件数・月別集計）
    const panel = page.locator("div.rounded-lg").filter({ has: page.getByRole("heading", { name: "取り込み・復元（オーナー）" }) });
    await panel.getByLabel("JSON ファイル").setInputFiles(FIXTURE);
    await expect(panel.getByText("試作アプリ JSON")).toBeVisible();
    await expect(panel.getByText(`会社名：${E2E.companyName}`)).toBeVisible();
    await expect(panel.getByText("ドライバー", { exact: true }).locator("xpath=following-sibling::dd")).toHaveText("10 件");
    const monthRow = panel.getByRole("row", { name: /2026年9月/ });
    await expect(monthRow).toContainText("10");
    await expect(monthRow).toContainText(yen(2559573));
    await expect(monthRow).toContainText(yen(652490.3));
    await expect(monthRow).toContainText(yen(1907083));
    await expect(monthRow).toContainText("未締め");
    if (isMobile) await saveScreenshot(page, "import-preview-mobile.png");

    // 取り込みを実行
    await panel.getByRole("button", { name: "取り込みを実行" }).click();
    const dialog = page.getByRole("dialog");
    await expect(dialog.getByRole("heading", { name: "取り込みを実行しますか？" })).toBeVisible();
    await expect(dialog).toContainText("10 件");
    await dialog.getByRole("button", { name: "取り込みを実行" }).click();
    await expect(toast(page, "取り込みが完了しました。")).toBeVisible();
    await expect(toast(page, "稼働行 10 件")).toBeVisible();
    expect(countEntries("2026-09")).toBe(10);

    // ダッシュボードの KPI が試作アプリの合計と一致する
    await page.goto("/dashboard?m=2026-09");
    await expect(kpiCard(page, "会社売上")).toContainText(yen(2559573));
    await expect(kpiCard(page, "会社利益")).toContainText(yen(652490.3));
    await expect(kpiCard(page, "ドライバー支払合計")).toContainText(yen(1907083));
    await expect(kpiCard(page, "利益率")).toContainText("25.5%");

    // もう一度同じファイルを取り込んでも重複しない（ID は決定的）
    await page.goto("/settings/data");
    await panel.getByLabel("JSON ファイル").setInputFiles(FIXTURE);
    await expect(panel.getByText("試作アプリ JSON")).toBeVisible();
    await panel.getByRole("button", { name: "取り込みを実行" }).click();
    await page.getByRole("dialog").getByRole("button", { name: "取り込みを実行" }).click();
    await expect(toast(page, "取り込みが完了しました。")).toBeVisible();
    expect(countEntries("2026-09")).toBe(10);
    await page.goto("/entries?m=2026-09");
    await expect(page.getByText("2026年9月の稼働行 10 件")).toBeVisible();
    await page.goto("/settings/drivers");
    await expect(page.getByText(/全 10 名/)).toBeVisible();

    // 監査ログに全削除・取り込みが残る
    await page.goto("/settings/audit?action=import_backup");
    await expect(page.getByText("取り込み・復元").filter({ visible: true }).first()).toBeVisible();
    await page.goto("/settings/audit?action=reset_company_data");
    await expect(page.getByText("データ全削除").filter({ visible: true }).first()).toBeVisible();
  });
});
