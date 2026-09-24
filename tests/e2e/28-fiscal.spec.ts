/**
 * 期（事業年度。0030・0031）：
 *   月の切り替えを押すと期ごとの 12 か月が並ぶ（前の期・次の期・今期へ・月をひと押し）→
 *   年次レポートは期で開き、暦年と切り替えられる（出力も期のまま）→ 会社設定の設立日と今の期 →
 *   財務の予算・借入・税務も期で → 中期計画は期で数え、期の月へ配る。
 *
 * 前提：§8.6 の初期データ（2026年9月に稼働 10 行）。9 月決算・2024-04-15 設立にして確かめ、終わったら戻す
 */
import { test, expect, type Page } from "@playwright/test";
import { E2E, adminSql, listRow, loginViaMagicLink, readState, requireState, resetToSeed, saveScreenshot, toast, yen } from "./helpers";

test.describe.configure({ mode: "serial" });

const MONTH = "2026-09";
const PLAN_ID = "28f15ca1-7e2d-4b6a-9c3e-5d0a1b2c3d4e";

function setFiscal(fiscalMonth: number, establishedOn: string | null): void {
  const { companyId } = requireState();
  adminSql(
    `update public.companies set fiscal_month = ${fiscalMonth}, established_on = ${establishedOn ? `'${establishedOn}'` : "null"} where id = '${companyId}'`,
  );
}

async function openPicker(page: Page) {
  await page.getByRole("button", { name: "稼動月を選択" }).click();
  const dialog = page.getByRole("dialog", { name: "月を選ぶ" });
  await expect(dialog).toBeVisible();
  return dialog;
}

test.beforeEach(async () => {
  const state = readState();
  test.skip(!state || state.appSkipped, "E2E_SKIP_APP=1 のため Next.js を起動していません");
});

test.describe("期で見る", () => {
  test.beforeAll(async () => {
    const state = readState();
    if (!state || state.appSkipped) return;
    await resetToSeed();
    setFiscal(9, "2024-04-15");
  });

  test.afterAll(() => {
    const state = readState();
    if (!state || state.appSkipped) return;
    const { companyId } = requireState();
    adminSql(`delete from public.plans where id = '${PLAN_ID}'; delete from public.month_targets where company_id = '${companyId}';`);
    setFiscal(3, null);
  });

  test("月の切り替えは期ごとの 12 か月から選べる", async ({ page }, testInfo) => {
    await loginViaMagicLink(page, E2E.users.owner.email, `/entries?m=${MONTH}`);
    const dialog = await openPicker(page);

    // 2026年9月が入る期（9 月決算・2024年4月設立 → 第3期）
    await expect(dialog.getByTestId("period-label")).toContainText("第3期");
    await expect(dialog.getByText("2025年10月〜2026年9月")).toBeVisible();
    await expect(dialog.locator("[data-month]")).toHaveCount(12);
    await expect(dialog.locator('[data-month="2026-09"]')).toHaveAttribute("aria-selected", "true");
    // データのある月は売上の目安（万）が出る。期の合計も出る
    await expect(dialog.locator('[data-month="2026-09"]')).toContainText("255万");
    await expect(dialog.getByText(yen(2559573))).toBeVisible();
    if (testInfo.project.name === "mobile") await saveScreenshot(page, "month-picker-mobile.png");

    // 前の期・次の期
    await dialog.getByRole("button", { name: "前の期" }).click();
    await expect(dialog.getByTestId("period-label")).toContainText("第2期");
    await expect(dialog.getByText("2024年10月〜2025年9月")).toBeVisible();
    await dialog.getByRole("button", { name: "前の期" }).click();
    // 第1期は設立の月（2024年4月）から 6 か月
    await expect(dialog.getByTestId("period-label")).toContainText("第1期");
    await expect(dialog.locator("[data-month]")).toHaveCount(6);
    await dialog.getByRole("button", { name: "次の期" }).click();
    await dialog.getByRole("button", { name: "次の期" }).click();
    await dialog.getByRole("button", { name: "次の期" }).click();
    await expect(dialog.getByTestId("period-label")).toContainText("第4期");

    // 月をひと押しで選ぶと、その月が開く
    await dialog.getByRole("button", { name: "前の期" }).click();
    await dialog.locator('[data-month="2026-03"]').click();
    await expect(page).toHaveURL(/m=2026-03/, { timeout: 30_000 });
    await expect(page.getByRole("button", { name: "稼動月を選択" })).toContainText("2026年3月");
  });

  test("年次レポートは期で開き、暦年と切り替えられる（出力も期のまま）", async ({ page }, testInfo) => {
    await loginViaMagicLink(page, E2E.users.owner.email, `/reports?m=${MONTH}`);
    await expect(page.getByRole("heading", { name: "年次レポート" })).toBeVisible();
    await expect(page.getByText("第3期（2025年10月〜2026年9月）の推移")).toBeVisible();
    await expect(page.getByLabel("表示する期")).toBeVisible();
    await expect(page.getByText(yen(2559573)).first()).toBeVisible();
    await expect(page.getByText("第3期の合計").first()).toBeVisible();
    await expect(page.getByRole("heading", { name: "前期比" })).toBeVisible();
    if (testInfo.project.name === "mobile") await saveScreenshot(page, "reports-fiscal-mobile.png");

    // 出力は期のまま（2025年10月〜2026年9月の 12 行）
    const csvHref = await page.getByRole("link", { name: "CSV" }).getAttribute("href");
    expect(csvHref).toContain("fy=2026");
    const csv = await page.request.get(csvHref ?? "");
    expect(csv.status()).toBe(200);
    const text = await csv.text();
    expect(text).toContain("2025-10");
    expect(text).toContain("2026-09");
    expect(text).not.toContain("2026-10");

    // 暦年で見る → 2026年（1〜12 月）
    await page.getByRole("radio", { name: "暦年で見る" }).click();
    await expect(page).toHaveURL(/[?&]y=2026/, { timeout: 30_000 });
    await expect(page.getByLabel("表示する年")).toBeVisible();
    await expect(page.getByRole("heading", { name: "前年比" })).toBeVisible();

    // 期で見る に戻し、前の期へ
    await page.getByRole("radio", { name: "期で見る" }).click();
    await expect(page).toHaveURL(/[?&]fy=2026/, { timeout: 30_000 });
    await page.getByRole("link", { name: "前の期" }).click();
    await expect(page).toHaveURL(/[?&]fy=2025/, { timeout: 30_000 });
    await expect(page.getByText("第2期のデータはありません")).toBeVisible();
  });

  test("財務の予算は期で開き、借入は今期・税務は決算を迎える期が分かる", async ({ page }, testInfo) => {
    const { companyId } = requireState();
    adminSql(`delete from public.month_targets where company_id = '${companyId}';`);
    await loginViaMagicLink(page, E2E.users.owner.email, "/finance?fy=2026");
    await expect(page.getByRole("heading", { name: "財務" })).toBeVisible();
    await expect(page.getByLabel("表示する期")).toBeVisible();
    await expect(page.getByText("第3期（2025年10月〜2026年9月）の売上（目標と実績）")).toBeVisible();
    // 期の月は 2025年10月から 2026年9月まで（2 つの暦年にまたがる）
    await expect(page.getByLabel("2025年10月の売上の目標")).toBeVisible();
    const target = page.getByLabel("2026年9月の売上の目標");
    await target.fill("2000000");
    await page.getByRole("button", { name: /まとめて保存/ }).click();
    await expect(toast(page, /予算を保存しました/)).toBeVisible();
    expect(adminSql(`select bill_target::bigint from public.month_targets where company_id = '${companyId}' and month = '2026-09-01';`)).toMatch(/2000000/);
    await expect(listRow(page, "第3期の合計").first()).toContainText("2,559,573");
    await expect(listRow(page, "第3期の合計").first()).toContainText("128.0%");
    if (testInfo.project.name === "mobile") await saveScreenshot(page, "finance-budget-fiscal-mobile.png");

    // かんたん入力は前期（第2期）の実績から
    await page.getByRole("button", { name: "かんたん入力" }).click();
    const quick = page.getByRole("dialog", { name: /かんたん入力/ });
    await expect(quick.getByText("前期実績 ＋ ◯%")).toBeVisible();
    await expect(quick.getByText("第2期の実績がないため使えません。")).toBeVisible();
    await quick.getByRole("button", { name: "閉じる" }).first().click();

    // 借入の要約は今期
    await page.goto("/finance?tab=loans");
    await expect(page.getByText("今期の返済")).toBeVisible();
    await expect(page.getByText(/期日が第\d+期（\d{4}年\d{1,2}月〜\d{4}年\d{1,2}月）の合計/)).toBeVisible();

    // 税務は期限の年ごと。その年に決算を迎える期が分かる
    await page.goto("/finance?tab=tax&y=2026");
    await expect(page.getByText(/2026年に決算を迎えるのは第3期（2025年10月〜2026年9月）/)).toBeVisible();
    await expect(page.getByLabel("対象年")).toContainText("2026年（第3期の決算）");
  });

  test("中期計画は期で数え、期の実績と月への配分が出る", async ({ page }, testInfo) => {
    const { companyId } = requireState();
    adminSql(
      `delete from public.month_targets where company_id = '${companyId}';
       insert into public.plans (id, company_id, name, from_year, to_year) values ('${PLAN_ID}', '${companyId}', 'E2E 期の計画', 2026, 2027) on conflict (id) do nothing;
       insert into public.plan_years (plan_id, year, bill_target, profit_target, driver_target) values ('${PLAN_ID}', 2026, 3000000, 600000, 8), ('${PLAN_ID}', 2027, 0, 0, 0) on conflict (plan_id, year) do nothing;`,
    );
    await loginViaMagicLink(page, E2E.users.owner.email, `/executive/plan?plan=${PLAN_ID}`);
    await expect(page.getByRole("heading", { name: "中期計画" })).toBeVisible();
    await expect(page.getByTestId("plan-range")).toContainText("第3期〜第4期（2025年10月〜2027年9月）");
    // 第3期の実績は 2025年10月〜2026年9月の合計
    const row = listRow(page, "2025年10月〜2026年9月").first();
    await expect(row).toContainText("第3期");
    await expect(row).toContainText("2,559,573");
    if (testInfo.project.name === "mobile") await saveScreenshot(page, "executive-plan-fiscal-mobile.png");

    // 期の目標を期の月へ配る（均等なら 1 か月 250,000）
    await row.getByRole("button", { name: "月へ配る" }).click();
    const dialog = page.getByRole("dialog", { name: "第3期の目標を月へ配る" });
    await expect(dialog).toBeVisible();
    await expect(dialog.getByText(/2025年10月〜2026年9月の月次目標/)).toBeVisible();
    await dialog.getByRole("button", { name: "月へ配る" }).click();
    await expect(toast(page, /期の目標を月へ配りました/)).toBeVisible();
    expect(
      adminSql(`select sum(bill_target)::bigint || '/' || count(*) from public.month_targets where company_id = '${companyId}' and month between '2025-10-01' and '2026-09-01' and bill_target <> 0;`),
    ).toBe("3000000/12");
    expect(adminSql(`select bill_target::bigint from public.month_targets where company_id = '${companyId}' and month = '2025-10-01';`)).toBe("250000");
  });

  test("会社設定で設立日を入れると、今の期が分かる", async ({ page }) => {
    await loginViaMagicLink(page, E2E.users.owner.email, "/settings/company");
    await expect(page.getByLabel("設立日")).toHaveValue("2024-04-15");
    await expect(page.getByTestId("fiscal-preview")).toContainText(/第\d+期（\d{4}年\d{1,2}月〜\d{4}年\d{1,2}月）/);
    // 設立日を消すと「YYYY年9月期」の呼び方になる
    await page.getByLabel("設立日").fill("");
    await expect(page.getByTestId("fiscal-preview")).toContainText(/\d{4}年9月期/);
  });
});
