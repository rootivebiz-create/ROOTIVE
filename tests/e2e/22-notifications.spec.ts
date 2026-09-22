/**
 * 通知：受け取り方の設定と、端末への通知の案内。
 *
 * 端末への通知そのもの（Web Push）はブラウザとプッシュサービスが要るため E2E では動かせない。
 * ここでは「設定が保存できること」と「使えない環境で正しく案内が出ること」を確かめる。
 * 前提：§8.6 の初期データ（resetToSeed）。テストは順番に依存するため serial
 */
import { test, expect } from "@playwright/test";
import { E2E, adminSql, createInvitation, driverIdByName, loginViaInvite, loginViaMagicLink, readState, resetToSeed, toast } from "./helpers";

test.describe.configure({ mode: "serial" });

test.beforeEach(async () => {
  const state = readState();
  test.skip(!state || state.appSkipped, "E2E_SKIP_APP=1 のため Next.js を起動していません");
});

test.describe("通知の設定", () => {
  test.beforeAll(async () => {
    const state = readState();
    if (!state || state.appSkipped) return;
    await resetToSeed();
    // 通知の設定は profiles に持つため初期データの入れ直しでは戻らない。既定へそろえる
    adminSql("update public.profiles set notify_chat = 'mention', notify_line = true");
  });

  test("受け取り方を変えて保存でき、開き直しても残る", async ({ page }) => {
    await loginViaMagicLink(page, E2E.users.owner.email, "/settings/notifications");
    await expect(page.getByRole("heading", { name: "通知", exact: true })).toBeVisible();

    // 既定は「自分あてだけ」
    await expect(page.getByRole("radio", { name: /自分あてだけ/ })).toBeChecked();

    // 保存するまでボタンは押せない
    await expect(page.getByRole("button", { name: "保存" })).toBeDisabled();

    await page.getByRole("radio", { name: "すべての発言" }).check();
    await page.getByRole("button", { name: "保存" }).click();
    await expect(toast(page, "通知の設定を保存しました")).toBeVisible();

    await page.reload();
    await expect(page.getByRole("radio", { name: "すべての発言" })).toBeChecked();
    expect(adminSql(`select notify_chat from public.profiles where email = '${E2E.users.owner.email}'`)).toContain("all");
  });

  test("LINE への転送を切り替えられる", async ({ page }) => {
    await loginViaMagicLink(page, E2E.users.owner.email, "/settings/notifications");
    const line = page.getByRole("checkbox", { name: /LINE にも送る/ });
    await expect(line).toBeChecked();
    await line.click();
    await page.getByRole("button", { name: "保存" }).click();
    await expect(toast(page, "通知の設定を保存しました")).toBeVisible();
    expect(adminSql(`select notify_line from public.profiles where email = '${E2E.users.owner.email}'`)).toContain("f");
  });

  test("未連携なら LINE の案内を出す", async ({ page }) => {
    await loginViaMagicLink(page, E2E.users.owner.email, "/settings/notifications");
    await expect(page.getByText("まだ LINE 公式アカウントと連携していません")).toBeVisible();
  });

  test("鍵が無い環境では端末への通知を案内だけにする", async ({ page }) => {
    await loginViaMagicLink(page, E2E.users.owner.email, "/settings/notifications");
    await expect(page.getByText("この環境では端末への通知をまだ使えません")).toBeVisible();
    await expect(page.getByRole("button", { name: "この端末で通知を受け取る" })).toHaveCount(0);
  });

  test("ドライバーも自分の端末の通知を設定できる", async ({ page }, testInfo) => {
    const driverId = driverIdByName("相曽慧");
    const email = `notify-driver-${testInfo.project.name}-${Date.now()}@example.com`;
    const token = createInvitation({ email, role: "driver", displayName: "相曽慧", driverId });
    await loginViaInvite(page, token);

    await page.goto("/driver/account");
    await expect(page.getByRole("heading", { name: "この端末の通知" })).toBeVisible();
    await expect(page.getByText("稼働の承認・差戻しの結果")).toBeVisible();
    // 鍵が無い環境なので案内だけ（ボタンは出ない）
    await expect(page.getByRole("button", { name: "この端末で通知を受け取る" })).toHaveCount(0);
  });

  test("閲覧者も自分の通知を設定できる", async ({ page }) => {
    await loginViaMagicLink(page, E2E.users.viewer.email, "/settings/notifications");
    await expect(page.getByRole("heading", { name: "通知", exact: true })).toBeVisible();
    await page.getByRole("radio", { name: "受け取らない" }).check();
    await page.getByRole("button", { name: "保存" }).click();
    await expect(toast(page, "通知の設定を保存しました")).toBeVisible();
    expect(adminSql(`select notify_chat from public.profiles where email = '${E2E.users.viewer.email}'`)).toContain("off");
  });
});
