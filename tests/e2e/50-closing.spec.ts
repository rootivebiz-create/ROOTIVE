/**
 * 月締め（§4.5-3）：締める → ロック（稼働入力・明細）→ 締め時バックアップ（Storage）→ 解除 → 再度締める
 * 前提：2026-09 が未締めで初期データがあること
 */
import { test, expect } from "@playwright/test";
import { E2E, driverIdByName, listRow, loginViaMagicLink, monthIsClosed, readState, saveScreenshot, seedInitialData, setMonthClosed, toast, yen } from "./helpers";

test.describe.configure({ mode: "serial" });

test.beforeEach(async () => {
  const state = readState();
  test.skip(!state || state.appSkipped, "E2E_SKIP_APP=1 のため Next.js を起動していません");
});

test.describe("月締め", () => {
  let driverId = "";

  test.beforeAll(async () => {
    const state = readState();
    if (!state || state.appSkipped) return;
    await seedInitialData();
    await setMonthClosed("2026-09", false);
    driverId = driverIdByName("相曽慧");
  });

  test.beforeEach(async ({ page }) => {
    await loginViaMagicLink(page, E2E.users.owner.email, "/settings/months");
  });

  test("2026年9月を締めると締め済みバッジ・締め日時・バックアップが表示される", async ({ page }, testInfo) => {
    await expect(page.getByRole("heading", { name: "月締め" })).toBeVisible();
    const row = listRow(page, "2026年9月");
    await expect(row).toContainText("未締め");
    await expect(row).toContainText(yen(2559573));
    await row.getByRole("button", { name: "この月を締める" }).click();

    const dialog = page.getByRole("dialog");
    await expect(dialog.getByRole("heading", { name: "2026年9月 を締める" })).toBeVisible();
    await expect(dialog).toContainText(yen(2559573));
    await expect(dialog).toContainText(yen(1907083));
    await dialog.getByLabel("メモ（任意）").fill("E2E テスト");
    await dialog.getByRole("button", { name: "この月を締める" }).click();

    await expect(toast(page, "2026年9月 を締めました。")).toBeVisible();
    await expect(toast(page, "バックアップの保存に失敗")).toHaveCount(0);
    await expect(row).toContainText("締め済み");
    await expect(row).toContainText(/\d{4}\/\d{2}\/\d{2} \d{2}:\d{2}/);
    await expect(row).toContainText("E2E テスト");
    await expect(row.getByRole("link", { name: /2026年9月 の締め時バックアップをダウンロード/ })).toBeVisible();
    await expect(row.getByRole("button", { name: "締めを解除" })).toBeVisible();
    await expect(row.getByRole("button", { name: "この月を締める" })).toHaveCount(0);
    expect(monthIsClosed("2026-09")).toBe(true);
    if (testInfo.project.name === "mobile") await saveScreenshot(page, "closing-months-mobile.png");
  });

  test("締め済み月の稼働入力には「稼働を追加」が無く、締め済みバッジが出る", async ({ page }) => {
    await page.goto("/entries?m=2026-09");
    await expect(page.getByText("2026年9月の稼働行 10 件")).toBeVisible();
    await expect(page.getByText("締め済み").first()).toBeVisible();
    await expect(page.getByRole("button", { name: "稼働を追加" })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "前月から複製" })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "編集" })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "削除" })).toHaveCount(0);
    await page.goto("/entries/bulk?m=2026-09");
    await expect(page.getByText("締め済み").first()).toBeVisible();
    await page.getByLabel("案件（内容）").selectOption({ label: "三郷Amazon" });
    await expect(page.getByLabel("相曽慧の稼働日数")).toBeDisabled();
  });

  test("締め済み月の支払明細には編集ボタンが無い", async ({ page }) => {
    await page.goto(`/payouts/${driverId}/statement?m=2026-09`);
    await expect(page.getByRole("heading", { name: "相曽慧 様 2026年9月 支払明細" })).toBeVisible();
    await expect(page.getByText("この月は締め済みです。管理費・調整は変更できません。")).toBeVisible();
    await expect(page.getByRole("button", { name: "管理費・調整を編集" })).toHaveCount(0);
    await expect(page.getByRole("button", { name: /に戻す/ })).toHaveCount(0);
  });

  test("データ画面の締め時バックアップ一覧に 2026年9月 が出て、JSON をダウンロードできる", async ({ page }) => {
    await page.goto("/settings/data");
    await expect(page.getByRole("heading", { name: "締め時バックアップ" })).toBeVisible();
    await expect(page.getByRole("link", { name: "2026年9月 の締め時バックアップをダウンロード" })).toBeVisible();

    // /api/export/month-backup → Storage の署名付き URL へ 302 → JSON
    const res = await page.request.get("/api/export/month-backup?m=2026-09");
    expect(res.status()).toBe(200);
    const json = JSON.parse(await res.text()) as Record<string, unknown>;
    expect(json.app).toBe("rootive-profit");
    // 0019 でバックアップは version 6（運行管理・採用と契約・財務・支払通知・代表まで含む）
    expect(json.version).toBe(6);
    expect(Array.isArray(json.expenses)).toBe(true);
    expect(Array.isArray(json.clients)).toBe(true);
    expect(Array.isArray(json.invoices)).toBe(true);
    expect(Array.isArray(json.month_targets)).toBe(true);
    expect(Array.isArray(json.cash_snapshots)).toBe(true);
    expect(Array.isArray(json.daily_reports)).toBe(true);
    expect(Array.isArray(json.contracts)).toBe(true);
    expect(Array.isArray(json.payment_notices)).toBe(true);
    expect(Array.isArray(json.drivers)).toBe(true);
    expect((json.drivers as unknown[]).length).toBeGreaterThanOrEqual(10);
    expect(Array.isArray(json.work_entries)).toBe(true);
    expect((json.work_entries as unknown[]).length).toBeGreaterThanOrEqual(10);
    const closings = json.month_closings as { month: string; status: string; note: string }[];
    expect(closings.some((m) => m.month === "2026-09-01" && m.status === "closed" && m.note === "E2E テスト")).toBe(true);

    // 無い月は 404
    const missing = await page.request.get("/api/export/month-backup?m=2020-01");
    expect(missing.status()).toBe(404);
  });

  test("締めを解除（owner）すると追加ボタンが戻り、再度締められる", async ({ page }) => {
    const row = listRow(page, "2026年9月");
    await row.getByRole("button", { name: "締めを解除" }).click();
    const dialog = page.getByRole("dialog");
    await expect(dialog.getByRole("heading", { name: "2026年9月 の締めを解除" })).toBeVisible();
    await dialog.getByRole("button", { name: "締めを解除する" }).click();
    await expect(toast(page, "2026年9月 の締めを解除しました。")).toBeVisible();
    await expect(row).toContainText("未締め");
    expect(monthIsClosed("2026-09")).toBe(false);

    await page.goto("/entries?m=2026-09");
    await expect(page.getByRole("button", { name: "稼働を追加" })).toBeVisible();

    // 再度締める（次のドライバーロールのテスト用）
    await page.goto("/settings/months");
    await listRow(page, "2026年9月").getByRole("button", { name: "この月を締める" }).click();
    await page.getByRole("dialog").getByRole("button", { name: "この月を締める" }).click();
    await expect(toast(page, "2026年9月 を締めました。")).toBeVisible();
    await expect(listRow(page, "2026年9月")).toContainText("締め済み");
    expect(monthIsClosed("2026-09")).toBe(true);

    // 監査ログに月締め・締め解除が残る
    await page.goto("/settings/audit?table=month_closings");
    await expect(listRow(page, /締め解除/).first()).toContainText("2026年9月");
    await expect(listRow(page, /月締め/).first()).toContainText("2026年9月");
  });
});
