/**
 * 経費（0009）：登録・カテゴリ別の集計・毎月かかる経費の計上・CSV・締め済み月・閲覧者
 * 前提：§8.6 の初期データ（resetToSeed）。テストは順番に依存するため serial
 */
import { test, expect } from "@playwright/test";
import { E2E, adminSql, kpiCard, listRow, loginViaMagicLink, readState, requireState, resetToSeed, saveScreenshot, setMonthClosed, toast, yen } from "./helpers";

test.describe.configure({ mode: "serial" });

const MONTH = "2026-09";

/** テストで作る経費・毎月かかる経費を消す（何度流しても同じ結果になるように） */
function clearExpenses(): void {
  const { companyId } = requireState();
  adminSql(
    `select set_config('app.bypass_closing', 'on', true);
     delete from public.expenses where company_id = '${companyId}';
     delete from public.recurring_expenses where company_id = '${companyId}';`,
  );
}

test.beforeEach(async () => {
  const state = readState();
  test.skip(!state || state.appSkipped, "E2E_SKIP_APP=1 のため Next.js を起動していません");
});

test.describe("経費", () => {
  test.beforeAll(async () => {
    const state = readState();
    if (!state || state.appSkipped) return;
    await resetToSeed();
    await setMonthClosed(MONTH, false);
    clearExpenses();
  });

  test.afterAll(async () => {
    const state = readState();
    if (!state || state.appSkipped) return;
    await setMonthClosed(MONTH, false);
    clearExpenses();
  });

  test("経費を追加すると一覧・カテゴリ別の小計・合計に反映される", async ({ page }, testInfo) => {
    await loginViaMagicLink(page, E2E.users.owner.email, `/expenses?m=${MONTH}`);
    await expect(page.getByRole("heading", { name: "経費" })).toBeVisible();
    await expect(page.getByText("まだ経費がありません")).toBeVisible();

    // 変動費（燃料費 50,000）
    await page.getByRole("button", { name: "経費を追加" }).first().click();
    const dialog = page.getByRole("dialog");
    await expect(dialog.getByRole("heading", { name: "経費を追加" })).toBeVisible();
    await dialog.getByLabel("カテゴリ").selectOption({ label: "燃料費" });
    await dialog.getByLabel("内容").fill("ガソリン代");
    await dialog.getByLabel("金額（税抜）").fill("50,000");
    await dialog.getByRole("button", { name: "保存", exact: true }).click();
    await expect(toast(page, /保存しました|追加しました/)).toBeVisible();

    // 固定費（車両リース・レンタル 120,000）
    await page.getByRole("button", { name: "経費を追加" }).first().click();
    const dialog2 = page.getByRole("dialog");
    await dialog2.getByLabel("カテゴリ").selectOption({ label: "車両リース・レンタル" });
    await dialog2.getByLabel("内容").fill("軽バン 3 台");
    await dialog2.getByLabel("金額（税抜）").fill("120000");
    await dialog2.getByLabel("支払先（任意）").fill("テストリース株式会社");
    await dialog2.getByRole("button", { name: "保存", exact: true }).click();
    await expect(toast(page, /保存しました|追加しました/)).toBeVisible();

    await expect(page.getByText("2026年9月の経費 2 件")).toBeVisible();
    await expect(kpiCard(page, "固定費")).toContainText(yen(120000));
    await expect(kpiCard(page, "変動費")).toContainText(yen(50000));
    await expect(kpiCard(page, "経費合計")).toContainText(yen(170000));
    await expect(listRow(page, "ガソリン代").first()).toContainText(yen(50000));
    await expect(listRow(page, "軽バン 3 台").first()).toContainText("テストリース株式会社");
    if (testInfo.project.name === "mobile") await saveScreenshot(page, "expenses-mobile.png");
  });

  test("ダッシュボードに経費と営業利益（会社利益 − 経費）が出る", async ({ page }) => {
    await loginViaMagicLink(page, E2E.users.owner.email, `/dashboard?m=${MONTH}`);
    // 初期データの会社利益 652,490.3 − 経費 170,000 = 482,490.3
    await expect(kpiCard(page, "経費")).toContainText(yen(170000));
    await expect(kpiCard(page, "営業利益")).toContainText(yen(482490.3));
  });

  test("毎月かかる経費を設定してその月に計上できる（二重計上しない）", async ({ page }) => {
    await loginViaMagicLink(page, E2E.users.owner.email, `/settings/expenses?m=${MONTH}`);
    await expect(page.getByRole("heading", { name: "経費の設定" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "経費カテゴリ" })).toBeVisible();

    await page.getByRole("button", { name: "毎月かかる経費を追加" }).click();
    await page.getByLabel("カテゴリ").last().selectOption({ label: "保険料" });
    await page.getByLabel("内容").last().fill("自動車保険");
    await page.getByLabel("金額（税抜）").last().fill("30000");
    await page.getByRole("button", { name: "毎月かかる経費を保存" }).click();
    await expect(toast(page, /保存しました/)).toBeVisible();

    await page.goto(`${E2E.appUrl}/expenses?m=${MONTH}`);
    await page.getByRole("button", { name: "毎月かかる経費をこの月に計上" }).first().click();
    await page.getByRole("button", { name: "計上する" }).click();
    await expect(toast(page, /1 件/)).toBeVisible();
    await expect(page.getByText("2026年9月の経費 3 件")).toBeVisible();
    await expect(kpiCard(page, "経費合計")).toContainText(yen(200000));

    // 2 回目は増えない
    await page.getByRole("button", { name: "毎月かかる経費をこの月に計上" }).first().click();
    await page.getByRole("button", { name: "計上する" }).click();
    await expect(toast(page, /計上が必要な経費はありませんでした|0 件/)).toBeVisible();
    await expect(page.getByText("2026年9月の経費 3 件")).toBeVisible();
  });

  test("経費 CSV をダウンロードできる", async ({ page }) => {
    await loginViaMagicLink(page, E2E.users.owner.email, `/expenses?m=${MONTH}`);
    const [download] = await Promise.all([page.waitForEvent("download"), page.getByRole("link", { name: "CSV" }).click()]);
    const stream = await download.createReadStream();
    const chunks: Buffer[] = [];
    for await (const c of stream) chunks.push(Buffer.from(c));
    const csv = Buffer.concat(chunks).toString("utf8");
    expect(csv).toContain("カテゴリ");
    expect(csv).toContain("ガソリン代");
    expect(csv).toContain("50000");
    expect(csv).toContain("自動車保険");
  });

  test("締め済み月は編集できない／閲覧者は追加できない", async ({ page }) => {
    await setMonthClosed(MONTH, true);
    await loginViaMagicLink(page, E2E.users.owner.email, `/expenses?m=${MONTH}`);
    await expect(page.getByText("締め済み").first()).toBeVisible();
    await expect(page.getByRole("button", { name: "経費を追加" })).toHaveCount(0);
    await expect(page.getByText(/この月は締め済みのため/)).toBeVisible();
    await setMonthClosed(MONTH, false);

    await loginViaMagicLink(page, E2E.users.viewer.email, `/expenses?m=${MONTH}`);
    await expect(page.getByRole("heading", { name: "経費" })).toBeVisible();
    await expect(listRow(page, "ガソリン代").first()).toBeVisible();
    await expect(page.getByRole("button", { name: "経費を追加" })).toHaveCount(0);
  });
});
