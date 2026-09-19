/**
 * 銀行 CSV の取り込みと入金消込（0011）＋ AI 画面（API キー未設定時の振る舞い）
 * 前提：§8.6 の初期データ（resetToSeed）。テストは順番に依存するため serial
 */
import { test, expect } from "@playwright/test";
import { E2E, adminSql, loginViaMagicLink, readState, requireState, resetToSeed, saveScreenshot, setMonthClosed, toast, yen } from "./helpers";

test.describe.configure({ mode: "serial" });

const MONTH = "2026-09";
const CLIENT = "銀行テスト運輸株式会社";

function clearBank(): void {
  const { companyId } = requireState();
  adminSql(
    `delete from public.bank_transactions where company_id = '${companyId}';
     delete from public.bank_imports where company_id = '${companyId}';
     delete from public.invoice_items where company_id = '${companyId}';
     delete from public.invoices where company_id = '${companyId}';
     update public.projects set client_id = null, client_name = '' where company_id = '${companyId}';
     delete from public.clients where company_id = '${companyId}';`,
  );
}

/** 三郷Amazon に取引先を付けて 2026-09 の請求書を作り、発行済みにする */
function seedInvoice(): { total: number; issueDate: string } {
  const { companyId } = requireState();
  adminSql(
    `insert into public.clients (company_id, name) values ('${companyId}', '${CLIENT}') on conflict (company_id, name) do nothing;
     update public.projects set client_id = (select id from public.clients where company_id = '${companyId}' and name = '${CLIENT}')
      where company_id = '${companyId}' and name = '三郷Amazon';`,
  );
  adminSql(
    `select set_config('request.jwt.claims', json_build_object('sub', (select id from public.profiles where company_id = '${companyId}' and role = 'owner' limit 1), 'role', 'authenticated')::text, false);
     select public.build_invoice((select id from public.clients where company_id = '${companyId}' and name = '${CLIENT}'), '2026-09-01');
     select public.set_invoice_status((select id from public.invoices where company_id = '${companyId}' and month = '2026-09-01'), 'issued');`,
  );
  const out = adminSql(`select total::text || '|' || issue_date::text from public.invoices where company_id = '${companyId}' and month = '2026-09-01';`);
  const line = out.split("\n").map((l) => l.trim()).find((l) => l.includes("|")) ?? "";
  const [total, issueDate] = line.split("|");
  return { total: Number(total), issueDate };
}

test.beforeEach(async () => {
  const state = readState();
  test.skip(!state || state.appSkipped, "E2E_SKIP_APP=1 のため Next.js を起動していません");
});

test.describe("銀行 CSV の取り込みと入金消込", () => {
  let invoiceTotal = 0;
  let payDate = "";

  test.beforeAll(async () => {
    const state = readState();
    if (!state || state.appSkipped) return;
    await resetToSeed();
    await setMonthClosed(MONTH, false);
    clearBank();
    const inv = seedInvoice();
    invoiceTotal = inv.total;
    const d = new Date(`${inv.issueDate}T00:00:00Z`);
    d.setUTCDate(d.getUTCDate() + 30);
    payDate = d.toISOString().slice(0, 10);
  });

  test.afterAll(async () => {
    const state = readState();
    if (!state || state.appSkipped) return;
    clearBank();
  });

  test("CSV を取り込むと自動で請求書に消し込まれる", async ({ page }, testInfo) => {
    await loginViaMagicLink(page, E2E.users.owner.email, "/bank");
    await expect(page.getByRole("heading", { name: "入金の消込" })).toBeVisible();

    const ymd = payDate.replace(/-/g, "/");
    const csv = [
      "日付,お取引内容,お預入金額,お支払金額,残高",
      `${ymd},カ）ギンコウテストウンユ,${invoiceTotal},,3000000`,
      `${ymd},デンキダイ,,18000,2982000`,
      "",
    ].join("\r\n");

    await page.setInputFiles("#bank-csv-file", { name: "meisai.csv", mimeType: "text/csv", buffer: Buffer.from(csv, "utf8") });
    await page.getByRole("button", { name: /取り込む/ }).click();
    await expect(toast(page, /取り込みました|件/)).toBeVisible();

    // 結果はトーストと画面上部の両方に出るので先頭だけを見る
    await expect(page.getByText(/2 件を取り込み/).first()).toBeVisible();
    await expect(page.getByText(/1 件を自動で消し込み/).first()).toBeVisible();
    if (testInfo.project.name === "mobile") await saveScreenshot(page, "bank-mobile.png");

    // 請求書が入金済みになっている
    await page.goto(`${E2E.appUrl}/invoices?m=${MONTH}`);
    await expect(page.getByText("入金済み").first()).toBeVisible();
  });

  test("同じ CSV をもう一度入れても二重にならない", async ({ page }) => {
    await loginViaMagicLink(page, E2E.users.owner.email, "/bank");
    const ymd = payDate.replace(/-/g, "/");
    const csv = [
      "日付,お取引内容,お預入金額,お支払金額,残高",
      `${ymd},カ）ギンコウテストウンユ,${invoiceTotal},,3000000`,
      `${ymd},デンキダイ,,18000,2982000`,
      "",
    ].join("\r\n");
    await page.setInputFiles("#bank-csv-file", { name: "meisai.csv", mimeType: "text/csv", buffer: Buffer.from(csv, "utf8") });
    await page.getByRole("button", { name: /取り込む/ }).click();
    await expect(page.getByText(/2 件は取り込み済み|0 件を取り込み/).first()).toBeVisible();

    const { companyId } = requireState();
    expect(adminSql(`select count(*) from public.bank_transactions where company_id = '${companyId}';`)).toMatch(/\b2\b/);
  });

  test("消込を外すと請求書が発行済みに戻り、出金は対象外にできる", async ({ page }) => {
    await loginViaMagicLink(page, E2E.users.owner.email, "/bank?status=matched");
    await page.getByRole("button", { name: "消込を外す" }).first().click();
    await expect(toast(page, /戻しました|変更しました|外しました/)).toBeVisible();

    await page.goto(`${E2E.appUrl}/invoices?m=${MONTH}`);
    await expect(page.getByText("発行済み").first()).toBeVisible();

    await page.goto(`${E2E.appUrl}/bank?status=unmatched`);
    await expect(page.getByText(yen(-18000)).first()).toBeVisible();
    await page.getByRole("button", { name: "対象外にする" }).last().click();
    await expect(toast(page, /対象外|変更しました/)).toBeVisible();
  });

  test("CSV をダウンロードでき、閲覧者は操作ボタンが出ない", async ({ page }) => {
    await loginViaMagicLink(page, E2E.users.owner.email, "/bank?status=all");
    const [download] = await Promise.all([page.waitForEvent("download"), page.getByRole("link", { name: "CSV" }).click()]);
    const stream = await download.createReadStream();
    const chunks: Buffer[] = [];
    for await (const c of stream) chunks.push(Buffer.from(c));
    const csv = Buffer.concat(chunks).toString("utf8");
    expect(csv).toContain("日付");
    expect(csv).toContain("デンキダイ");

    await loginViaMagicLink(page, E2E.users.viewer.email, "/bank?status=all");
    await expect(page.getByRole("heading", { name: "入金の消込" })).toBeVisible();
    await expect(page.getByRole("button", { name: /取り込む/ })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "対象外にする" })).toHaveCount(0);
  });
});

test.describe("AI の画面", () => {
  test("API キーが未設定でも画面は開き、案内が出る", async ({ page }) => {
    await loginViaMagicLink(page, E2E.users.owner.email, `/ai?m=${MONTH}`);
    await expect(page.getByRole("heading", { name: /AI/ }).first()).toBeVisible();
    // キーが無い環境では案内、ある環境では入力欄が出る（どちらでも壊れないこと）
    const hint = page.getByText(/ANTHROPIC_API_KEY/);
    const ask = page.getByRole("button", { name: /聞く|送信|相談/ });
    await expect(hint.or(ask).first()).toBeVisible();
  });
});
