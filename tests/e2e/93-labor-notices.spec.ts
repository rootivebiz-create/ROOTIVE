/**
 * 第 6 波：労務（拘束時間・休息）／元請の支払通知との突合／見積シミュレーター／週次サマリー
 * 前提：§8.6 の初期データ（resetToSeed）。テストは順番に依存するため serial
 */
import { test, expect } from "@playwright/test";
import { E2E, adminSql, driverIdByName, listRow, loginViaMagicLink, readState, requireState, resetToSeed, saveScreenshot, setMonthClosed, toast } from "./helpers";

test.describe.configure({ mode: "serial" });

const MONTH = "2026-09";

function clearWave6(): void {
  const { companyId } = requireState();
  adminSql(
    `select set_config('app.bypass_closing', 'on', false);
     delete from public.payment_notice_items where company_id = '${companyId}';
     delete from public.payment_notices where company_id = '${companyId}';
     delete from public.daily_reports where company_id = '${companyId}';
     delete from public.ai_insights where company_id = '${companyId}' and kind = 'weekly';`,
  );
}

test.beforeEach(async () => {
  const state = readState();
  test.skip(!state || state.appSkipped, "E2E_SKIP_APP=1 のため Next.js を起動していません");
});

test.describe("労務（拘束時間・休息・連続勤務）", () => {
  test.beforeAll(async () => {
    const state = readState();
    if (!state || state.appSkipped) return;
    await resetToSeed();
    await setMonthClosed(MONTH, false);
    clearWave6();
    const { companyId } = requireState();
    const driver = driverIdByName("相曽慧");
    // 9/10 は 14 時間の拘束、9/11 は前日 20 時 → 当日 3 時で休息 7 時間
    adminSql(
      `insert into public.daily_reports (company_id, work_date, driver_id, start_at, end_at, break_minutes, distance_km)
       values ('${companyId}', '2026-09-10', '${driver}', '2026-09-10 06:00+09', '2026-09-10 20:00+09', 60, 120),
              ('${companyId}', '2026-09-11', '${driver}', '2026-09-11 03:00+09', '2026-09-11 19:00+09', 60, 150);`,
    );
  });

  test.afterAll(async () => {
    const state = readState();
    if (!state || state.appSkipped) return;
    clearWave6();
  });

  test("拘束時間と休息の不足が一覧に出る", async ({ page }, testInfo) => {
    await loginViaMagicLink(page, E2E.users.owner.email, `/daily?tab=labor&m=${MONTH}`);
    await expect(page.getByRole("heading", { name: "日報・点呼" })).toBeVisible();

    // 9/10 は 14 時間の拘束（目安の 13 時間を超える）、9/11 は 16 時間
    await expect(listRow(page, "9/10").first()).toContainText("14 時間");
    await expect(listRow(page, "9/11").first()).toContainText("16 時間");
    // 休息 7 時間（前日 20 時 → 当日 3 時）と、具体的な打ち手
    await expect(page.getByText(/休息が 7 時間です/).filter({ visible: true }).first()).toBeVisible();
    await expect(page.getByText(/目安の 13 時間を 1 時間超えています/).filter({ visible: true }).first()).toBeVisible();
    // ドライバー別の行
    await expect(listRow(page, "相曽慧").first()).toBeVisible();
    if (testInfo.project.name === "mobile") await saveScreenshot(page, "labor-mobile.png");
  });

  test("労務 CSV と Excel を取得できる", async ({ page }) => {
    await loginViaMagicLink(page, E2E.users.owner.email, `/daily?tab=labor&m=${MONTH}`);
    const csv = await page.request.get(`${E2E.appUrl}/api/export/labor.csv?m=${MONTH}&kind=day`);
    expect(csv.status(), await csv.text()).toBe(200);
    expect(await csv.text()).toContain("相曽慧");

    const xlsx = await page.request.get(`${E2E.appUrl}/api/export/labor.xlsx?m=${MONTH}&kind=month`);
    expect(xlsx.status()).toBe(200);
    const body = await xlsx.body();
    expect(body.subarray(0, 2).toString("latin1")).toBe("PK");
  });

  test("設定 → 安全管理 で労務の基準を変えられる", async ({ page }) => {
    const { companyId } = requireState();
    await loginViaMagicLink(page, E2E.users.owner.email, "/settings/safety");
    await expect(page.getByText("労務の基準").first()).toBeVisible();
    await page.getByLabel("1 日の拘束時間の目安").fill("15");
    await page.getByRole("button", { name: "労務の基準を保存" }).click();
    await expect(toast(page, /保存しました/)).toBeVisible();
    expect(adminSql(`select labor_duty_limit_minutes from public.companies where id = '${companyId}';`)).toMatch(/900/);
    // 戻す
    adminSql(`update public.companies set labor_duty_limit_minutes = 780 where id = '${companyId}';`);
  });

  test("閲覧者は労務を見られるが基準は変えられない", async ({ page }) => {
    await loginViaMagicLink(page, E2E.users.viewer.email, `/daily?tab=labor&m=${MONTH}`);
    await expect(page.getByText(/休息が 7 時間です/).filter({ visible: true }).first()).toBeVisible();
    await page.goto(`${E2E.appUrl}/settings/safety`);
    await expect(page).toHaveURL(/\/dashboard/);
  });
});

test.describe("元請の支払通知との突合", () => {
  test.beforeAll(async () => {
    const state = readState();
    if (!state || state.appSkipped) return;
    await resetToSeed();
    await setMonthClosed(MONTH, false);
    clearWave6();
  });

  test.afterAll(async () => {
    const state = readState();
    if (!state || state.appSkipped) return;
    clearWave6();
  });

  test("支払通知を登録し、貼り付けた明細を取り込んで差を見つける", async ({ page }, testInfo) => {
    const { companyId } = requireState();
    await loginViaMagicLink(page, E2E.users.owner.email, `/invoices/notices?m=${MONTH}`);
    await expect(page.getByRole("heading", { name: "支払通知の突合" })).toBeVisible();
    await expect(page.getByText("支払通知書がまだありません")).toBeVisible();

    await page.getByRole("button", { name: /支払通知を登録|登録/ }).first().click();
    const dialog = page.getByRole("dialog");
    await dialog.getByLabel(/通知番号/).fill("PN-001");
    await dialog.getByRole("button", { name: /登録する|保存/ }).first().click();
    await expect(toast(page, /保存しました|登録しました/)).toBeVisible();
    expect(adminSql(`select count(*) from public.payment_notices where company_id = '${companyId}';`)).toMatch(/\b1\b/);

    // 詳細へ
    await listRow(page, "PN-001").first().click();
    await page.waitForURL(/\/invoices\/notices\/[0-9a-f-]{36}/);
    await expect(page.getByText("明細がまだありません")).toBeVisible();
    if (testInfo.project.name === "mobile") await saveScreenshot(page, "notices-mobile.png");
  });

  test("差額のある通知は「気になること」に出る", async ({ page }) => {
    const { companyId } = requireState();
    // その月の売上 ＋ 1,000 円の通知にする
    adminSql(
      `update public.payment_notices
          set total_amount = (select coalesce(sum(bill), 0) + 1000 from public.v_work_entry_calc where company_id = '${companyId}' and month = '2026-09-01')
        where company_id = '${companyId}';`,
    );
    await loginViaMagicLink(page, E2E.users.owner.email, `/alerts?m=${MONTH}`);
    await page.getByRole("button", { name: /今すぐ検査する/ }).click();
    await expect(toast(page, /検査|件/)).toBeVisible();
    await expect(page.getByText("支払通知との差").first()).toBeVisible();
  });

  test("閲覧者は支払通知を登録できない", async ({ page }) => {
    await loginViaMagicLink(page, E2E.users.viewer.email, `/invoices/notices?m=${MONTH}`);
    await expect(page.getByRole("heading", { name: "支払通知の突合" })).toBeVisible();
    await expect(page.getByRole("button", { name: /支払通知を登録/ })).toHaveCount(0);
  });
});

test.describe("見積シミュレーターと週次サマリー", () => {
  test.beforeAll(async () => {
    const state = readState();
    if (!state || state.appSkipped) return;
    await resetToSeed();
    clearWave6();
  });

  test("単価を入れると営業利益と逆算した単価が出る", async ({ page }, testInfo) => {
    await loginViaMagicLink(page, E2E.users.owner.email, `/projects?tab=quote&m=${MONTH}`);
    await expect(page.getByRole("heading", { name: "案件別" })).toBeVisible();

    await page.getByLabel(/^受注単価/).fill("23000");
    await page.getByLabel(/^支払単価/).fill("20000");
    await page.getByLabel(/^月の数量/).fill("21");
    await page.getByLabel(/^必要なドライバー数/).fill("1");
    await page.getByLabel(/^目標利益率/).fill("15");

    await expect(page.getByText("営業利益 0 になる受注単価")).toBeVisible();
    await expect(page.getByText("受注単価を動かせないときの支払単価の上限")).toBeVisible();
    if (testInfo.project.name === "mobile") await saveScreenshot(page, "quote-mobile.png");
  });

  test("週次サマリーを作れる（AI キーが無くても数字だけで成立する）", async ({ page }) => {
    const { companyId } = requireState();
    await loginViaMagicLink(page, E2E.users.owner.email, "/ai?tab=weekly");
    await expect(page.getByText("週次サマリー").first()).toBeVisible();
    await page.getByRole("button", { name: "今週ぶんを作る" }).click();
    await expect(toast(page, /作成|保存|サマリー/)).toBeVisible();
    expect(adminSql(`select count(*) from public.ai_insights where company_id = '${companyId}' and kind = 'weekly';`)).toMatch(/\b1\b/);
  });

  test("ダッシュボードの AI カードは週次サマリーを拾わない", async ({ page }) => {
    // 直前のテストで週次サマリーだけを作っているので、月次のカードは「まだ分析はありません」のまま
    await loginViaMagicLink(page, E2E.users.owner.email, `/dashboard?m=${MONTH}`);
    await expect(page.getByRole("heading", { name: "ダッシュボード" })).toBeVisible();
    await expect(page.getByText("AI の経営分析")).toBeVisible();
    await expect(page.getByText(/まだこの月の分析はありません|ANTHROPIC_API_KEY/)).toBeVisible();
  });
});
