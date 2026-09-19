/**
 * 日報・点呼と日別の稼働（0012）／車両と書類の期限（0012）
 * 前提：§8.6 の初期データ（resetToSeed）。テストは順番に依存するため serial
 */
import { test, expect } from "@playwright/test";
import { E2E, adminSql, createInvitation, driverIdByName, loginViaInvite, loginViaMagicLink, readState, requireState, resetToSeed, saveScreenshot, setMonthClosed, toast } from "./helpers";

test.describe.configure({ mode: "serial" });

const MONTH = "2026-09";
const DRIVER_EMAIL = "driver-daily@example.com";

function clearOps(): void {
  const { companyId } = requireState();
  adminSql(
    `select set_config('app.bypass_closing', 'on', true);
     delete from public.work_day_entries where company_id = '${companyId}';
     delete from public.daily_reports where company_id = '${companyId}';
     delete from public.documents where company_id = '${companyId}';
     delete from public.vehicles where company_id = '${companyId}';
     delete from public.safety_managers where company_id = '${companyId}';
     delete from public.alerts where company_id = '${companyId}';
     update public.work_entries set qty_source = 'manual' where company_id = '${companyId}';`,
  );
}

test.beforeEach(async () => {
  const state = readState();
  test.skip(!state || state.appSkipped, "E2E_SKIP_APP=1 のため Next.js を起動していません");
});

test.describe("車両と書類の期限", () => {
  test.beforeAll(async () => {
    const state = readState();
    if (!state || state.appSkipped) return;
    await resetToSeed();
    await setMonthClosed(MONTH, false);
    clearOps();
  });

  test.afterAll(async () => {
    const state = readState();
    if (!state || state.appSkipped) return;
    clearOps();
  });

  test("車両を登録して書類の期限を入れると、期限切れが警告される", async ({ page }, testInfo) => {
    const { companyId } = requireState();
    adminSql(
      `insert into public.vehicles (id, company_id, plate, maker, model, ownership, driver_id)
       values ('00000000-0000-0000-0000-0000000000f1', '${companyId}', '足立 480 あ 12-34', 'ダイハツ', 'ハイゼット', 'lease',
               (select id from public.drivers where company_id = '${companyId}' and name = '相曽慧'));
       insert into public.documents (company_id, kind, vehicle_id, label, expires_on, reminder_days)
       values ('${companyId}', 'vehicle_inspection', '00000000-0000-0000-0000-0000000000f1', '車検', current_date - 3, 60),
              ('${companyId}', 'voluntary_insurance', '00000000-0000-0000-0000-0000000000f1', '任意保険', current_date + 20, 60);`,
    );

    await loginViaMagicLink(page, E2E.users.owner.email, "/fleet");
    await expect(page.getByRole("heading", { name: "車両と書類" })).toBeVisible();
    await expect(page.getByText("足立 480 あ 12-34").first()).toBeVisible();
    await expect(page.getByText(/車検/).first()).toBeVisible();
    await expect(page.getByText(/期限切れ/).first()).toBeVisible();
    if (testInfo.project.name === "mobile") await saveScreenshot(page, "fleet-mobile.png");
  });

  test("検査すると期限切れ・期限間近が「気になること」に出る", async ({ page }) => {
    await loginViaMagicLink(page, E2E.users.owner.email, `/alerts?m=${MONTH}`);
    await page.getByRole("button", { name: /今すぐ検査する/ }).click();
    await expect(toast(page, /見つかりました|ありませんでした/)).toBeVisible();
    await expect(page.getByText(/車検.*期限切れ|期限切れです/).first()).toBeVisible();
    await expect(page.getByText(/貨物軽自動車安全管理者/).first()).toBeVisible();
  });

  test("閲覧者は車両を追加できない", async ({ page }) => {
    await loginViaMagicLink(page, E2E.users.viewer.email, "/fleet");
    await expect(page.getByRole("heading", { name: "車両と書類" })).toBeVisible();
    await expect(page.getByRole("button", { name: /車両を追加/ })).toHaveCount(0);
  });
});

test.describe("日報・点呼と日別の稼働", () => {
  test.beforeAll(async () => {
    const state = readState();
    if (!state || state.appSkipped) return;
    await resetToSeed();
    await setMonthClosed(MONTH, false);
    clearOps();
  });

  test.afterAll(async () => {
    const state = readState();
    if (!state || state.appSkipped) return;
    clearOps();
  });

  test("ドライバーが「今日の報告」を出すと、承認後に月次の稼働へ入る", async ({ page }, testInfo) => {
    const { companyId } = requireState();
    const driverId = driverIdByName("相曽慧");
    const token = createInvitation({ email: DRIVER_EMAIL, role: "driver", driverId, displayName: "相曽慧" });
    await loginViaInvite(page, token);
    await page.goto(`${E2E.appUrl}/driver/today`);
    await expect(page.getByRole("heading", { name: /今日の報告/ })).toBeVisible();
    if (testInfo.project.name === "mobile") await saveScreenshot(page, "driver-today-mobile.png");

    // 稼働の数量を入れて送信する（画面の最初の数量欄に入れる）
    const qty = page.getByRole("spinbutton").first();
    await expect(qty).toBeVisible();
    await qty.fill("3");
    await page.getByRole("button", { name: /送信|報告する/ }).first().click();
    await expect(toast(page, /送信|報告|保存/)).toBeVisible();

    // DB に承認待ちで入る
    expect(adminSql(`select count(*) from public.work_day_entries where company_id = '${companyId}' and status = 'submitted';`)).toMatch(/\b1\b/);

    // 管理者が承認すると月次に反映される
    await loginViaMagicLink(page, E2E.users.owner.email, `/daily?m=${MONTH}&tab=entries`);
    await expect(page.getByRole("heading", { name: "日報・点呼" })).toBeVisible();
    await expect(page.getByText("相曽慧").first()).toBeVisible();
    await page.getByRole("button", { name: /^承認/ }).first().click();
    await expect(toast(page, /承認/)).toBeVisible();
    expect(adminSql(`select qty_source from public.work_entries where company_id = '${companyId}' and qty_source = 'daily' limit 1;`)).toContain("daily");
  });

  test("点呼の記録が無い日は警告される", async ({ page }) => {
    await loginViaMagicLink(page, E2E.users.owner.email, `/alerts?m=${MONTH}`);
    await page.getByRole("button", { name: /今すぐ検査する/ }).click();
    await expect(toast(page, /見つかりました|ありませんでした/)).toBeVisible();
    await expect(page.getByText(/点呼の記録が無い日/).first()).toBeVisible();
  });

  test("閲覧者は承認できない", async ({ page }) => {
    await loginViaMagicLink(page, E2E.users.viewer.email, `/daily?m=${MONTH}&tab=entries`);
    await expect(page.getByRole("heading", { name: "日報・点呼" })).toBeVisible();
    await expect(page.getByRole("button", { name: /^承認/ })).toHaveCount(0);
  });
});
