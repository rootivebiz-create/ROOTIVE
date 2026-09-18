/**
 * ナビ・コマンドパレット・ドライバーポータルの速報（0009）
 * 前提：§8.6 の初期データ（resetToSeed）。テストは順番に依存するため serial
 */
import { test, expect } from "@playwright/test";
import { E2E, adminSql, createInvitation, driverIdByName, loginViaInvite, loginViaMagicLink, readState, requireState, resetToSeed, saveScreenshot, setMonthClosed, yen } from "./helpers";

test.describe.configure({ mode: "serial" });

const MONTH = "2026-09";
const DRIVER_EMAIL = "driver-nav@example.com";

test.beforeEach(async () => {
  const state = readState();
  test.skip(!state || state.appSkipped, "E2E_SKIP_APP=1 のため Next.js を起動していません");
});

test.describe("ナビとコマンドパレット", () => {
  test.beforeAll(async () => {
    const state = readState();
    if (!state || state.appSkipped) return;
    await resetToSeed();
    await setMonthClosed(MONTH, false);
  });

  test("PC は 8 項目のサイドナビ、スマホは 5 タブ（メニューに残りが入る）", async ({ page }, testInfo) => {
    await loginViaMagicLink(page, E2E.users.owner.email, `/dashboard?m=${MONTH}`);
    const nav = page.getByRole("navigation", { name: "メインナビゲーション" });

    if (testInfo.project.name === "mobile") {
      // 下タブは 5 つ（ホーム・稼働・支払・請求・メニュー）
      await expect(nav.getByRole("link", { name: "請求" })).toBeVisible();
      await expect(nav.getByRole("link", { name: "経費" })).toHaveCount(0);
      await nav.getByRole("button", { name: "メニュー", exact: true }).click();
      const sheet = page.getByRole("dialog");
      await expect(sheet.getByRole("heading", { name: "メニュー" })).toBeVisible();
      await sheet.getByRole("link", { name: "経費", exact: true }).click();
      await expect(page.getByRole("heading", { name: "経費", exact: true })).toBeVisible();
      await saveScreenshot(page, "menu-sheet-mobile.png", { fullPage: false });
    } else {
      for (const label of ["ホーム", "稼働", "支払", "請求", "経費", "案件", "レポート", "設定"]) {
        await expect(nav.getByRole("link", { name: label, exact: true })).toBeVisible();
      }
      await nav.getByRole("link", { name: "レポート", exact: true }).click();
      await expect(page.getByRole("heading", { name: "年次レポート" })).toBeVisible();
    }
  });

  test("コマンドパレットで画面とドライバーに移動できる", async ({ page }) => {
    await loginViaMagicLink(page, E2E.users.owner.email, `/dashboard?m=${MONTH}`);
    await page.getByRole("button", { name: "検索" }).first().click();
    const dialog = page.getByRole("dialog");
    const box = dialog.getByLabel("検索語");
    await expect(box).toBeVisible();

    await box.fill("けいひ");
    await page.keyboard.press("Enter");
    await expect(page.getByRole("heading", { name: "経費", exact: true })).toBeVisible();

    // ドライバー名でも探せる
    await page.getByRole("button", { name: "検索" }).first().click();
    await page.getByLabel("検索語").fill("相曽");
    await expect(page.getByRole("dialog").getByText("相曽慧").first()).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(page.getByLabel("検索語")).toHaveCount(0);
  });

  test("設定のサブナビに取引先・経費カテゴリが並ぶ", async ({ page }) => {
    await loginViaMagicLink(page, E2E.users.owner.email, `/settings?m=${MONTH}`);
    await expect(page.getByRole("link", { name: "取引先" }).first()).toBeVisible();
    await expect(page.getByRole("link", { name: "経費カテゴリ" }).first()).toBeVisible();
  });
});

test.describe("ドライバーポータルの速報", () => {
  test.beforeAll(async () => {
    const state = readState();
    if (!state || state.appSkipped) return;
    await resetToSeed();
    // 2026-09 を未締めにして「集計中」の速報を出す
    await setMonthClosed(MONTH, false);
    const { companyId } = requireState();
    adminSql(`update public.companies set driver_portal_show_open_month = true where id = '${companyId}';`);
  });

  test("未締め月の暫定額が「集計中」として出る（締め前の注意書きつき）", async ({ page }) => {
    const driverId = driverIdByName("相曽慧");
    const token = createInvitation({ email: DRIVER_EMAIL, role: "driver", driverId, displayName: "相曽慧" });
    await loginViaInvite(page, token);
    await page.goto(`${E2E.appUrl}/driver`);

    await expect(page.getByText("集計中").first()).toBeVisible();
    await expect(page.getByText("お支払予定額（税込）")).toBeVisible();
    await expect(page.getByText(yen(436307))).toBeVisible();
    await expect(page.getByText(/締め前のため変わることがあります/)).toBeVisible();
    await expect(page.getByRole("heading", { name: "年間サマリー" })).toBeVisible();
  });

  test("会社設定で速報を止められる", async ({ page }) => {
    const { companyId } = requireState();
    adminSql(`update public.companies set driver_portal_show_open_month = false where id = '${companyId}';`);
    await page.goto(`${E2E.appUrl}/driver`);
    await expect(page.getByText("お支払予定額（税込）")).toHaveCount(0);
    adminSql(`update public.companies set driver_portal_show_open_month = true where id = '${companyId}';`);
  });
});
