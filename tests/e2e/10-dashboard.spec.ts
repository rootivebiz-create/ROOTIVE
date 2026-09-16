/**
 * ダッシュボード（§4.1）：KPI・ドライバー別サマリー・警告・利益の推移
 * 前提：§8.6 の初期データ（resetToSeed で毎回揃える）
 */
import { test, expect } from "@playwright/test";
import { E2E, kpiCard, loginViaMagicLink, readState, resetToSeed, saveScreenshot, yen } from "./helpers";

const SEED_DRIVERS_WITH_ENTRIES = ["相曽慧", "金島幸太", "沼田基", "今井皇輝", "石田泰典", "黒岩亜夢莉", "藤田裕介", "川島幹太"];

test.beforeEach(async () => {
  const state = readState();
  test.skip(!state || state.appSkipped, "E2E_SKIP_APP=1 のため Next.js を起動していません");
});

test.describe("ダッシュボード", () => {
  test.beforeAll(async () => {
    const state = readState();
    if (!state || state.appSkipped) return;
    await resetToSeed();
  });

  test("2026年9月の KPI・ドライバー別表（8 名）・警告・推移グラフが表示される", async ({ page }, testInfo) => {
    await loginViaMagicLink(page, E2E.users.owner.email, "/dashboard?m=2026-09");
    await expect(page.getByRole("heading", { name: "ダッシュボード" })).toBeVisible();
    await expect(page.getByText("2026年9月 の経営状況")).toBeVisible();

    // KPI 4 つ（§2.6 の合計）
    await expect(kpiCard(page, "会社売上")).toContainText(yen(2559573));
    await expect(kpiCard(page, "会社利益")).toContainText(yen(652490.3));
    await expect(kpiCard(page, "ドライバー支払合計")).toContainText(yen(1907083));
    await expect(kpiCard(page, "利益率")).toContainText("25.5%");

    // ドライバー別サマリー：稼働のある 8 名 ＋ 合計行
    const summary = page.locator("div.rounded-lg").filter({ has: page.getByRole("heading", { name: "ドライバー別サマリー" }) });
    const rows = summary.locator('a[href*="/statement"]').filter({ visible: true });
    await expect(rows).toHaveCount(8);
    for (const name of SEED_DRIVERS_WITH_ENTRIES) await expect(rows.filter({ hasText: name })).toHaveCount(1);
    await expect(summary).toContainText("合計");
    await expect(summary).toContainText(yen(1907083));

    // 警告：管理費の不一致（相曽慧 14,999 ≠ 15,000）と稼働ゼロ（吉田雅一・高森豪介）
    const warnings = page.getByRole("alert").filter({ hasText: "確認が必要な項目" });
    await expect(warnings).toBeVisible();
    await expect(warnings).toContainText("今月の管理費がドライバーの標準と異なります");
    const mismatch = warnings.getByRole("link", { name: /相曽慧/ });
    await expect(mismatch).toContainText(yen(14999));
    await expect(mismatch).toContainText(yen(15000));
    await expect(warnings).toContainText("稼働中なのに今月の稼働がないドライバーが 2 名います");
    await expect(warnings.getByRole("link", { name: "吉田雅一、高森豪介" })).toBeVisible();

    // 利益の推移（recharts の SVG）
    await expect(page.getByRole("heading", { name: "会社利益の推移" })).toBeVisible();
    await expect(page.locator("svg.recharts-surface").first()).toBeVisible();

    await saveScreenshot(page, `dashboard-${testInfo.project.name}.png`);

    // 行タップで支払明細へ
    await rows.filter({ hasText: "相曽慧" }).click();
    await expect(page).toHaveURL(/\/payouts\/[0-9a-f-]{36}\/statement\?m=2026-09/);
    await expect(page.getByRole("heading", { name: "相曽慧 様 2026年9月 支払明細" })).toBeVisible();
  });

  test("未来月は「予定」、データの無い月は空表示になる", async ({ page }) => {
    await loginViaMagicLink(page, E2E.users.owner.email, "/dashboard?m=2026-11");
    await expect(page.getByText("2026年11月 の経営状況")).toBeVisible();
    await expect(page.getByText("予定").first()).toBeVisible();
    await expect(kpiCard(page, "会社売上")).toContainText(yen(0));
    await expect(page.getByText("この月のドライバー別データはありません")).toBeVisible();
  });
});
