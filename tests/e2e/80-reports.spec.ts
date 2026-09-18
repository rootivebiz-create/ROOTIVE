/**
 * 年次レポートと月次目標（0009）：年間サマリー・月次推移・ランキング・CSV、ダッシュボードの目標進捗
 * 前提：§8.6 の初期データ（resetToSeed）。テストは順番に依存するため serial
 */
import { test, expect } from "@playwright/test";
import { E2E, adminSql, kpiCard, listRow, loginViaMagicLink, readState, requireState, resetToSeed, saveScreenshot, setMonthClosed, toast, yen } from "./helpers";

test.describe.configure({ mode: "serial" });

const MONTH = "2026-09";
const YEAR = 2026;

function clearReportData(): void {
  const { companyId } = requireState();
  adminSql(
    `select set_config('app.bypass_closing', 'on', true);
     delete from public.expenses where company_id = '${companyId}';
     delete from public.month_targets where company_id = '${companyId}';`,
  );
}

test.beforeEach(async () => {
  const state = readState();
  test.skip(!state || state.appSkipped, "E2E_SKIP_APP=1 のため Next.js を起動していません");
});

test.describe("年次レポートと月次目標", () => {
  test.beforeAll(async () => {
    const state = readState();
    if (!state || state.appSkipped) return;
    await resetToSeed();
    await setMonthClosed(MONTH, false);
    clearReportData();
    // 経費 200,000（固定 120,000 ＋ 変動 80,000）を 2026-09 に入れる
    const { companyId } = requireState();
    adminSql(
      `insert into public.expenses (company_id, month, category_id, label, amount)
       values ('${companyId}', '2026-09-01', (select id from public.expense_categories where company_id = '${companyId}' and name = '車両リース・レンタル'), 'リース料', 120000),
              ('${companyId}', '2026-09-01', (select id from public.expense_categories where company_id = '${companyId}' and name = '燃料費'), '燃料', 80000);`,
    );
  });

  test.afterAll(async () => {
    const state = readState();
    if (!state || state.appSkipped) return;
    clearReportData();
  });

  test("年次レポートに年間サマリー・月次の内訳・ランキングが出る", async ({ page }, testInfo) => {
    await loginViaMagicLink(page, E2E.users.owner.email, `/reports?y=${YEAR}`);
    await expect(page.getByRole("heading", { name: "年次レポート" })).toBeVisible();
    await expect(page.getByLabel("表示する年")).toBeVisible();

    // 会社売上 2,559,573／会社利益 652,490.3／経費 200,000／営業利益 452,490.3
    await expect(page.getByText(yen(2559573)).first()).toBeVisible();
    await expect(page.getByText(yen(200000)).first()).toBeVisible();
    await expect(page.getByText(yen(452490.3)).first()).toBeVisible();

    await expect(page.getByRole("heading", { name: "月次の内訳" })).toBeVisible();
    await expect(listRow(page, "2026年9月").first()).toContainText(yen(2559573));

    // ドライバー別・案件別・経費のカテゴリ別
    await expect(listRow(page, "相曽慧").first()).toBeVisible();
    await expect(listRow(page, "三郷Amazon").first()).toBeVisible();
    await expect(listRow(page, "車両リース・レンタル").first()).toContainText(yen(120000));
    if (testInfo.project.name === "mobile") await saveScreenshot(page, "reports-mobile.png");
  });

  test("年次レポート CSV をダウンロードできる", async ({ page }) => {
    await loginViaMagicLink(page, E2E.users.owner.email, `/reports?y=${YEAR}`);
    const [download] = await Promise.all([page.waitForEvent("download"), page.getByRole("link", { name: "CSV" }).click()]);
    const stream = await download.createReadStream();
    const chunks: Buffer[] = [];
    for await (const c of stream) chunks.push(Buffer.from(c));
    const csv = Buffer.concat(chunks).toString("utf8");
    expect(csv).toContain("営業利益");
    expect(csv).toContain("2026-09");
    expect(csv).toContain("2559573");
    expect(csv).toContain("200000");
  });

  test("ダッシュボードで月次目標を設定すると進捗が出る", async ({ page }) => {
    await loginViaMagicLink(page, E2E.users.owner.email, `/dashboard?m=${MONTH}`);
    await expect(page.getByRole("heading", { name: "月次目標" })).toBeVisible();
    await page.getByRole("button", { name: "目標を設定" }).click();
    const dialog = page.getByRole("dialog");
    await dialog.getByLabel("売上目標").fill("2,600,000");
    await dialog.getByLabel("営業利益目標").fill("400000");
    await dialog.getByRole("button", { name: "保存", exact: true }).click();
    await expect(toast(page, /保存しました/)).toBeVisible();

    // 売上 2,559,573 / 2,600,000 = 98.4%、営業利益 452,490.3 / 400,000 = 113.1%（達成）
    await expect(page.getByText("98.4%")).toBeVisible();
    await expect(page.getByText("113.1%")).toBeVisible();
    await expect(kpiCard(page, "営業利益")).toContainText(yen(452490.3));
  });

  test("閲覧者は目標を編集できない", async ({ page }) => {
    await loginViaMagicLink(page, E2E.users.viewer.email, `/dashboard?m=${MONTH}`);
    await expect(page.getByRole("heading", { name: "月次目標" })).toBeVisible();
    await expect(page.getByRole("button", { name: "目標を編集" })).toHaveCount(0);
  });
});
