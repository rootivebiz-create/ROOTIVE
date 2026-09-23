/**
 * 設定（§4.5）：ドライバー・案件・会社設定・ユーザー管理（招待）・監査ログ
 * 前提：初期データがあること（seedInitialData は冪等）。テスト用に作るマスタは事前に消しておく
 */
import { test, expect } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";
import { E2E, ROOT_DIR, adminSql, driverIdByName, listRow, loginViaMagicLink, projectItemIdByName, readState, requireState, saveScreenshot, seedInitialData, setMonthClosed, toast, yen } from "./helpers";

test.describe.configure({ mode: "serial" });

const DRIVER_NAME = "テスト太郎";
const PROJECT_NAME = "テスト案件";

test.beforeEach(async () => {
  const state = readState();
  test.skip(!state || state.appSkipped, "E2E_SKIP_APP=1 のため Next.js を起動していません");
});

test.describe("設定", () => {
  test.beforeAll(async () => {
    const state = readState();
    if (!state || state.appSkipped) return;
    await seedInitialData();
    const { companyId } = requireState();
    // 同名マスタが残っていれば削除（名前は会社内で一意）
    adminSql(
      `delete from public.driver_pay_overrides where driver_id in (select id from public.drivers where company_id = '${companyId}' and name = '${DRIVER_NAME}');
       delete from public.driver_months where company_id = '${companyId}' and driver_id in (select id from public.drivers where company_id = '${companyId}' and name = '${DRIVER_NAME}');
       delete from public.drivers where company_id = '${companyId}' and name = '${DRIVER_NAME}';
       delete from public.project_items where project_id in (select id from public.projects where company_id = '${companyId}' and name = '${PROJECT_NAME}');
       delete from public.projects where company_id = '${companyId}' and name = '${PROJECT_NAME}';`,
    );
  });

  test.beforeEach(async ({ page }) => {
    await loginViaMagicLink(page, E2E.users.owner.email, "/settings/drivers");
  });

  test("ドライバーを追加（率 10%・管理費 15,000）→ 一覧に出る → 編集で停止中にする", async ({ page }, testInfo) => {
    await expect(page.getByRole("heading", { name: "ドライバー" })).toBeVisible();
    await expect(page.getByText(/全 10 名/)).toBeVisible();
    await page.getByRole("link", { name: "ドライバーを追加" }).click();
    await expect(page.getByRole("heading", { name: "ドライバーを追加" })).toBeVisible();

    await page.getByLabel("名前（必須）").fill(DRIVER_NAME);
    await page.getByLabel("かな").fill("てすと たろう");
    // ロイヤリティ率：会社設定に従う → 個別に 10%
    const follow = page.getByRole("checkbox", { name: /^会社設定に従う/ });
    await expect(follow).toBeChecked();
    await follow.click();
    await expect(follow).not.toBeChecked();
    await page.getByLabel("ロイヤリティ率", { exact: true }).fill("10");
    await page.getByLabel("管理費（月額）").fill("15000");
    await page.getByRole("button", { name: "登録する" }).click();
    await expect(toast(page, /保存しました|登録しました/)).toBeVisible();
    await expect(page).toHaveURL(/\/settings\/drivers(\?|$)/);

    await expect(page.getByText(/全 11 名/)).toBeVisible();
    const row = listRow(page, DRIVER_NAME);
    await expect(row).toContainText("稼働中");
    await expect(row).toContainText("10.0%");
    await expect(row).toContainText(yen(15000));
    if (testInfo.project.name === "mobile") await saveScreenshot(page, "settings-drivers-mobile.png");

    // 編集：停止中にする
    await page.getByRole("link", { name: DRIVER_NAME, exact: true }).click();
    await expect(page.getByRole("heading", { name: DRIVER_NAME })).toBeVisible();
    await expect(page.getByLabel("名前（必須）")).toHaveValue(DRIVER_NAME);
    const active = page.getByRole("switch", { name: "状態" });
    await expect(active).toBeChecked();
    await active.click();
    await expect(active).not.toBeChecked();
    await expect(page.getByText("停止中（稼働入力の候補に表示しない）")).toBeVisible();
    await page.getByRole("button", { name: "保存する" }).click();
    await expect(toast(page, /保存しました/)).toBeVisible();
    await expect(page).toHaveURL(/\/settings\/drivers(\?|$)/);
    await expect(listRow(page, DRIVER_NAME)).toContainText("停止中");
    await expect(page.getByText(/稼働中 10 名／全 11 名/)).toBeVisible();
  });

  test("案件を追加（内容 2 つ：日給と個数）→ 一覧に出る", async ({ page }) => {
    await page.goto("/settings/projects");
    await expect(page.getByRole("heading", { name: "案件・単価" })).toBeVisible();
    await page.getByRole("link", { name: "案件を追加" }).click();
    await expect(page.getByRole("heading", { name: "案件を追加" })).toBeVisible();

    await page.getByLabel("案件名（必須）").fill(PROJECT_NAME);
    // 取引先はセレクト（0009）。この時点では取引先マスタが空なので「未設定」のまま登録する
    await expect(page.getByLabel("取引先")).toHaveValue("");
    // 内容 1：配送A（日給 10,000／9,000）
    await page.getByLabel("内容名").nth(0).fill("配送A");
    await page.getByLabel("区分").nth(0).selectOption("day");
    await page.getByLabel("受注単価").nth(0).fill("10000");
    await page.getByLabel("支払単価").nth(0).fill("9000");
    await expect(page.getByText(`差額 ${yen(1000)}`)).toBeVisible();
    // 内容 2：配送B（個数 200／180）
    await page.getByRole("button", { name: "内容を追加" }).click();
    await page.getByLabel("内容名").nth(1).fill("配送B");
    await page.getByLabel("区分").nth(1).selectOption("piece");
    await page.getByLabel("受注単価").nth(1).fill("200");
    await page.getByLabel("支払単価").nth(1).fill("180");
    await page.getByRole("button", { name: "登録する" }).click();
    await expect(toast(page, /保存しました|登録しました/)).toBeVisible();
    await expect(page).toHaveURL(/\/settings\/projects(\?|$)/);

    await expect(page.getByText(/全 8 件/)).toBeVisible();
    await expect(page.getByText(PROJECT_NAME).filter({ visible: true })).toHaveCount(1);
    await expect(page.getByText("配送A").filter({ visible: true })).toHaveCount(1);
    await expect(page.getByText("配送B").filter({ visible: true })).toHaveCount(1);
  });

  test("会社設定：住所を入力して保存すると再表示で保持される", async ({ page }) => {
    await page.goto("/settings/company");
    await expect(page.getByRole("heading", { name: "会社設定" })).toBeVisible();
    await expect(page.getByLabel("会社名")).toHaveValue(E2E.companyName);
    const address = "埼玉県三郷市テスト1-2-3";
    await page.getByLabel("住所").fill(address);
    await page.getByLabel("電話番号").fill("048-000-0000");
    await page.getByRole("button", { name: "保存" }).first().click();
    await expect(toast(page, "会社設定を保存しました。")).toBeVisible();

    await page.reload();
    await expect(page.getByLabel("住所")).toHaveValue(address);
    await expect(page.getByLabel("電話番号")).toHaveValue("048-000-0000");
    // 印刷用の明細にも反映される
    const { companyId } = requireState();
    const driverId = adminSql(`select id from public.drivers where company_id = '${companyId}' and name = '相曽慧'`);
    await page.goto(`/payouts/${driverId}/print?m=2026-09`);
    await expect(page.locator("article")).toContainText(address);
  });

  test("ユーザー管理：閲覧者を招待すると招待リンク（/invite/）が表示される", async ({ page }, testInfo) => {
    const email = `viewer-invite-${testInfo.project.name}-${Date.now()}@example.com`;
    await page.goto("/settings/users");
    await expect(page.getByRole("heading", { name: "ユーザー管理" })).toBeVisible();
    await page.getByRole("button", { name: "ユーザーを招待" }).click();
    const dialog = page.getByRole("dialog");
    await expect(dialog.getByRole("heading", { name: "ユーザーを招待" })).toBeVisible();
    await dialog.getByLabel("メールアドレス").fill(email);
    await dialog.getByLabel("ロール").selectOption("viewer");
    await expect(dialog.getByText("閲覧と出力のみ（編集はできない）")).toBeVisible();
    await dialog.getByLabel("表示名（任意）").fill("閲覧テスト");
    const send = dialog.getByRole("checkbox", { name: "招待メールも送る" });
    await expect(send).toBeChecked();
    await send.click();
    await expect(send).not.toBeChecked();
    await dialog.getByRole("button", { name: "招待する" }).click();
    await expect(toast(page, "招待を作成しました。")).toBeVisible();

    const result = page.getByRole("dialog");
    await expect(result.getByRole("heading", { name: "招待リンクを発行しました" })).toBeVisible();
    const link = result.getByLabel("招待リンク");
    await expect(link).toHaveValue(/\/invite\/[0-9a-f]{32,128}$/);
    const inviteUrl = await link.inputValue();
    expect(inviteUrl.startsWith(readState()?.appUrl ?? "")).toBe(true);
    // 「閉じる」はフッターのボタンと右上の × （aria-label）の 2 つあるので、文字を持つ方を押す
    await result.getByRole("button", { name: "閉じる" }).filter({ hasText: "閉じる" }).click();

    const row = listRow(page, email);
    await expect(row).toContainText("閲覧者");
    await expect(row).toContainText("未受諾");
  });

  test("監査ログに drivers の INSERT（テスト太郎）が記録される", async ({ page }) => {
    await page.goto("/settings/audit?table=drivers&action=INSERT");
    await expect(page.getByRole("heading", { name: "監査ログ" })).toBeVisible();
    await expect(page.getByLabel("テーブル")).toHaveValue("drivers");
    await expect(page.getByLabel("操作")).toHaveValue("INSERT");
    // 監査ログはデータ全削除でも消えないため、以前の実行分がある場合は最新（先頭）を見る
    const row = listRow(page, DRIVER_NAME).first();
    await expect(row).toContainText("追加");
    await expect(row).toContainText("ドライバー");
    await expect(row).toContainText("オーナー");
    // UPDATE（停止中への変更）も記録されている
    await page.goto("/settings/audit?table=drivers&action=UPDATE");
    const upd = listRow(page, DRIVER_NAME).first();
    await expect(upd).toContainText("更新");
    await expect(upd).toContainText("状態");
  });
  test("ドライバー別単価：黒岩亜夢莉の三郷Amazon 受注 23,500 → 稼働入力の「マスタの値に更新」→ 単価表の「稼働に反映」→ 単価表 CSV", async ({ page }, testInfo) => {
    await setMonthClosed("2026-09", false);
    const driverId = driverIdByName("黒岩亜夢莉");
    const itemId = projectItemIdByName("三郷Amazon");
    const { companyId } = requireState();
    const billRateInDb = () =>
      adminSql(`select bill_rate from public.work_entries where company_id = '${companyId}' and month = '2026-09-01' and driver_id = '${driverId}' and project_item_id = '${itemId}'`);
    const cleanup = () =>
      adminSql(
        `delete from public.driver_pay_overrides where driver_id = '${driverId}' and project_item_id = '${itemId}';
         update public.work_entries set bill_rate = 23025 where company_id = '${companyId}' and month = '2026-09-01' and driver_id = '${driverId}' and project_item_id = '${itemId}';`,
      );
    cleanup();
    try {
      // 単価表（ドライバーごと）で受注単価だけ個別に設定
      await page.goto(`/settings/rates?m=2026-09&driver=${driverId}`);
      await expect(page.getByRole("heading", { name: "ドライバー別単価" })).toBeVisible();
      await expect(page.getByRole("tab", { name: "ドライバーごと" })).toHaveAttribute("aria-selected", "true");
      await expect(page.getByLabel("ドライバー", { exact: true })).toHaveValue(driverId);
      const bill = page.getByLabel("三郷Amazon の受注単価");
      await expect(bill).toHaveAttribute("placeholder", "23,025");
      await expect(page.getByRole("button", { name: "保存する" })).toBeDisabled();
      await bill.fill("23500");
      await expect(page.getByText("変更 1 行")).toBeVisible();
      await page.getByRole("button", { name: "保存する" }).click();
      await expect(toast(page, "単価を保存しました")).toBeVisible();
      await expect(page.getByText("個別", { exact: true }).first()).toBeVisible();
      // 当月の稼働行（黒岩亜夢莉 三郷Amazon 21 日）が古い単価のまま → バナー
      const banner = page.getByRole("alert").filter({ hasText: "2026年9月 の稼働 1 行が現在の単価・率と異なります" });
      await expect(banner).toBeVisible();
      await expect(banner).toContainText("受注 ¥23,025 → ¥23,500");
      if (testInfo.project.name === "mobile") await saveScreenshot(page, "rates-mobile.png");

      // ダッシュボードの警告
      await page.goto("/dashboard?m=2026-09");
      await expect(page.getByText("単価・率が現在の設定と異なる稼働行が 1 件あります")).toBeVisible();

      // 稼働入力：バナー → 「マスタの値に更新」（行を選んで更新）
      await page.goto("/entries?m=2026-09");
      await expect(page.getByTestId("rate-diff-banner")).toContainText("単価・率が現在の設定と異なる稼働行が 1 件あります");
      await expect(page.getByText("単価変更あり").filter({ visible: true }).first()).toBeVisible();
      await page.getByRole("button", { name: "マスタの値に更新" }).click();
      const dialog = page.getByRole("dialog");
      await expect(dialog.getByRole("heading", { name: "マスタの値に更新" })).toBeVisible();
      const check = dialog.getByRole("checkbox", { name: "黒岩亜夢莉／三郷Amazon" });
      await expect(check).toBeChecked();
      await expect(dialog).toContainText("受注 ¥23,025 → ¥23,500");
      await dialog.getByRole("button", { name: "1 行を更新する" }).click();
      await expect(toast(page, /1 行の単価・率をマスタの値に更新しました/)).toBeVisible();
      await expect(page.getByTestId("rate-diff-banner")).toHaveCount(0);
      expect(Number(billRateInDb())).toBe(23500);

      // 単価表：もう一度変更（23,600）→ 「稼働に反映」
      await page.goto(`/settings/rates?m=2026-09&driver=${driverId}`);
      await expect(page.getByLabel("三郷Amazon の受注単価")).toHaveValue("23500");
      await page.getByLabel("三郷Amazon の受注単価").fill("23600");
      await page.getByRole("button", { name: "保存する" }).click();
      await expect(toast(page, "単価を保存しました")).toBeVisible();
      await expect(page.getByRole("alert").filter({ hasText: "2026年9月 の稼働 1 行が現在の単価・率と異なります" })).toBeVisible();
      await page.getByRole("button", { name: /の稼働に反映$/ }).click();
      const confirm = page.getByRole("dialog");
      await expect(confirm.getByRole("heading", { name: "2026年9月 の稼働に反映しますか？" })).toBeVisible();
      await confirm.getByRole("button", { name: "反映する" }).click();
      await expect(toast(page, /1 行の単価・率をマスタの値に更新しました/)).toBeVisible();
      await expect(page.getByRole("alert").filter({ hasText: "現在の単価・率と異なります" })).toHaveCount(0);
      expect(Number(billRateInDb())).toBe(23600);

      // 案件ごとの見方でも同じ値が見える
      await page.getByRole("tab", { name: "案件ごと" }).click();
      await page.getByLabel("案件内容").selectOption(itemId);
      await expect(page.getByLabel("黒岩亜夢莉 の受注単価")).toHaveValue("23600");
      await expect(page.getByLabel("黒岩亜夢莉 の支払単価")).toHaveAttribute("placeholder", "21,780");

      // 単価表 CSV（実効単価と出所）
      const csv = await page.request.get("/api/export/rates.csv");
      expect(csv.status()).toBe(200);
      const text = (await csv.body()).toString("utf8").replace(/^﻿/, "");
      expect(text).toContain("ドライバー,案件,内容,区分,受注単価,支払単価,差額,受注単価の出所,支払単価の出所,個別受注単価,個別支払単価");
      expect(text).toMatch(/^黒岩亜夢莉,三郷Amazon,標準,日給,23600,21780,1820,個別,標準,23600,$/m);
      expect(text).toMatch(/^相曽慧,三郷Amazon,標準,日給,23025,21780,1245,標準,標準,,$/m);
    } finally {
      cleanup();
    }
  });
  test("会社設定：消費税（税率 8%・四捨五入）を保存すると明細の消費税が変わる → 10%・切り捨てに戻す", async ({ page }) => {
    await setMonthClosed("2026-09", false);
    const driverId = driverIdByName("相曽慧");
    const { companyId } = requireState();
    const restore = () => adminSql(`update public.companies set tax_rate = 0.10, tax_rounding = 'floor' where id = '${companyId}'`);
    restore();
    try {
      await page.goto("/settings/company");
      await expect(page.getByRole("heading", { name: "消費税" })).toBeVisible();
      await expect(page.getByLabel("消費税率（%）")).toHaveValue("10");
      await page.getByLabel("消費税率（%）").fill("8");
      await page.getByLabel("消費税額の端数処理").selectOption("round");
      await page.getByRole("button", { name: "保存", exact: true }).first().click();
      await expect(toast(page, "会社設定を保存しました")).toBeVisible();
      // 相曽慧：税抜小計 396,643 × 8% = 31,731.44 → 四捨五入 31,731 → 税込 428,374
      await page.goto(`/payouts/${driverId}/statement?m=2026-09`);
      await expect(page.getByText("消費税（8%）")).toBeVisible();
      await expect(page.getByText(yen(31731)).first()).toBeVisible();
      await expect(page.locator("section").filter({ hasText: "お支払額" }).first()).toContainText(yen(428374));
    } finally {
      restore();
    }
  });

  test("会社設定：ロゴをアップロード → /api/company-asset/logo が画像を返す → 印刷用ページに表示 → 削除", async ({ page }) => {
    const { companyId } = requireState();
    const driverId = driverIdByName("相曽慧");
    adminSql(`update public.companies set logo_path = null, seal_path = null where id = '${companyId}'`);
    await page.goto("/settings/company");
    await expect(page.getByRole("heading", { name: "ロゴ・認印" })).toBeVisible();
    expect((await page.request.get("/api/company-asset/logo")).status()).toBe(404);

    await page.getByLabel("ロゴの画像ファイル").setInputFiles(path.join(ROOT_DIR, "public/icons/icon-192.png"));
    await page.getByRole("button", { name: "ロゴをアップロード" }).click();
    await expect(toast(page, "画像を保存しました")).toBeVisible();
    await expect(page.getByRole("img", { name: "ロゴ" })).toBeVisible();

    const res = await page.request.get("/api/company-asset/logo");
    expect(res.status()).toBe(200);
    expect(res.headers()["content-type"]).toContain("image/png");
    expect((await res.body()).length).toBe(fs.statSync(path.join(ROOT_DIR, "public/icons/icon-192.png")).size); // アップロードした画像そのもの
    expect(adminSql(`select logo_path from public.companies where id = '${companyId}'`)).toMatch(new RegExp(`^${companyId}/logo-.*\\.png$`));

    // 印刷用ページと PDF にロゴが入る
    await page.goto(`/payouts/${driverId}/print?m=2026-09`);
    await expect(page.locator("article img[src^='/api/company-asset/logo']")).toBeVisible();
    const pdf = await page.request.get(`/api/export/statement.pdf?m=2026-09&driver=${driverId}`);
    expect(pdf.status()).toBe(200);
    expect((await pdf.body()).length).toBeGreaterThan(10 * 1024);

    // 削除
    await page.goto("/settings/company");
    await page.getByRole("button", { name: "ロゴを削除" }).click();
    const dialog = page.getByRole("dialog");
    await dialog.getByRole("button", { name: "削除する" }).click();
    await expect(toast(page, "画像を削除しました")).toBeVisible();
    expect((await page.request.get("/api/company-asset/logo")).status()).toBe(404);
    expect(adminSql(`select coalesce(logo_path, '') from public.companies where id = '${companyId}'`)).toBe("");
  });

  test("ドライバー設定：黒岩亜夢莉の振込予定日を翌々月 15 日にすると明細の振込予定日が変わる → 会社設定に戻す", async ({ page }) => {
    await setMonthClosed("2026-09", false);
    const driverId = driverIdByName("黒岩亜夢莉");
    const restore = () => adminSql(`update public.drivers set payout_month_offset = null, payout_day = null, tax_mode = 'taxable' where id = '${driverId}'`);
    restore();
    try {
      await page.goto(`/settings/drivers/${driverId}`);
      await expect(page.getByRole("heading", { name: "消費税・支払日" })).toBeVisible();
      await expect(page.getByLabel("課税区分")).toHaveValue("taxable");
      const follow = page.getByRole("checkbox", { name: /振込予定日は会社設定に従う/ });
      await expect(follow).toBeChecked();
      await follow.click();
      await page.getByLabel("支払月").selectOption("2");
      await page.getByLabel("支払日", { exact: true }).selectOption("15");
      await page.getByRole("button", { name: "保存する" }).click();
      await expect(toast(page, /保存しました/)).toBeVisible();
      expect(adminSql(`select payout_month_offset || '/' || payout_day from public.drivers where id = '${driverId}'`)).toBe("2/15");

      await page.goto(`/payouts/${driverId}/statement?m=2026-09`);
      await expect(page.locator("section").filter({ hasText: "お支払額" }).first()).toContainText("振込予定日：2026年11月15日");
      // 他のドライバーは会社設定（翌月末）のまま
      await page.goto(`/payouts/${driverIdByName("相曽慧")}/statement?m=2026-09`);
      await expect(page.locator("section").filter({ hasText: "お支払額" }).first()).toContainText("振込予定日：2026年10月31日");
    } finally {
      restore();
    }
  });
});
