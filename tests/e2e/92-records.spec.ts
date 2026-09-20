/**
 * 書類の検索（電子帳簿保存法の検索要件）
 * 前提：§8.6 の初期データ（resetToSeed）。テストは順番に依存するため serial
 */
import { test, expect } from "@playwright/test";
import { E2E, adminSql, listRow, loginViaMagicLink, readState, requireState, resetToSeed, saveScreenshot } from "./helpers";

test.describe.configure({ mode: "serial" });


function seedDocs(): void {
  const { companyId } = requireState();
  adminSql(
    `delete from public.expenses where company_id = '${companyId}';
     insert into public.expenses (company_id, month, category_id, label, amount, incurred_on, vendor, receipt_path)
     select '${companyId}', '2026-09-01', c.id, '軽油', 52000, '2026-09-12', 'エネオス三郷', '${companyId}/2026/receipt-1.jpg'
       from public.expense_categories c where c.company_id = '${companyId}' order by c.sort_order limit 1;
     insert into public.expenses (company_id, month, category_id, label, amount, incurred_on, vendor)
     select '${companyId}', '2026-09-01', c.id, '高速代', 8400, '2026-09-20', 'NEXCO東日本'
       from public.expense_categories c where c.company_id = '${companyId}' order by c.sort_order limit 1;`,
  );
}

function clearDocs(): void {
  const { companyId } = requireState();
  adminSql(`delete from public.expenses where company_id = '${companyId}';`);
}

test.beforeEach(async () => {
  const state = readState();
  test.skip(!state || state.appSkipped, "E2E_SKIP_APP=1 のため Next.js を起動していません");
});

test.describe("書類の検索", () => {
  test.beforeAll(async () => {
    const state = readState();
    if (!state || state.appSkipped) return;
    await resetToSeed();
    seedDocs();
  });

  test.afterAll(async () => {
    const state = readState();
    if (!state || state.appSkipped) return;
    clearDocs();
  });

  test("取引先・金額・日付で絞り込める", async ({ page }, testInfo) => {
    await loginViaMagicLink(page, E2E.users.owner.email, "/records");
    await expect(page.getByRole("heading", { name: "書類の検索" })).toBeVisible();

    // 2 件とも出ている
    await expect(listRow(page, "エネオス三郷").first()).toBeVisible();
    await expect(listRow(page, "NEXCO東日本").first()).toBeVisible();

    // 取引先で絞る
    await page.getByLabel("取引先・件名").fill("エネオス");
    await expect(listRow(page, "NEXCO東日本")).toHaveCount(0);
    await expect(listRow(page, "エネオス三郷").first()).toBeVisible();

    // 金額の下限で絞る（8,400 円の高速代は外れる）
    await page.getByLabel("取引先・件名").fill("");
    await page.getByLabel("取引金額（下限）").fill("10000");
    await expect(listRow(page, "NEXCO東日本")).toHaveCount(0);

    // 日付の範囲で絞る
    await page.getByLabel("取引金額（下限）").fill("");
    await page.getByLabel("取引年月日（開始）").fill("2026-09-15");
    await expect(listRow(page, "エネオス三郷")).toHaveCount(0);
    await expect(listRow(page, "NEXCO東日本").first()).toBeVisible();

    if (testInfo.project.name === "mobile") await saveScreenshot(page, "records-mobile.png");
  });

  test("ファイルが保存されていない書類だけを出せる", async ({ page }) => {
    await loginViaMagicLink(page, E2E.users.owner.email, "/records");
    await page.getByRole("button", { name: "ファイル未保存のみ" }).click();
    // レシート画像のある軽油は外れ、高速代だけが残る
    await expect(listRow(page, "NEXCO東日本").first()).toBeVisible();
    await expect(listRow(page, "エネオス三郷")).toHaveCount(0);
  });

  test("索引簿 CSV をダウンロードできる", async ({ page }) => {
    await loginViaMagicLink(page, E2E.users.owner.email, "/records");
    const res = await page.request.get(`${E2E.appUrl}/api/export/records.csv?q=%E3%82%A8%E3%83%8D%E3%82%AA%E3%82%B9`);
    expect(res.status(), await res.text()).toBe(200);
    const text = await res.text();
    expect(text).toContain("取引年月日");
    expect(text).toContain("エネオス三郷");
    expect(text).not.toContain("NEXCO東日本");
  });

  test("閲覧者も検索できる", async ({ page }) => {
    await loginViaMagicLink(page, E2E.users.viewer.email, "/records");
    await expect(page.getByRole("heading", { name: "書類の検索" })).toBeVisible();
    await expect(listRow(page, "エネオス三郷").first()).toBeVisible();
  });
});
