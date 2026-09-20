/**
 * 法人の経営管理（0014）と出力の刷新
 *   - 財務 /finance：年間予算と予実・借入金と返済予定・決算と税務カレンダー
 *   - 出力センター /exports と Excel・月次パック・経営レポート
 *   - 振込データ /payouts/transfer（全銀フォーマット）
 * 前提：§8.6 の初期データ（resetToSeed）。テストは順番に依存するため serial
 */
import { test, expect } from "@playwright/test";
import { E2E, adminSql, driverIdByName, listRow, loginViaMagicLink, readState, requireState, resetToSeed, saveScreenshot, setMonthClosed, toast } from "./helpers";

test.describe.configure({ mode: "serial" });

const MONTH = "2026-09";
const YEAR = 2026;

function clearFinance(): void {
  const { companyId } = requireState();
  adminSql(
    `delete from public.loan_payments where company_id = '${companyId}';
     delete from public.loans where company_id = '${companyId}';
     delete from public.tax_tasks where company_id = '${companyId}';
     delete from public.month_targets where company_id = '${companyId}';`,
  );
}

test.beforeEach(async () => {
  const state = readState();
  test.skip(!state || state.appSkipped, "E2E_SKIP_APP=1 のため Next.js を起動していません");
});

test.describe("財務（予算・借入・税務）", () => {
  test.beforeAll(async () => {
    const state = readState();
    if (!state || state.appSkipped) return;
    await resetToSeed();
    await setMonthClosed(MONTH, false);
    clearFinance();
  });

  test.afterAll(async () => {
    const state = readState();
    if (!state || state.appSkipped) return;
    clearFinance();
  });

  test("年間予算を入力して保存すると、予実に実績と達成率が出る", async ({ page }, testInfo) => {
    const { companyId } = requireState();
    await loginViaMagicLink(page, E2E.users.owner.email, `/finance?y=${YEAR}`);
    await expect(page.getByRole("heading", { name: "財務" })).toBeVisible();

    // 9 月の売上目標を入れて保存する
    const target = page.getByLabel("2026年9月の売上の目標");
    await target.fill("2000000");
    await page.getByRole("button", { name: /まとめて保存/ }).click();
    await expect(toast(page, /保存しました/)).toBeVisible();
    expect(adminSql(`select bill_target::bigint from public.month_targets where company_id = '${companyId}' and month = '2026-09-01';`)).toMatch(/2000000/);

    // 実績（2,559,573）と達成率（128.0%）が出る
    await expect(listRow(page, "年間合計").first()).toContainText("2,559,573");
    await expect(listRow(page, "年間合計").first()).toContainText("128.0%");
    if (testInfo.project.name === "mobile") await saveScreenshot(page, "finance-budget-mobile.png");
  });

  test("借入を登録すると返済予定が作られ、資金繰りに載る", async ({ page }, testInfo) => {
    const { companyId } = requireState();
    await loginViaMagicLink(page, E2E.users.owner.email, `/finance?tab=loans`);
    await expect(page.getByRole("heading", { name: "財務" })).toBeVisible();

    await page.getByRole("button", { name: /借入を追加/ }).click();
    const dialog = page.getByRole("dialog");
    await dialog.getByLabel("借入の名前").fill("運転資金");
    await dialog.getByLabel("借入先").fill("日本政策金融公庫");
    await dialog.getByLabel("借入額（円）").fill("3000000");
    await dialog.getByLabel("年利（%）").fill("1.8");
    await dialog.getByLabel("借入日").fill("2026-09-01");
    await dialog.getByLabel("返済回数（か月）").fill("60");
    await dialog.getByRole("button", { name: /登録する|保存/ }).first().click();
    await expect(toast(page, /保存しました|登録しました/)).toBeVisible();

    // 返済予定が 60 回ぶん作られ、元金の合計が借入額と一致する
    expect(adminSql(`select count(*) from public.loan_payments where company_id = '${companyId}';`)).toMatch(/\b60\b/);
    expect(adminSql(`select sum(principal)::bigint from public.loan_payments where company_id = '${companyId}';`)).toMatch(/3000000/);
    await expect(page.getByText("運転資金").filter({ visible: true }).first()).toBeVisible();
    if (testInfo.project.name === "mobile") await saveScreenshot(page, "finance-loans-mobile.png");

    // 資金繰りに返済が載る
    await page.goto(`${E2E.appUrl}/cashflow`);
    await expect(page.getByRole("heading", { name: "資金繰り" })).toBeVisible();
  });

  test("決算月から税務の期限をまとめて作れる", async ({ page }, testInfo) => {
    const { companyId } = requireState();
    await loginViaMagicLink(page, E2E.users.owner.email, `/finance?tab=tax&y=2027`);
    await page.getByRole("button", { name: /まとめて作る/ }).click();
    await expect(toast(page, /作成|件|保存/)).toBeVisible();
    expect(adminSql(`select count(*) >= 10 from public.tax_tasks where company_id = '${companyId}';`)).toMatch(/\bt\b/);
    await expect(page.getByText(/税理士/)).toBeVisible();
    if (testInfo.project.name === "mobile") await saveScreenshot(page, "finance-tax-mobile.png");
  });

  test("閲覧者は財務を見られるが編集できない", async ({ page }) => {
    await loginViaMagicLink(page, E2E.users.viewer.email, `/finance?tab=loans`);
    await expect(page.getByRole("heading", { name: "財務" })).toBeVisible();
    await expect(page.getByRole("button", { name: /借入を追加/ })).toHaveCount(0);
  });
});

test.describe("出力センターと Excel・月次パック", () => {
  test.beforeAll(async () => {
    const state = readState();
    if (!state || state.appSkipped) return;
    await resetToSeed();
    await setMonthClosed(MONTH, false);
  });

  test("出力センターに分類ごとのカードが並ぶ", async ({ page }, testInfo) => {
    await loginViaMagicLink(page, E2E.users.owner.email, `/exports?m=${MONTH}`);
    await expect(page.getByRole("heading", { name: "出力", exact: true })).toBeVisible();
    for (const name of ["支払", "請求", "会計", "分析", "記録", "バックアップ"]) {
      await expect(page.getByRole("heading", { name, exact: true })).toBeVisible();
    }
    if (testInfo.project.name === "mobile") await saveScreenshot(page, "exports-mobile.png");
  });

  test("Excel（.xlsx）をダウンロードできる", async ({ page }) => {
    await loginViaMagicLink(page, E2E.users.owner.email, `/payouts?m=${MONTH}`);
    const res = await page.request.get(`${E2E.appUrl}/api/export/payouts.xlsx?m=${MONTH}`);
    expect(res.status()).toBe(200);
    expect(res.headers()["content-type"]).toContain("spreadsheetml");
    const body = await res.body();
    // ZIP（PK\x03\x04）で始まり、xl/worksheets/sheet1.xml を含む
    expect(body.subarray(0, 2).toString("latin1")).toBe("PK");
    expect(body.toString("latin1")).toContain("xl/worksheets/sheet1.xml");
    expect(body.byteLength).toBeGreaterThan(1000);
  });

  test("月次の経営レポート PDF を取得できる", async ({ page }) => {
    await loginViaMagicLink(page, E2E.users.owner.email, `/exports?m=${MONTH}`);
    const res = await page.request.get(`${E2E.appUrl}/api/export/month-report.pdf?m=${MONTH}`);
    expect(res.status()).toBe(200);
    expect(res.headers()["content-type"]).toContain("application/pdf");
    const body = await res.body();
    expect(body.subarray(0, 5).toString("latin1")).toBe("%PDF-");
    expect(body.byteLength).toBeGreaterThan(5000);
  });

  test("月次パック ZIP に明細・CSV・レポートが入る", async ({ page }) => {
    await loginViaMagicLink(page, E2E.users.owner.email, `/exports?m=${MONTH}`);
    const res = await page.request.get(`${E2E.appUrl}/api/export/month-pack.zip?m=${MONTH}&parts=csv,report`);
    expect(res.status()).toBe(200);
    const body = await res.body();
    expect(body.subarray(0, 2).toString("latin1")).toBe("PK");
    const text = body.toString("latin1");
    expect(text).toContain("README.txt");
    expect(body.byteLength).toBeGreaterThan(5000);
  });
});

test.describe("振込データ（全銀）", () => {
  test.beforeAll(async () => {
    const state = readState();
    if (!state || state.appSkipped) return;
    await resetToSeed();
    await setMonthClosed(MONTH, false);
  });

  test("口座が未登録だと警告が出て、登録すると全銀データを作れる", async ({ page }, testInfo) => {
    const { companyId } = requireState();
    await loginViaMagicLink(page, E2E.users.owner.email, `/payouts/transfer?m=${MONTH}`);
    await expect(page.getByRole("heading", { name: /振込/ }).first()).toBeVisible();
    await expect(page.getByText(/口座/).first()).toBeVisible();

    // 会社の振込元とドライバーの口座を入れる
    adminSql(
      `update public.companies set fb_consignor_code = '1234567890', fb_consignor_kana = 'ｶ)ﾙｰﾃｨﾌﾞ', fb_bank_code = '0005',
              fb_bank_name = '三菱UFJ銀行', fb_branch_code = '001', fb_branch_name = '本店', fb_account_type = 'ordinary', fb_account_number = '7654321'
        where id = '${companyId}';
       insert into public.driver_bank_accounts
         (driver_id, company_id, bank_code, bank_name, branch_code, branch_name, account_type, account_number, account_holder_kana)
       values ('${driverIdByName("相曽慧")}', '${companyId}', '0005', '三菱UFJ銀行', '001', '本店', 'ordinary', '1234567', 'ｱｲｿ ｻﾄｼ')
       on conflict (driver_id) do update set bank_code = excluded.bank_code, bank_name = excluded.bank_name,
              branch_code = excluded.branch_code, branch_name = excluded.branch_name, account_type = excluded.account_type,
              account_number = excluded.account_number, account_holder_kana = excluded.account_holder_kana;`,
    );

    await page.reload();
    const res = await page.request.get(`${E2E.appUrl}/api/export/transfer.txt?m=${MONTH}`);
    expect(res.status(), await res.text()).toBe(200);
    const body = await res.body();
    // 全銀は 120 バイト固定長 ＋ CRLF
    expect(body.byteLength % 122).toBe(0);
    expect(body.subarray(0, 2).toString("latin1")).toBe("12"); // データ区分 1（ヘッダ）＋ 種別コード 21 の先頭
    if (testInfo.project.name === "mobile") await saveScreenshot(page, "transfer-mobile.png");
  });

  test("閲覧者は振込データを開けない", async ({ page }) => {
    await loginViaMagicLink(page, E2E.users.viewer.email, "/dashboard");
    const res = await page.request.get(`${E2E.appUrl}/api/export/transfer.txt?m=${MONTH}`);
    expect(res.status()).toBe(403);
  });
});
