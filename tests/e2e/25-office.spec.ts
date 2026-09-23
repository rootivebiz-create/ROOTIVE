/**
 * 事務（/office）：今日やること（その場で承認・休み希望の返事）→ 今日の報告の催促 →
 * 月締めの手順（手作業のチェック）→ 最初に開く画面、と閲覧者の締め出し。
 *
 * 事務員は管理者（admin）として使う想定なので、管理者でログインする。
 * 日付は実行した日の「今日」を使う（今日の報告・催促は今日のためのもの）。
 * 前提：§8.6 の初期データ（resetToSeed）。テストは順番に依存するため serial
 */
import { test, expect, type Locator, type Page } from "@playwright/test";
import { E2E, adminSql, driverIdByName, loginViaMagicLink, projectItemIdByName, readState, requireState, resetToSeed, saveScreenshot, toast } from "./helpers";

test.describe.configure({ mode: "serial" });

/** 日本時間の今日 */
function todayJst(): string {
  return new Date(Date.now() + 9 * 60 * 60 * 1000).toISOString().slice(0, 10);
}
function addDays(date: string, n: number): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

const TODAY = todayJst();

/** 押した操作が画面の準備前に取りこぼされても、ダイアログが開くまで押し直す */
async function openDialog(page: Page, trigger: Locator, name: string): Promise<Locator> {
  const dialog = page.getByRole("dialog", { name });
  await expect
    .poll(
      async () => {
        if (!(await dialog.isVisible())) await trigger.click();
        return dialog.isVisible();
      },
      { timeout: 15_000 },
    )
    .toBe(true);
  return dialog;
}

test.beforeEach(async () => {
  const state = readState();
  test.skip(!state || state.appSkipped, "E2E_SKIP_APP=1 のため Next.js を起動していません");
});

test.describe("事務", () => {
  test.beforeAll(async () => {
    const state = readState();
    if (!state || state.appSkipped) return;
    await resetToSeed();
    const { companyId } = requireState();
    adminSql(
      `delete from public.dispatch_assignments; delete from public.driver_day_offs; delete from public.report_reminders;
       delete from public.month_close_checks; update public.drivers set weekly_off = '{}', line_user_id = '';
       update public.profiles set start_page = 'dashboard';`,
    );
    // 承認待ちの稼働報告（相曽慧・今日・三郷Amazon 1 日）
    adminSql(
      `insert into public.work_day_entries (company_id, work_date, driver_id, project_item_id, qty, status, source)
       values ('${companyId}', '${TODAY}', '${driverIdByName("相曽慧")}', '${projectItemIdByName("三郷Amazon")}', 1, 'submitted', 'driver')`,
    );
    // 休み希望（金島幸太・10 日後）
    adminSql(
      `insert into public.driver_day_offs (company_id, driver_id, on_date, status, reason)
       values ('${companyId}', '${driverIdByName("金島幸太")}', '${addDays(TODAY, 10)}', 'requested', '通院')`,
    );
    // 沼田基だけ LINE 連携済み（催促が届く人）
    adminSql(`update public.drivers set line_user_id = 'Ue2e00000000000000000000000000001' where id = '${driverIdByName("沼田基")}'`);
  });

  test.afterAll(async () => {
    const state = readState();
    if (!state || state.appSkipped) return;
    // 承認した日別の稼働は月の稼働を書き換えるので、初期データに戻す（後続 spec の前提）
    adminSql(`update public.profiles set start_page = 'dashboard'; delete from public.report_reminders; delete from public.month_close_checks;`);
    await resetToSeed();
  });

  test("今日やることに承認待ちが並び、その場で確かめて承認できる", async ({ page }, testInfo) => {
    await loginViaMagicLink(page, E2E.users.admin.email, "/office");
    await expect(page.getByRole("heading", { name: "事務", exact: true })).toBeVisible();

    const item = page.locator('[data-inbox="approve_entries"]');
    await expect(item).toContainText("稼働報告の承認待ち 1 件");
    await expect(page.locator('[data-inbox="day_offs"]')).toContainText("休み希望の返事待ち 1 件");
    await expect(page.locator('[data-inbox="remind_reports"]')).toBeVisible();
    await saveScreenshot(page, `office-${testInfo.project.name}.png`);

    const dialog = await openDialog(page, item.getByRole("button", { name: "確かめて承認" }), "稼働報告の承認");
    await expect(dialog).toContainText("相曽慧");
    await expect(dialog).toContainText("三郷Amazon");
    await dialog.getByRole("button", { name: "1 件を承認" }).click();
    await expect(toast(page, "1 件を承認しました")).toBeVisible();
    await expect(item).toHaveCount(0);

    const { companyId } = requireState();
    expect(adminSql(`select status from public.work_day_entries where company_id = '${companyId}' and work_date = '${TODAY}' and driver_id = '${driverIdByName("相曽慧")}'`)).toBe("approved");
  });

  test("休み希望にその場で返事ができる", async ({ page }) => {
    await loginViaMagicLink(page, E2E.users.admin.email, "/office");
    const item = page.locator('[data-inbox="day_offs"]');
    const dialog = await openDialog(page, item.getByRole("button", { name: "返事をする" }), "休み希望");
    await expect(dialog).toContainText("金島幸太");
    await expect(dialog).toContainText("通院");
    await dialog.getByRole("button", { name: "金島幸太の休みを承認" }).click();
    await expect(toast(page, "休みを承認しました")).toBeVisible();
    await expect(item).toHaveCount(0);

    const { companyId } = requireState();
    expect(adminSql(`select status from public.driver_day_offs where company_id = '${companyId}' and reason = '通院'`)).toBe("approved");
  });

  test("今日の報告がまだの人へ催促でき、同じ日に二度は送らない", async ({ page }) => {
    await loginViaMagicLink(page, E2E.users.admin.email, "/office");
    const card = page.locator("#reports");
    // 相曽慧は今日の稼働を出している（報告済み）、沼田基は LINE で届く、ほかは連絡手段なし
    await expect(card.locator('[data-reporter="相曽慧"]')).toContainText("済み");
    await expect(card.locator('[data-reporter="沼田基"]')).toContainText("まだ");
    await expect(card.locator('[data-reporter="石田泰典"]')).toContainText("連絡手段なし");
    await expect(card.getByRole("link", { name: "石田泰典の報告を代わりに入力" })).toBeVisible();

    const dialog = await openDialog(page, card.getByRole("button", { name: "まとめて催促（1 人）" }), "今日の報告を催促する");
    await expect(dialog).toContainText("沼田基");
    await expect(dialog).toContainText("LINE");
    await dialog.getByRole("button", { name: "1 人に送る" }).click();
    await expect(toast(page, "1 人に催促しました")).toBeVisible();
    await expect(card.locator('[data-reporter="沼田基"]')).toContainText("催促済み");
    // 今日もう催促した人しか残っていないので、ボタンは消える
    await expect(card.getByRole("button", { name: /まとめて催促/ })).toHaveCount(0);

    const { companyId } = requireState();
    expect(adminSql(`select count(*) from public.report_reminders where company_id = '${companyId}' and work_date = '${TODAY}'`)).toBe("1");
  });

  test("月締めの手順：自動で分かる手順が並び、手作業の手順はチェックを付け外しできる", async ({ page }) => {
    await loginViaMagicLink(page, E2E.users.admin.email, "/office?m=2026-09");
    const card = page.locator("#closing");
    await expect(card.getByRole("heading", { name: "2026年9月の締め" })).toBeVisible();
    await expect(card.locator("[data-step]")).toHaveCount(10);
    await expect(card.locator('[data-step="entries"]')).toHaveAttribute("data-status", "done");
    await expect(card.locator('[data-step="statements_sent"]')).toHaveAttribute("data-status", "todo");
    const before = await card.getByTestId("closing-progress").innerText();

    await page.waitForLoadState("networkidle");
    await card.getByRole("checkbox", { name: "支払明細をドライバーへ送った" }).click();
    await expect(toast(page, "チェックしました")).toBeVisible();
    await expect(card.locator('[data-step="statements_sent"]')).toHaveAttribute("data-status", "done");
    await expect(card.locator('[data-step="statements_sent"]')).toContainText("管理者さんが付けました");
    await expect(card.getByTestId("closing-progress")).not.toHaveText(before);

    await card.getByRole("checkbox", { name: "支払明細をドライバーへ送った" }).click();
    await expect(toast(page, "チェックを外しました")).toBeVisible();
    await expect(card.locator('[data-step="statements_sent"]')).toHaveAttribute("data-status", "todo");
  });

  test("最初に開く画面を事務にすると、ログイン後に事務が開き、ホームに戻せる", async ({ page }, testInfo) => {
    await loginViaMagicLink(page, E2E.users.admin.email, "/office");
    await page.waitForLoadState("networkidle");
    await page.getByRole("button", { name: "最初に開く画面にする" }).click();
    await expect(toast(page, "ログインしたらこの画面を開きます")).toBeVisible();
    await expect(page.getByText("ログインするとこの画面が開きます")).toBeVisible();

    await page.goto("/");
    await expect(page).toHaveURL(/\/office(\?|$)/);
    if (testInfo.project.name === "mobile") {
      // スマホの下タブの先頭も事務になる
      const tabs = page.getByRole("navigation", { name: "メインナビゲーション" }).last();
      await expect(tabs.getByRole("link").first()).toContainText("事務");
    }

    await page.goto("/settings/account");
    await page.waitForLoadState("networkidle");
    await page.getByRole("radio", { name: /ホーム/ }).click();
    await expect(toast(page, "保存しました")).toBeVisible();
    await page.goto("/");
    await expect(page).toHaveURL(/\/dashboard/);
  });

  test("閲覧者は事務を開けず、ナビにも出ない", async ({ page }) => {
    await loginViaMagicLink(page, E2E.users.viewer.email, "/office");
    await expect(page).toHaveURL(/\/dashboard/);
    await expect(page.getByRole("link", { name: "事務", exact: true })).toHaveCount(0);
  });
});
