/**
 * 元請の実績ファイルの取り込み（0013）と採用・契約（0013）
 * 前提：§8.6 の初期データ（resetToSeed）。テストは順番に依存するため serial
 */
import { test, expect } from "@playwright/test";
import { E2E, adminSql, loginViaMagicLink, readState, requireState, resetToSeed, saveScreenshot, setMonthClosed, toast } from "./helpers";

test.describe.configure({ mode: "serial" });

const MONTH = "2026-09";

function clearIntakeHr(): void {
  const { companyId } = requireState();
  adminSql(
    `select set_config('app.bypass_closing', 'on', true);
     delete from public.import_runs where company_id = '${companyId}';
     delete from public.import_profiles where company_id = '${companyId}';
     delete from public.applicant_events where company_id = '${companyId}';
     delete from public.applicants where company_id = '${companyId}';
     delete from public.contracts where company_id = '${companyId}';
     delete from public.work_day_entries where company_id = '${companyId}';`,
  );
}

test.beforeEach(async () => {
  const state = readState();
  test.skip(!state || state.appSkipped, "E2E_SKIP_APP=1 のため Next.js を起動していません");
});

test.describe("元請の実績ファイルの取り込み", () => {
  test.beforeAll(async () => {
    const state = readState();
    if (!state || state.appSkipped) return;
    await resetToSeed();
    await setMonthClosed(MONTH, false);
    clearIntakeHr();
  });

  test.afterAll(async () => {
    const state = readState();
    if (!state || state.appSkipped) return;
    clearIntakeHr();
  });

  test("CSV を読み込むとプレビューが出て、取り込むと日別の稼働に入る", async ({ page }, testInfo) => {
    const { companyId } = requireState();
    await loginViaMagicLink(page, E2E.users.owner.email, `/intake?m=${MONTH}`);
    await expect(page.getByRole("heading", { name: /取り込み/ })).toBeVisible();

    const csv = ["配送日,ドライバー名,コース,個数", "2026/09/05,相曽慧,三郷Amazon,12", "2026/09/06,相曽慧,三郷Amazon,9", ""].join("\r\n");
    await page.locator('input[type="file"]').first().setInputFiles({ name: "jisseki.csv", mimeType: "text/csv", buffer: Buffer.from(csv, "utf8") });
    await page.getByRole("button", { name: /読み込む|プレビュー/ }).first().click();
    await expect(page.getByText("相曽慧").first()).toBeVisible();
    if (testInfo.project.name === "mobile") await saveScreenshot(page, "intake-mobile.png");

    await page.getByRole("button", { name: /取り込む$|取り込む（/ }).first().click();
    await expect(toast(page, /取り込み|件/)).toBeVisible();
    expect(adminSql(`select count(*) from public.work_day_entries where company_id = '${companyId}';`)).toMatch(/\b2\b/);
  });

  test("閲覧者は取り込めない", async ({ page }) => {
    await loginViaMagicLink(page, E2E.users.viewer.email, `/intake?m=${MONTH}`);
    await expect(page.getByRole("heading", { name: /取り込み/ })).toBeVisible();
    await expect(page.getByRole("button", { name: /読み込む|プレビュー/ })).toHaveCount(0);
  });
});

test.describe("採用と契約", () => {
  test.beforeAll(async () => {
    const state = readState();
    if (!state || state.appSkipped) return;
    await resetToSeed();
    clearIntakeHr();
  });

  test.afterAll(async () => {
    const state = readState();
    if (!state || state.appSkipped) return;
    clearIntakeHr();
  });

  test("応募者を追加して段階を進められる", async ({ page }, testInfo) => {
    const { companyId } = requireState();
    adminSql(
      `insert into public.applicants (company_id, name, kana, phone, source, stage, applied_on)
       values ('${companyId}', '応募 太郎', 'オウボ タロウ', '090-0000-0000', '求人サイト', 'applied', current_date - 20);`,
    );
    await loginViaMagicLink(page, E2E.users.owner.email, "/hr");
    await expect(page.getByRole("heading", { name: "採用と契約" })).toBeVisible();
    await expect(page.getByText("応募 太郎").first()).toBeVisible();
    // 20 日動いていないのでフォロー漏れに出る
    await expect(page.getByText(/フォロー漏れ/).first()).toBeVisible();
    if (testInfo.project.name === "mobile") await saveScreenshot(page, "hr-mobile.png");
  });

  test("更新時期の契約が警告される", async ({ page }) => {
    const { companyId } = requireState();
    adminSql(
      `insert into public.contracts (company_id, driver_id, title, status, start_on, end_on, notice_days)
       values ('${companyId}', (select id from public.drivers where company_id = '${companyId}' and name = '相曽慧'),
               '業務委託契約書', 'active', current_date - 300, current_date + 10, 30);`,
    );
    await loginViaMagicLink(page, E2E.users.owner.email, "/hr?tab=contracts");
    await expect(page.getByText("相曽慧").first()).toBeVisible();
    await expect(page.getByText(/更新時期|あと 10 日/).first()).toBeVisible();
  });

  test("閲覧者は応募者を追加できない", async ({ page }) => {
    await loginViaMagicLink(page, E2E.users.viewer.email, "/hr");
    await expect(page.getByRole("heading", { name: "採用と契約" })).toBeVisible();
    await expect(page.getByRole("button", { name: /応募者を追加/ })).toHaveCount(0);
  });
});
