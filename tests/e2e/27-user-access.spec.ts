/**
 * ユーザーごとの設定（0029）：
 *   代表が「詳しく設定」で閲覧者の見せる範囲を狭める → 閲覧者は経営の数字と出力が使えない（画面・出力の口の両方）
 *   → 事務員に経営の数字を見せる → 代表を譲って、譲り返す。
 *
 * 前提：§8.6 の初期データ。ロールと見せる範囲は前後で元に戻す。テストは順番に依存するため serial
 */
import { test, expect, type Locator, type Page } from "@playwright/test";
import { E2E, adminSql, clickToUrl, listRow, loginViaMagicLink, readState, requireState, saveScreenshot, sessionFor, toast } from "./helpers";

test.describe.configure({ mode: "serial" });

const MONTH = "2026-09";

function profileId(email: string): string {
  return adminSql(`select id from public.profiles where email = '${email}'`);
}

function roleOf(email: string): string {
  return adminSql(`select role from public.profiles where email = '${email}'`);
}

function overridesOf(email: string): Record<string, string> {
  return JSON.parse(adminSql(`select access_overrides::text from public.profiles where email = '${email}'`) || "{}");
}

/** ロールと見せる範囲を初めの形に戻す（superuser の SQL なので保護のトリガーは効かない） */
function restoreUsers(): void {
  const { companyId } = requireState();
  adminSql(
    `update public.profiles set access_overrides = '{}' where company_id = '${companyId}';
     update public.profiles set role = 'owner' where email = '${E2E.users.owner.email}';
     update public.profiles set role = 'admin' where email = '${E2E.users.admin.email}';
     update public.profiles set role = 'viewer' where email = '${E2E.users.viewer.email}';
     update public.profiles set role = 'clerk' where email = '${E2E.users.clerk.email}';`,
  );
}

/** 見せる範囲の 1 項目で「ロールのとおり／見せる／見せない」を選ぶ */
async function choose(page: Page, key: string, label: "見せる" | "見せない" | RegExp): Promise<Locator> {
  const row = page.locator(`[data-access-row="${key}"]`);
  const radio = row.getByRole("radio", { name: label });
  await radio.click();
  await expect(radio).toHaveAttribute("aria-checked", "true");
  return row;
}

test.beforeEach(async () => {
  const state = readState();
  test.skip(!state || state.appSkipped, "E2E_SKIP_APP=1 のため Next.js を起動していません");
});

test.describe("ユーザーごとの設定", () => {
  test.beforeAll(() => {
    const state = readState();
    if (!state || state.appSkipped) return;
    restoreUsers();
  });

  test.afterAll(() => {
    const state = readState();
    if (!state || state.appSkipped) return;
    restoreUsers();
  });

  test("代表は「詳しく設定」から、閲覧者の見せる範囲を狭められる", async ({ page }, testInfo) => {
    await loginViaMagicLink(page, E2E.users.owner.email, "/settings/users");
    await expect(page.getByRole("heading", { name: "ユーザー管理" })).toBeVisible();

    await clickToUrl(page, page.getByRole("link", { name: `${E2E.users.viewer.displayName} を詳しく設定` }), /\/settings\/users\/[0-9a-f-]{36}/);
    await expect(page.getByRole("heading", { name: E2E.users.viewer.displayName, exact: true })).toBeVisible();
    // 閲覧者の既定：経営の数字は見える、借入は見えない
    await expect(page.locator('[data-access-row="management"] [data-result]')).toHaveText("見える");
    await expect(page.locator('[data-access-row="loans"] [data-result]')).toHaveText("見えない");

    const management = await choose(page, "management", "見せない");
    await expect(management.locator("[data-result]")).toHaveText("見えない");
    await choose(page, "export", "見せない");
    await page.getByRole("button", { name: "見せる範囲を保存" }).click();
    await expect(toast(page, "見せる範囲を保存しました")).toBeVisible();
    await expect.poll(() => overridesOf(E2E.users.viewer.email)).toEqual({ management: "deny", export: "deny" });
    await saveScreenshot(page, `user-detail-${testInfo.project.name}.png`);

    // 一覧には「個別の設定 2」と出る
    await page.goto("/settings/users");
    await expect(listRow(page, E2E.users.viewer.email).getByText("個別の設定 2")).toBeVisible();
  });

  test("閲覧者は経営の数字と出力が使えない（画面と出力の口の両方）", async ({ page }, testInfo) => {
    await loginViaMagicLink(page, E2E.users.viewer.email, "/");
    // ホームへは行かず、稼働が開く
    await expect(page).toHaveURL(/\/entries/);
    await page.goto(`/dashboard?m=${MONTH}`);
    await expect(page).toHaveURL(/\/entries/);
    await page.goto("/reports");
    await expect(page).toHaveURL(/\/entries/);

    // ナビに経営の画面が無い
    if (testInfo.project.name === "desktop") {
      const side = page.getByRole("navigation", { name: "メインナビゲーション" }).first();
      await expect(side.getByRole("link", { name: /稼働/ }).first()).toBeVisible();
      await expect(side.getByRole("link", { name: /ホーム|資金繰り|財務|レポート|AI 相談|出力/ })).toHaveCount(0);
    } else {
      const tabs = page.getByRole("navigation", { name: "メインナビゲーション" }).last();
      await expect(tabs.getByRole("link", { name: /ホーム/ })).toHaveCount(0);
    }

    // 出力のボタンが出ず、出力の口も 403
    await page.goto(`/entries?m=${MONTH}`);
    await expect(page.getByText("相曽慧").first()).toBeVisible();
    await expect(page.locator('a[href^="/api/export/"]:visible')).toHaveCount(0);
    const csv = await page.request.get(`/api/export/entries.csv?m=${MONTH}`);
    expect(csv.status()).toBe(403);
    expect(await csv.text()).toContain("出力（ダウンロード）が止められています");
    await page.goto(`/exports?m=${MONTH}`);
    await expect(page.getByText("あなたのアカウントでは出力（ダウンロード）が止められています。")).toBeVisible();

    // DB（RLS）でも経営の数字は読めない
    const client = await sessionFor(E2E.users.viewer.email);
    const management = await client.rpc("can_see_management");
    expect(management.data).toBe(false);
    const forecast = await client.rpc("cash_forecast", { p_from: `${MONTH}-01`, p_to: `${MONTH}-30` });
    expect(forecast.error).not.toBeNull();

    // 自分の見られる範囲はアカウントの画面で確かめられる
    await page.goto("/settings/account");
    await expect(page.getByRole("heading", { name: "見られる範囲" })).toBeVisible();
    await expect(page.locator('[data-access="management"][data-state="off"]')).toBeVisible();
    await expect(page.locator('[data-access="export"][data-state="off"]')).toBeVisible();
    await saveScreenshot(page, `user-access-account-${testInfo.project.name}.png`);
  });

  test("事務員に経営の数字を見せると、ホームが開ける", async ({ page }) => {
    const { companyId } = requireState();
    adminSql(`update public.profiles set access_overrides = '{"management":"allow"}' where company_id = '${companyId}' and email = '${E2E.users.clerk.email}'`);
    await loginViaMagicLink(page, E2E.users.clerk.email, "/");
    // 事務員はいつも事務から始まる
    await expect(page).toHaveURL(/\/office/);
    await page.goto(`/dashboard?m=${MONTH}`);
    await expect(page).toHaveURL(/\/dashboard/);
    await expect(page.getByText("売上").first()).toBeVisible();
    // 経営の設定（監査ログ）は今までどおり開けない
    await page.goto("/settings/audit");
    await expect(page).not.toHaveURL(/\/settings\/audit/);
  });

  test("代表を譲ると、相手が代表になり自分は選んだロールになる（譲り返せる）", async ({ page }) => {
    await loginViaMagicLink(page, E2E.users.owner.email, "/settings/users");
    await page.goto(`/settings/users/${profileId(E2E.users.admin.email)}`);
    await expect(page.getByRole("heading", { name: E2E.users.admin.displayName, exact: true })).toBeVisible();

    await page.getByRole("button", { name: "代表を譲る…" }).click();
    const dialog = page.getByRole("dialog", { name: `${E2E.users.admin.displayName}さんに代表を譲りますか？` });
    await expect(dialog).toBeVisible();
    const confirm = dialog.getByRole("button", { name: `${E2E.users.admin.displayName}さんに代表を譲る` });
    // 確認のチェックを入れるまでは押せない
    await expect(confirm).toBeDisabled();
    await dialog.getByLabel("譲ったあとのあなたのロール").selectOption("admin");
    await dialog.getByRole("checkbox", { name: /使えなくなることを確認しました/ }).click();
    await confirm.click();

    // 自分はもう代表ではないので、最初の画面へ移る
    await page.waitForURL(/\/(dashboard|office)/, { timeout: 30_000 });
    await expect.poll(() => roleOf(E2E.users.admin.email)).toBe("owner");
    expect(roleOf(E2E.users.owner.email)).toBe("admin");
    // ユーザー管理はもう開けない
    await page.goto("/settings/users");
    await expect(page).not.toHaveURL(/\/settings\/users/);

    // 新しい代表から譲り返す（DB の RPC でも同じことができる）
    const newOwner = await sessionFor(E2E.users.admin.email);
    const back = await newOwner.rpc("transfer_ownership", { p_to: profileId(E2E.users.owner.email), p_my_role: "admin" });
    expect(back.error).toBeNull();
    expect(roleOf(E2E.users.owner.email)).toBe("owner");
    expect(roleOf(E2E.users.admin.email)).toBe("admin");

    // 代表でない人は譲れない（DB が拒否する）
    const again = await newOwner.rpc("transfer_ownership", { p_to: profileId(E2E.users.viewer.email), p_my_role: "admin" });
    expect(again.error).not.toBeNull();
  });
});
