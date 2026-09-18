/**
 * 取引先と請求書（0009）：取引先の登録 → 案件に紐づけ → 稼働から請求書を作成 → 明細・状態・入金 → PDF・CSV
 * 前提：§8.6 の初期データ（resetToSeed）。テストは順番に依存するため serial
 */
import { test, expect } from "@playwright/test";
import { E2E, adminSql, listRow, loginViaMagicLink, readState, requireState, resetToSeed, saveScreenshot, setMonthClosed, toast, yen } from "./helpers";

test.describe.configure({ mode: "serial" });

const MONTH = "2026-09";
const CLIENT = "テスト運輸株式会社";
/** 三郷Amazon（21 日 × 23,025）＋ 黒岩亜夢莉（21 日）＋ 川島幹太（8 日）＝ 50 日 × 23,025 = 1,151,250 */
const BILL = 1151250;
const TAX = 115125;

function clearInvoices(): void {
  const { companyId } = requireState();
  adminSql(
    `delete from public.invoice_items where company_id = '${companyId}';
     delete from public.invoices where company_id = '${companyId}';
     update public.projects set client_id = null, client_name = '' where company_id = '${companyId}';
     delete from public.clients where company_id = '${companyId}';`,
  );
}

test.beforeEach(async () => {
  const state = readState();
  test.skip(!state || state.appSkipped, "E2E_SKIP_APP=1 のため Next.js を起動していません");
});

test.describe("取引先と請求書", () => {
  test.beforeAll(async () => {
    const state = readState();
    if (!state || state.appSkipped) return;
    await resetToSeed();
    await setMonthClosed(MONTH, false);
    clearInvoices();
  });

  test.afterAll(async () => {
    const state = readState();
    if (!state || state.appSkipped) return;
    clearInvoices();
  });

  test("取引先を登録して案件に設定できる", async ({ page }) => {
    await loginViaMagicLink(page, E2E.users.owner.email, `/settings/clients?m=${MONTH}`);
    await expect(page.getByRole("heading", { name: "取引先" })).toBeVisible();
    await expect(page.getByText("取引先が登録されていません")).toBeVisible();

    await page.getByRole("button", { name: "取引先を追加" }).click();
    const dialog = page.getByRole("dialog");
    await dialog.getByLabel("取引先名（必須）").fill(CLIENT);
    await dialog.getByLabel("適格請求書登録番号").fill("T9999999999999");
    await dialog.getByRole("button", { name: "登録する" }).click();
    await expect(toast(page, /登録しました|保存しました/)).toBeVisible();
    await expect(listRow(page, CLIENT).first()).toBeVisible();

    // 案件「三郷Amazon」に取引先を設定する
    await page.goto(`${E2E.appUrl}/settings/projects?m=${MONTH}`);
    await listRow(page, "三郷Amazon").first().getByRole("link", { name: /編集|三郷Amazon/ }).first().click();
    await expect(page.getByLabel("取引先")).toBeVisible();
    await page.getByLabel("取引先").selectOption({ label: CLIENT });
    await page.getByRole("button", { name: /保存/ }).first().click();
    await expect(toast(page, /保存しました/)).toBeVisible();
  });

  test("稼働から請求書を作成すると明細・消費税・合計が入る", async ({ page }, testInfo) => {
    await loginViaMagicLink(page, E2E.users.owner.email, `/invoices?m=${MONTH}`);
    await expect(page.getByRole("heading", { name: "請求書" })).toBeVisible();
    await expect(listRow(page, CLIENT).first()).toContainText(yen(BILL));

    await page.getByRole("button", { name: "請求書を作成" }).first().click();
    await expect(toast(page, /作成しました/)).toBeVisible();

    // 詳細画面へ遷移する
    await expect(page).toHaveURL(/\/invoices\/[0-9a-f-]{36}/);
    await expect(page.getByText(CLIENT).first()).toBeVisible();
    await expect(page.getByText("202609-01")).toBeVisible();
    await expect(page.getByText(yen(BILL)).first()).toBeVisible();
    await expect(page.getByText(yen(TAX)).first()).toBeVisible();
    await expect(page.getByText(yen(BILL + TAX)).first()).toBeVisible();
    if (testInfo.project.name === "mobile") await saveScreenshot(page, "invoice-mobile.png");
  });

  test("発行済み → 入金済みにできる（入金済みは作り直せない）", async ({ page }) => {
    await loginViaMagicLink(page, E2E.users.owner.email, `/invoices?m=${MONTH}`);
    await page.getByRole("link", { name: "開く" }).first().click();
    await expect(page.getByRole("heading", { name: "操作" })).toBeVisible();

    await page.getByRole("button", { name: "発行済みにする" }).click();
    await expect(toast(page, /発行済み/)).toBeVisible();
    await expect(page.getByRole("button", { name: "稼働から作り直す" })).toHaveCount(0);

    await page.getByRole("button", { name: "入金済みにする" }).first().click();
    const dialog = page.getByRole("dialog");
    await dialog.getByRole("button", { name: "入金済みにする" }).click();
    await expect(toast(page, /入金済み/)).toBeVisible();

    await page.goto(`${E2E.appUrl}/invoices?m=${MONTH}`);
    await expect(listRow(page, CLIENT).first()).toContainText("入金済み");
  });

  test("請求書 PDF と一覧 CSV を取得できる", async ({ page }) => {
    await loginViaMagicLink(page, E2E.users.owner.email, `/invoices?m=${MONTH}`);
    const [csv] = await Promise.all([page.waitForEvent("download"), page.getByRole("link", { name: "CSV" }).click()]);
    const stream = await csv.createReadStream();
    const chunks: Buffer[] = [];
    for await (const c of stream) chunks.push(Buffer.from(c));
    const text = Buffer.concat(chunks).toString("utf8");
    expect(text).toContain("請求書番号");
    expect(text).toContain(CLIENT);
    expect(text).toContain(String(BILL));

    // PDF（Route Handler の応答を直接確認する）
    await page.getByRole("link", { name: "開く" }).first().click();
    await page.waitForURL(/\/invoices\/[0-9a-f-]{36}/);
    const id = page.url().split("/invoices/")[1].split(/[?#]/)[0];
    const res = await page.request.get(`${E2E.appUrl}/api/export/invoice.pdf?id=${id}`);
    expect(res.status()).toBe(200);
    expect(res.headers()["content-type"]).toContain("application/pdf");
    const body = await res.body();
    expect(body.subarray(0, 5).toString("latin1")).toBe("%PDF-");
    expect(body.byteLength).toBeGreaterThan(5000);
  });

  test("閲覧者は請求書を作れない", async ({ page }) => {
    await loginViaMagicLink(page, E2E.users.viewer.email, `/invoices?m=${MONTH}`);
    await expect(page.getByRole("heading", { name: "請求書" })).toBeVisible();
    await expect(page.getByRole("button", { name: "請求書を作成" })).toHaveCount(0);
  });
});
