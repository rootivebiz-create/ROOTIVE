/**
 * ロール（§3・§4.6）：viewer は閲覧と CSV のみ、driver は自分の締め済み月の明細のみ
 * 前提：resetToSeed（2026-09 は未締め）。driver のテストの前に RPC で 2026-09 を締める
 */
import { test, expect } from "@playwright/test";
import {
  adminSql,
  countEntries,
  createInvitation,
  driverIdByName,
  listRow,
  loginViaInvite,
  logout,
  projectItemIdByName,
  readState,
  requireState,
  resetToSeed,
  saveScreenshot,
  sessionFor,
  setMonthClosed,
  yen,
} from "./helpers";

test.describe.configure({ mode: "serial" });

test.beforeEach(async () => {
  const state = readState();
  test.skip(!state || state.appSkipped, "E2E_SKIP_APP=1 のため Next.js を起動していません");
});

test.describe("ロール", () => {
  test.beforeAll(async () => {
    const state = readState();
    if (!state || state.appSkipped) return;
    await resetToSeed();
  });

  test("viewer：編集 UI が無く、ユーザー管理に入れず、バックアップ JSON は 403・CSV は 200", async ({ page }, testInfo) => {
    const email = `viewer-${testInfo.project.name}-${Date.now()}@example.com`;
    const token = createInvitation({ email, role: "viewer", displayName: "閲覧者テスト" });
    await loginViaInvite(page, token);
    await expect(page).toHaveURL(/\/dashboard/);
    await expect(page.getByRole("heading", { name: "ダッシュボード" })).toBeVisible();

    // 稼働入力：一覧は見えるが追加・編集・削除・複製・一括入力が無い
    await page.goto("/entries?m=2026-09");
    await expect(page.getByText("2026年9月の稼働行 10 件")).toBeVisible();
    await expect(listRow(page, "相曽慧")).toContainText(yen(483525));
    await expect(page.getByRole("button", { name: "稼働を追加" })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "前月から複製" })).toHaveCount(0);
    await expect(page.getByRole("link", { name: "一括入力" })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "編集" })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "削除" })).toHaveCount(0);
    await page.goto("/entries/bulk?m=2026-09");
    await expect(page.getByText("閲覧のみです。稼働の編集には管理者権限が必要です。")).toBeVisible();

    // 支払明細：管理費・調整の編集ボタンが無い
    const driverId = driverIdByName("相曽慧");
    await page.goto(`/payouts/${driverId}/statement?m=2026-09`);
    await expect(page.getByRole("heading", { name: "相曽慧 様 2026年9月 支払明細" })).toBeVisible();
    await expect(page.getByRole("button", { name: "管理費・調整を編集" })).toHaveCount(0);

    // 設定：ユーザー管理（owner のみ）は /dashboard へ。月締めの操作も出ない
    await page.goto("/settings/users");
    await expect(page).toHaveURL(/\/dashboard/);
    await page.goto("/settings/company");
    await expect(page).toHaveURL(/\/dashboard/);
    await page.goto("/settings");
    await expect(page.getByRole("link", { name: /ユーザー管理/ })).toHaveCount(0);
    await expect(page.getByRole("link", { name: /監査ログ/ })).toHaveCount(0);
    await page.goto("/settings/months");
    await expect(page.getByText("閲覧者は月締めの操作はできません。")).toBeVisible();
    await expect(page.getByRole("button", { name: "この月を締める" })).toHaveCount(0);
    await page.goto("/settings/drivers");
    await expect(page.getByRole("link", { name: "ドライバーを追加" })).toHaveCount(0);

    // 出力：バックアップ JSON は 403、稼働 CSV は 200
    const backup = await page.request.get("/api/export/backup.json");
    expect(backup.status()).toBe(403);
    const csv = await page.request.get("/api/export/entries.csv?m=2026-09");
    expect(csv.status()).toBe(200);
    expect((await csv.text()).replace(/^﻿/, "")).toContain("相曽慧");

    // DB（RLS）でも書き込みは拒否される
    const client = await sessionFor(email);
    const { companyId } = requireState();
    const insert = await client
      .from("work_entries")
      .insert({ company_id: companyId, month: "2026-09-01", driver_id: driverId, project_item_id: projectItemIdByName("三郷Amazon"), qty: 1, bill_rate: 1, pay_rate: 1, royalty_rate: 0.1, rounding_mode: "none" });
    // トリガー（P0001）または RLS（42501）で拒否され、行は増えない
    expect(insert.error).not.toBeNull();
    expect(["42501", "P0001"]).toContain(insert.error?.code);
    expect(countEntries("2026-09")).toBe(10);
    // RLS の update は「エラー」ではなく 0 行更新になる（PostgREST と同じ挙動）。DB の値が変わっていないことを確認する
    const update = await client.from("drivers").update({ mgmt_fee: 0 }).eq("id", driverId).select("id");
    expect(update.error == null ? (update.data ?? []).length : 0).toBe(0);
    expect(adminSql(`select mgmt_fee from public.drivers where id = '${driverId}'`)).toBe("15000.00");

    await logout(page);
    await expect(page).toHaveURL(/\/login/);
  });

  test("driver：締め済みの自分の月だけ見られ、会社側の数字は出ず、スタッフ画面には入れない", async ({ page }, testInfo) => {
    await setMonthClosed("2026-09", true);
    const driverId = driverIdByName("相曽慧");
    const email = `driver-${testInfo.project.name}-${Date.now()}@example.com`;
    const token = createInvitation({ email, role: "driver", displayName: "相曽慧", driverId });
    await loginViaInvite(page, token);
    await expect(page).toHaveURL(/\/driver(\?|$)/);
    await expect(page.getByRole("heading", { name: "支払明細一覧" })).toBeVisible();

    const monthLink = page.getByRole("link", { name: /2026年9月/ });
    await expect(monthLink).toContainText(yen(396643));
    await monthLink.click();
    await expect(page).toHaveURL(/\/driver\/statements\/2026-09/);
    await expect(page.getByRole("heading", { name: "2026年9月 支払明細", level: 1 })).toBeVisible();

    const main = page.locator("main");
    await expect(main).toContainText("お支払額");
    await expect(main).toContainText(yen(396643));
    await expect(main).toContainText("振込予定日：2026年10月31日");
    await expect(main).toContainText("21日 × ¥21,780");
    await expect(main).toContainText(yen(-14999));
    await expect(main).not.toContainText("会社利益");
    await expect(main).not.toContainText("会社売上");
    await expect(main).not.toContainText("単価差額");
    await expect(page.getByRole("link", { name: "PDF をダウンロード" })).toBeVisible();
    if (testInfo.project.name === "mobile") await saveScreenshot(page, "driver-portal-mobile.png");

    // PDF は自分の分だけ 200、他人の分は拒否
    const pdf = await page.request.get(`/api/export/statement.pdf?m=2026-09&driver=${driverId}`);
    expect(pdf.status()).toBe(200);
    expect((await pdf.body()).subarray(0, 4).toString("latin1")).toBe("%PDF");
    const other = await page.request.get(`/api/export/statement.pdf?m=2026-09&driver=${driverIdByName("金島幸太")}`);
    expect(other.status()).toBe(403);
    // 未締めの月は 403（集計中）
    const open = await page.request.get(`/api/export/statement.pdf?m=2026-10&driver=${driverId}`);
    expect(open.status()).toBe(403);
    // スタッフ向けの出力は 403
    const entriesCsv = await page.request.get("/api/export/entries.csv?m=2026-09");
    expect(entriesCsv.status()).toBe(403);

    // スタッフ画面は /driver へ
    await page.goto("/dashboard");
    await expect(page).toHaveURL(/\/driver(\?|$)/);
    await page.goto("/entries?m=2026-09");
    await expect(page).toHaveURL(/\/driver(\?|$)/);
    await page.goto("/settings");
    await expect(page).toHaveURL(/\/driver(\?|$)/);

    // 未締めの月は「集計中」
    await page.goto("/driver/statements/2026-10");
    await expect(page.getByText("集計中")).toBeVisible();

    await logout(page);
    await expect(page).toHaveURL(/\/login/);
  });
});
