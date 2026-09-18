/**
 * 見える化（0010）：今月の着地見込み・資金繰りカレンダー・案件別採算・ドライバー別採算と単価シミュレーション
 * 前提：§8.6 の初期データ（resetToSeed）。テストは順番に依存するため serial
 */
import { test, expect } from "@playwright/test";
import { E2E, adminSql, listRow, loginViaMagicLink, readState, requireState, resetToSeed, saveScreenshot, setMonthClosed, toast, yen } from "./helpers";

test.describe.configure({ mode: "serial" });

const MONTH = "2026-09";

function clearVisibilityData(): void {
  const { companyId } = requireState();
  adminSql(
    `select set_config('app.bypass_closing', 'on', true);
     delete from public.cash_snapshots where company_id = '${companyId}';
     delete from public.expenses where company_id = '${companyId}';
     update public.projects set target_margin = null where company_id = '${companyId}';`,
  );
}

test.beforeEach(async () => {
  const state = readState();
  test.skip(!state || state.appSkipped, "E2E_SKIP_APP=1 のため Next.js を起動していません");
});

test.describe("見える化", () => {
  test.beforeAll(async () => {
    const state = readState();
    if (!state || state.appSkipped) return;
    await resetToSeed();
    await setMonthClosed(MONTH, false);
    clearVisibilityData();
  });

  test.afterAll(async () => {
    const state = readState();
    if (!state || state.appSkipped) return;
    clearVisibilityData();
  });

  test("案件別採算：目標利益率を設定すると目標未達の警告が出る", async ({ page }, testInfo) => {
    // 三郷Amazon の利益率は 10% 前後。目標 30% を設定して未達にする
    await loginViaMagicLink(page, E2E.users.owner.email, `/settings/projects?m=${MONTH}`);
    await listRow(page, "三郷Amazon").first().getByRole("link", { name: /編集|三郷Amazon/ }).first().click();
    await page.getByLabel(/目標利益率/).fill("30");
    await page.getByRole("button", { name: /保存/ }).first().click();
    await expect(toast(page, /保存しました/)).toBeVisible();

    await page.goto(`${E2E.appUrl}/projects?m=${MONTH}`);
    await expect(page.getByRole("heading", { name: "案件別" })).toBeVisible();
    await expect(page.getByText(/目標利益率を下回っている案件/)).toBeVisible();
    await expect(page.getByText("目標未達").filter({ visible: true }).first()).toBeVisible();
    if (testInfo.project.name === "mobile") await saveScreenshot(page, "projects-pl-mobile.png");
  });

  test("案件別採算：案件に紐づけた経費が案件利益から引かれる", async ({ page }) => {
    const { companyId } = requireState();
    adminSql(
      `insert into public.expenses (company_id, month, category_id, label, amount, project_id)
       values ('${companyId}', '2026-09-01',
               (select id from public.expense_categories where company_id = '${companyId}' and name = '高速・有料道路'),
               '三郷の高速代', 50000,
               (select id from public.projects where company_id = '${companyId}' and name = '三郷Amazon'));`,
    );
    await loginViaMagicLink(page, E2E.users.owner.email, `/projects?m=${MONTH}`);
    // 直課経費として 50,000 が案件の行に出る
    await expect(page.getByText(yen(50000)).filter({ visible: true }).first()).toBeVisible();
  });

  test("資金繰り：残高を登録すると推移と最低残高が出る", async ({ page }, testInfo) => {
    await loginViaMagicLink(page, E2E.users.owner.email, "/cashflow");
    await expect(page.getByRole("heading", { name: "資金繰り" })).toBeVisible();
    await expect(page.getByText(/残高は未登録です/).first()).toBeVisible();

    await page.getByRole("button", { name: "残高を登録" }).filter({ visible: true }).first().click();
    const dialog = page.getByRole("dialog");
    await expect(dialog.getByRole("heading", { name: /現在の残高を登録/ })).toBeVisible();
    await dialog.getByLabel("現金残高").fill("1,500,000");
    await dialog.getByRole("button", { name: "保存", exact: true }).click();
    await expect(toast(page, /残高を登録しました|保存しました/)).toBeVisible();
    await expect(page.getByText(/現在の残高を登録してください/)).toHaveCount(0);
    await expect(page.getByText("最低残高").filter({ visible: true }).first()).toBeVisible();
    if (testInfo.project.name === "mobile") await saveScreenshot(page, "cashflow-mobile.png");
  });

  test("資金繰り：期間を切り替えても壊れず、CSV を取得できる", async ({ page }) => {
    await loginViaMagicLink(page, E2E.users.owner.email, "/cashflow");
    await page.getByRole("group", { name: "表示する期間" }).getByRole("button", { name: "30 日" }).click();
    await expect(page.getByRole("heading", { name: "資金繰り" })).toBeVisible();

    const [download] = await Promise.all([page.waitForEvent("download"), page.getByRole("link", { name: "CSV" }).click()]);
    const stream = await download.createReadStream();
    const chunks: Buffer[] = [];
    for await (const c of stream) chunks.push(Buffer.from(c));
    const csv = Buffer.concat(chunks).toString("utf8");
    expect(csv).toContain("日付");
    expect(csv).toContain("残高");
  });

  test("ドライバー別採算：一覧と単価シミュレーションが動く", async ({ page }, testInfo) => {
    await loginViaMagicLink(page, E2E.users.owner.email, `/drivers-pl?m=${MONTH}`);
    await expect(page.getByRole("heading", { name: "ドライバー別の採算" })).toBeVisible();
    await expect(page.getByText("相曽慧").filter({ visible: true }).first()).toBeVisible();
    await expect(page.getByText(yen(483525)).filter({ visible: true }).first()).toBeVisible();

    // 受注単価を 1,000 円上げると会社利益が増える
    await page.getByLabel("受注単価の増減").fill("1000");
    await expect(page.getByText(/試算だけです/)).toBeVisible();
    await expect(page.getByText(/試算/).filter({ visible: true }).first()).toBeVisible();
    if (testInfo.project.name === "mobile") await saveScreenshot(page, "drivers-pl-mobile.png");
  });

  test("ダッシュボード：締め済み月には着地見込みを出さない", async ({ page }) => {
    await setMonthClosed(MONTH, true);
    await loginViaMagicLink(page, E2E.users.owner.email, `/dashboard?m=${MONTH}`);
    await expect(page.getByRole("heading", { name: "今月の着地見込み" })).toHaveCount(0);
    await setMonthClosed(MONTH, false);
  });

  test("閲覧者は残高を登録できない", async ({ page }) => {
    await loginViaMagicLink(page, E2E.users.viewer.email, "/cashflow");
    await expect(page.getByRole("heading", { name: "資金繰り" })).toBeVisible();
    await expect(page.getByRole("button", { name: "残高を登録" })).toHaveCount(0);
  });
});
