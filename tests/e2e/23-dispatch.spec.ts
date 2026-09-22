/**
 * 配車・シフト：必要人数 → 足りない日 → マスに人を入れる → 自動で埋める → 確定、
 * 休み希望（ドライバーが申請 → 管理者が承認 → 自動割り当てが避ける）。
 *
 * 日付は「今日から 4 週間先の月曜」から作る（実行した日に関係なく未来になるようにする）。
 * 前提：§8.6 の初期データ（resetToSeed）。テストは順番に依存するため serial
 */
import { test, expect } from "@playwright/test";
import { E2E, adminSql, createInvitation, driverIdByName, loginViaInvite, loginViaMagicLink, readState, resetToSeed, saveScreenshot, toast } from "./helpers";

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
function weekStartOf(date: string): string {
  const w = new Date(`${date}T00:00:00Z`).getUTCDay();
  return addDays(date, w === 0 ? -6 : 1 - w);
}
/** 画面の見出しと同じ「1/4（月）」 */
function shortDateJa(date: string): string {
  const [, m, d] = date.split("-");
  const w = ["日", "月", "火", "水", "木", "金", "土"][new Date(`${date}T00:00:00Z`).getUTCDay()];
  return `${Number(m)}/${Number(d)}（${w}）`;
}

/** 4 週間先の月曜（未来で、かつ実行日に依存しない週） */
const WEEK = weekStartOf(addDays(todayJst(), 28));
const MONDAY = WEEK;
const TUESDAY = addDays(WEEK, 1);

test.beforeEach(async () => {
  const state = readState();
  test.skip(!state || state.appSkipped, "E2E_SKIP_APP=1 のため Next.js を起動していません");
});

test.describe("配車", () => {
  test.beforeAll(async () => {
    const state = readState();
    if (!state || state.appSkipped) return;
    await resetToSeed();
    adminSql("delete from public.dispatch_assignments");
    adminSql("delete from public.project_demands");
    adminSql("delete from public.project_demand_days");
    adminSql("delete from public.driver_day_offs");
    adminSql("update public.drivers set weekly_off = '{}'");
  });

  test("必要人数を入れると、足りない日が配車表に出る", async ({ page }, testInfo) => {
    await loginViaMagicLink(page, E2E.users.owner.email, `/dispatch?from=${WEEK}&tab=demand`);
    await expect(page.getByRole("heading", { name: "配車" })).toBeVisible();

    // 三郷Amazon は月曜に 2 人、火曜に 1 人
    await page.getByLabel("三郷Amazon の月曜日の必要人数").fill("2");
    await page.getByLabel("三郷Amazon の火曜日の必要人数").fill("1");
    await page.getByLabel("三郷Amazon の火曜日の必要人数").blur();
    await expect.poll(() => adminSql("select count(*) from public.project_demands")).toBe("2");

    await page.getByRole("tab", { name: "配車表" }).click();
    await expect(page.getByText("この週は 3 人足りません")).toBeVisible();
    if (testInfo.project.name === "mobile") await saveScreenshot(page, "dispatch-mobile.png");
  });

  test("マスを開いて人を入れると埋まる", async ({ page }) => {
    await loginViaMagicLink(page, E2E.users.owner.email, `/dispatch?from=${WEEK}`);
    await page.getByRole("button", { name: `${shortDateJa(MONDAY)} 三郷Amazon の配車（0/2）` }).first().click();

    const dialog = page.getByRole("dialog");
    await expect(dialog.getByText("必要 2 人")).toBeVisible();
    await dialog.getByLabel("相曽慧 を入れる").click();
    await dialog.getByRole("button", { name: "保存" }).click();

    await expect(toast(page, "配車を保存しました")).toBeVisible();
    await expect(page.getByText("この週は 2 人足りません")).toBeVisible();
    expect(adminSql(`select count(*) from public.dispatch_assignments where on_date = '${MONDAY}'`)).toBe("1");
  });

  test("自動で埋めると、残りが提案されて保存できる", async ({ page }) => {
    await loginViaMagicLink(page, E2E.users.owner.email, `/dispatch?from=${WEEK}`);
    await page.getByRole("button", { name: /自動で埋める/ }).click();

    const dialog = page.getByRole("dialog");
    await expect(dialog.getByRole("heading", { name: "自動で埋める" })).toBeVisible();
    await dialog.getByRole("button", { name: /件を入れる/ }).click();

    await expect(toast(page, "配車を保存しました")).toBeVisible();
    await expect(page.getByText("この週は足りています")).toBeVisible();
    expect(adminSql(`select count(*) from public.dispatch_assignments where on_date in ('${MONDAY}','${TUESDAY}')`)).toBe("3");
  });

  test("確定すると、ドライバーに知らせる対象になる", async ({ page }) => {
    await loginViaMagicLink(page, E2E.users.owner.email, `/dispatch?from=${WEEK}`);
    await page.getByRole("button", { name: "この週を確定" }).click();
    await expect(toast(page, /確定しました/)).toBeVisible();
    expect(adminSql(`select count(*) from public.dispatch_assignments where status = 'confirmed' and on_date = '${MONDAY}'`)).toBe("2");
  });

  test("ドライバーが休みを申請し、管理者が承認できる", async ({ page }, testInfo) => {
    const driverId = driverIdByName("相曽慧");
    const email = `dispatch-driver-${testInfo.project.name}-${Date.now()}@example.com`;
    const token = createInvitation({ email, role: "driver", displayName: "相曽慧", driverId });
    await loginViaInvite(page, token);

    await page.goto("/driver/schedule");
    await expect(page.getByRole("heading", { name: "予定" })).toBeVisible();
    await page.getByRole("button", { name: "休みを申請する" }).click();
    const dialog = page.getByRole("dialog");
    await dialog.getByLabel("休みたい日").fill(addDays(WEEK, 3));
    await dialog.getByLabel("理由（任意）").fill("通院");
    await dialog.getByRole("button", { name: "申請する" }).click();
    await expect(toast(page, "休みを申請しました")).toBeVisible();

    // 管理者が承認する
    await loginViaMagicLink(page, E2E.users.owner.email, `/dispatch?from=${WEEK}&tab=offs`);
    await expect(page.getByText("通院")).toBeVisible();
    await page.getByRole("button", { name: "承認" }).first().click();
    await expect(toast(page, "休みを承認しました")).toBeVisible();
    expect(adminSql(`select status from public.driver_day_offs where on_date = '${addDays(WEEK, 3)}'`)).toBe("approved");
  });

  test("閲覧者は配車を変えられない", async ({ page }) => {
    await loginViaMagicLink(page, E2E.users.viewer.email, `/dispatch?from=${WEEK}`);
    await expect(page.getByRole("heading", { name: "配車" })).toBeVisible();
    await expect(page.getByRole("button", { name: "この週を確定" })).toHaveCount(0);
    await expect(page.getByRole("button", { name: /前の週から写す/ })).toHaveCount(0);
  });
});
