/**
 * 支払明細（§4.3）・案件別（§4.4）：一覧 → 明細、管理費・調整の編集、テキストコピー、CSV／PDF／印刷用ページ
 * 前提：§8.6 の初期データ（resetToSeed）。テストは順番に依存するため serial
 */
import { test, expect } from "@playwright/test";
import { E2E, adminSql, driverIdByName, listRow, loginViaMagicLink, readState, requireState, resetToSeed, saveScreenshot, toast, yen } from "./helpers";

test.describe.configure({ mode: "serial" });

test.beforeEach(async () => {
  const state = readState();
  test.skip(!state || state.appSkipped, "E2E_SKIP_APP=1 のため Next.js を起動していません");
});

test.describe("支払明細", () => {
  let driverId = "";
  const statementUrl = () => `/payouts/${driverId}/statement?m=2026-09`;
  const payoutSection = (page: import("@playwright/test").Page) => page.locator("section").filter({ hasText: "お支払額" }).first();

  test.beforeAll(async () => {
    const state = readState();
    if (!state || state.appSkipped) return;
    await resetToSeed();
    driverId = driverIdByName("相曽慧");
  });

  test.afterAll(async () => {
    // 相曽慧の 2026-09 を初期状態（管理費 14,999・調整なし）に戻す（後続 spec の前提）
    const state = readState();
    if (!state || state.appSkipped || !driverId) return;
    try {
      const { companyId } = requireState();
      adminSql(
        `delete from public.adjustments a using public.driver_months dm
          where a.driver_month_id = dm.id and dm.company_id = '${companyId}' and dm.month = '2026-09-01' and dm.driver_id = '${driverId}';
         update public.driver_months set mgmt_fee = 14999 where company_id = '${companyId}' and month = '2026-09-01' and driver_id = '${driverId}';`,
      );
    } catch {
      // 締め済みなどで戻せなくても、後続の spec は自分で前提を揃える
    }
  });

  test.beforeEach(async ({ page }) => {
    await loginViaMagicLink(page, E2E.users.owner.email, "/payouts?m=2026-09");
  });

  test("一覧（相曽慧 支払 ¥396,643）→ 明細ページ（お支払額・振込予定日・会社側の内訳）", async ({ page }) => {
    await expect(page.getByRole("heading", { name: "支払明細" })).toBeVisible();
    await expect(page.getByText("2026年9月 のドライバー別の支払額と会社利益")).toBeVisible();
    await expect(listRow(page, "相曽慧")).toContainText(yen(396643));
    await expect(listRow(page, /合計/)).toContainText(yen(1907083));

    await page.getByRole("link", { name: /相曽慧/ }).first().click();
    await expect(page).toHaveURL(new RegExp(`/payouts/${driverId}/statement`));
    await expect(page.getByRole("heading", { name: "相曽慧 様 2026年9月 支払明細" })).toBeVisible();

    // 稼働明細：三郷Amazon 21日 × ¥21,780 ＝ ¥457,380、ロイヤリティ 10%、管理費 14,999（標準と異なる）
    await expect(page.getByText("21日 × ¥21,780")).toBeVisible();
    await expect(page.getByText("ドライバー売上（小計）")).toBeVisible();
    await expect(page.getByText(yen(-45738))).toBeVisible();
    await expect(page.getByText(yen(-14999))).toBeVisible();
    await expect(page.getByText(/ドライバー標準 ¥15,000 と異なります/)).toBeVisible();

    const payout = payoutSection(page);
    await expect(payout).toContainText(yen(396643));
    await expect(payout).toContainText("振込予定日：2026年10月31日");

    const breakdown = page.locator("div.rounded-lg").filter({ has: page.getByRole("heading", { name: "会社側の内訳" }) });
    await expect(breakdown).toContainText("ドライバーには表示されません");
    await expect(breakdown).toContainText(yen(483525)); // 会社売上
    await expect(breakdown).toContainText(yen(86882)); // 会社利益
    await expect(breakdown).toContainText("18.0%"); // 利益率
  });

  test("「管理費・調整を編集」：管理費 15,000・リース代 −30,000（利益計上）→ お支払額 ¥366,642", async ({ page }, testInfo) => {
    await page.goto(statementUrl());
    await page.getByRole("button", { name: "管理費・調整を編集" }).click();
    const dialog = page.getByRole("dialog");
    await expect(dialog.getByRole("heading", { name: "管理費・調整を編集" })).toBeVisible();

    const fee = dialog.getByLabel("管理費", { exact: true });
    await expect(fee).toHaveValue("14999");
    await fee.fill("15000");

    await dialog.getByRole("button", { name: "調整を追加" }).click();
    await dialog.getByLabel("調整 1 の項目名").fill("リース代");
    await dialog.getByLabel("控除か加算か").selectOption("deduct");
    await dialog.getByLabel("調整 1 の金額").fill("30000");
    await expect(dialog.getByRole("checkbox", { name: "会社利益に計上する" })).toBeChecked();

    // プレビュー：457,380 − 45,738 − 15,000 − 30,000
    await expect(dialog.getByText(yen(366642))).toBeVisible();
    await dialog.getByRole("button", { name: "保存", exact: true }).click();
    await expect(toast(page, "保存しました")).toBeVisible();

    await expect(payoutSection(page)).toContainText(yen(366642));
    await expect(page.getByText("リース代").first()).toBeVisible();
    await expect(page.getByText(/ドライバー標準 ¥15,000 と異なります/)).toHaveCount(0);
    const breakdown = page.locator("div.rounded-lg").filter({ has: page.getByRole("heading", { name: "会社側の内訳" }) });
    await expect(breakdown).toContainText(yen(116883)); // 会社利益 26,145 + 45,738 + 15,000 + 30,000
    if (testInfo.project.name === "mobile") await saveScreenshot(page, "statement-mobile.png");
  });

  test("「明細テキストをコピー」でクリップボードに LINE 用テキストが入る", async ({ page, context }) => {
    await context.grantPermissions(["clipboard-read", "clipboard-write"]);
    await page.goto(statementUrl());
    await page.getByRole("button", { name: "明細テキストをコピー" }).click();
    await expect(toast(page, "明細テキストをコピーしました")).toBeVisible();
    const text = await page.evaluate(() => navigator.clipboard.readText());
    expect(text).toContain("【2026年9月 支払明細】");
    expect(text).toContain("相曽慧 様");
    expect(text).toContain(E2E.companyName);
    expect(text).toContain(`・三郷Amazon：21日 × ${yen(21780)} ＝ ${yen(457380)}`);
    expect(text).toContain(`稼働小計：${yen(457380)}`);
    expect(text).toContain(`・ロイヤリティ（10.0%）：${yen(-45738)}`);
    expect(text).toContain(`・管理費：${yen(-15000)}`);
    expect(text).toContain(`・リース代：${yen(-30000)}`);
    expect(text).toContain(`■ お支払額：${yen(366642)}`);
    expect(text).toContain("振込予定日：2026年10月31日");
    expect(text).not.toContain("会社利益");
  });

  test("個人明細 CSV（BOM 付き）・PDF（%PDF、10KB 超）・印刷用ページ", async ({ page }) => {
    const csv = await page.request.get(`/api/export/statement.csv?m=2026-09&driver=${driverId}`);
    expect(csv.status()).toBe(200);
    expect(csv.headers()["content-type"]).toContain("text/csv");
    const csvBody = await csv.body();
    expect([...csvBody.subarray(0, 3)]).toEqual([0xef, 0xbb, 0xbf]);
    const csvText = csvBody.toString("utf8").replace(/^﻿/, "");
    expect(csvText).toContain("種別,案件,内容,数量,単価,金額,備考");
    expect(csvText).toMatch(/^稼働,三郷Amazon,標準,21,21780,457380,/m);
    expect(csvText).toMatch(/^調整,,リース代,,,-30000,/m);
    expect(csvText).toMatch(/^支払額,,,,,366642,振込予定日 2026年10月31日/m);
    expect(csvText).not.toContain("会社利益");

    const pdf = await page.request.get(`/api/export/statement.pdf?m=2026-09&driver=${driverId}`);
    expect(pdf.status()).toBe(200);
    expect(pdf.headers()["content-type"]).toContain("application/pdf");
    const pdfBody = await pdf.body();
    expect(pdfBody.subarray(0, 4).toString("latin1")).toBe("%PDF");
    expect(pdfBody.length).toBeGreaterThan(10 * 1024);

    await page.goto(`/payouts/${driverId}/print?m=2026-09`);
    await expect(page.getByRole("heading", { name: "2026年9月 支払明細書" })).toBeVisible();
    await expect(page.getByRole("button", { name: "印刷" })).toBeVisible();
    const sheet = page.locator("article");
    await expect(sheet).toContainText("相曽慧 様");
    await expect(sheet).toContainText(E2E.companyName);
    await expect(sheet).toContainText(yen(366642));
    await expect(sheet).toContainText("振込予定日：2026年10月31日");
    await expect(sheet).not.toContainText("会社利益");
  });

  test("案件別：当月と全期間の切替", async ({ page }) => {
    await page.goto("/projects?m=2026-09");
    await expect(page.getByRole("heading", { name: "案件別" })).toBeVisible();
    await expect(page.getByRole("tab", { name: "当月" })).toHaveAttribute("aria-selected", "true");
    await expect(page.getByText("2026年9月 の案件（内容）ごとの集計")).toBeVisible();
    // 三郷Amazon：21 + 21 + 8 = 50 日 × 23,025
    await expect(listRow(page, "三郷Amazon")).toContainText(yen(1151250));
    await expect(listRow(page, "和光ヤマト（ネコポス）")).toContainText(yen(37450));
    await expect(listRow(page, /合計/)).toContainText(yen(2559573));

    await page.getByRole("tab", { name: "全期間" }).click();
    await expect(page).toHaveURL(/scope=all/);
    await expect(page.getByRole("tab", { name: "全期間" })).toHaveAttribute("aria-selected", "true");
    await expect(page.getByText("全期間の案件（内容）ごとの集計")).toBeVisible();
    await expect(listRow(page, /合計/)).toContainText(yen(2559573));
    await expect(page.getByText("ドライバー数は月ごとの人数のため、全期間では表示しません")).toBeVisible();
  });
});
