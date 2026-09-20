/**
 * ロール（§3・§4.6）：viewer は閲覧と CSV のみ、driver は自分の締め済み月の明細のみ、
 * 代表（owner）だけが「代表」のナビ・コマンドパレットの候補・決裁待ちの通知を見られる（0019・0020）
 * 前提：resetToSeed（2026-09 は未締め）。driver のテストの前に RPC で 2026-09 を締める
 */
import { test, expect, type Page } from "@playwright/test";
import {
  E2E,
  adminSql,
  countEntries,
  createInvitation,
  driverIdByName,
  listRow,
  loginViaInvite,
  loginViaMagicLink,
  logout,
  projectItemIdByName,
  readState,
  requireState,
  resetToSeed,
  saveScreenshot,
  sessionFor,
  setMonthClosed,
  yen,
} from "./helpers";

test.describe.configure({ mode: "serial" });

test.beforeEach(async () => {
  const state = readState();
  test.skip(!state || state.appSkipped, "E2E_SKIP_APP=1 のため Next.js を起動していません");
});

test.describe("ロール", () => {
  test.beforeAll(async () => {
    const state = readState();
    if (!state || state.appSkipped) return;
    await resetToSeed();
  });

  test("viewer：編集 UI が無く、ユーザー管理に入れず、バックアップ JSON は 403・CSV は 200", async ({ page }, testInfo) => {
    const email = `viewer-${testInfo.project.name}-${Date.now()}@example.com`;
    const token = createInvitation({ email, role: "viewer", displayName: "閲覧者テスト" });
    await loginViaInvite(page, token);
    await expect(page).toHaveURL(/\/dashboard/);
    await expect(page.getByRole("heading", { name: "ダッシュボード" })).toBeVisible();

    // 稼働入力：一覧は見えるが追加・編集・削除・複製・一括入力が無い
    await page.goto("/entries?m=2026-09");
    await expect(page.getByText("2026年9月の稼働行 10 件")).toBeVisible();
    await expect(listRow(page, "相曽慧")).toContainText(yen(483525));
    await expect(page.getByRole("button", { name: "稼働を追加" })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "前月から複製" })).toHaveCount(0);
    await expect(page.getByRole("link", { name: "一括入力" })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "編集" })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "削除" })).toHaveCount(0);
    await page.goto("/entries/bulk?m=2026-09");
    await expect(page.getByText("閲覧のみです。稼働の編集には管理者権限が必要です。")).toBeVisible();

    // 支払明細：管理費・調整の編集ボタンが無い
    const driverId = driverIdByName("相曽慧");
    await page.goto(`/payouts/${driverId}/statement?m=2026-09`);
    await expect(page.getByRole("heading", { name: "相曽慧 様 2026年9月 支払明細" })).toBeVisible();
    await expect(page.getByRole("button", { name: "管理費・調整を編集" })).toHaveCount(0);

    // 設定：ユーザー管理（owner のみ）は /dashboard へ。月締めの操作も出ない
    await page.goto("/settings/users");
    await expect(page).toHaveURL(/\/dashboard/);
    await page.goto("/settings/company");
    await expect(page).toHaveURL(/\/dashboard/);
    await page.goto("/settings");
    await expect(page.getByRole("link", { name: /ユーザー管理/ })).toHaveCount(0);
    await expect(page.getByRole("link", { name: /監査ログ/ })).toHaveCount(0);
    await page.goto("/settings/months");
    await expect(page.getByText("閲覧者は月締めの操作はできません。")).toBeVisible();
    await expect(page.getByRole("button", { name: "この月を締める" })).toHaveCount(0);
    await page.goto("/settings/drivers");
    await expect(page.getByRole("link", { name: "ドライバーを追加" })).toHaveCount(0);

    // 出力：バックアップ JSON は 403、稼働 CSV は 200
    const backup = await page.request.get("/api/export/backup.json");
    expect(backup.status()).toBe(403);
    const csv = await page.request.get("/api/export/entries.csv?m=2026-09");
    expect(csv.status()).toBe(200);
    expect((await csv.text()).replace(/^﻿/, "")).toContain("相曽慧");

    // DB（RLS）でも書き込みは拒否される
    const client = await sessionFor(email);
    const { companyId } = requireState();
    const insert = await client
      .from("work_entries")
      .insert({ company_id: companyId, month: "2026-09-01", driver_id: driverId, project_item_id: projectItemIdByName("三郷Amazon"), qty: 1, bill_rate: 1, pay_rate: 1, royalty_rate: 0.1, rounding_mode: "none" });
    // トリガー（P0001）または RLS（42501）で拒否され、行は増えない
    expect(insert.error).not.toBeNull();
    expect(["42501", "P0001"]).toContain(insert.error?.code);
    expect(countEntries("2026-09")).toBe(10);
    // RLS の update は「エラー」ではなく 0 行更新になる（PostgREST と同じ挙動）。DB の値が変わっていないことを確認する
    const update = await client.from("drivers").update({ mgmt_fee: 0 }).eq("id", driverId).select("id");
    expect(update.error == null ? (update.data ?? []).length : 0).toBe(0);
    expect(adminSql(`select mgmt_fee from public.drivers where id = '${driverId}'`)).toBe("15000.00");

    await logout(page);
    await expect(page).toHaveURL(/\/login/);
  });

  test("driver：招待でログインすると /driver へ。PDF は自分の締め済み月だけ 200、スタッフ画面・出力は拒否", async ({ page }, testInfo) => {
    await setMonthClosed("2026-09", true);
    const driverId = driverIdByName("相曽慧");
    const email = `driver-${testInfo.project.name}-${Date.now()}@example.com`;
    const token = createInvitation({ email, role: "driver", displayName: "相曽慧", driverId });
    await loginViaInvite(page, token);
    await expect(page).toHaveURL(/\/driver(\?|$)/);

    // PDF は自分の分だけ 200、他人の分は 403
    const pdf = await page.request.get(`/api/export/statement.pdf?m=2026-09&driver=${driverId}`);
    expect(pdf.status()).toBe(200);
    expect((await pdf.body()).subarray(0, 4).toString("latin1")).toBe("%PDF");
    const other = await page.request.get(`/api/export/statement.pdf?m=2026-09&driver=${driverIdByName("金島幸太")}`);
    expect(other.status()).toBe(403);
    // 未締めの月は 403（集計中）
    const open = await page.request.get(`/api/export/statement.pdf?m=2026-10&driver=${driverId}`);
    expect(open.status()).toBe(403);
    // スタッフ向けの出力は 403
    expect((await page.request.get("/api/export/entries.csv?m=2026-09")).status()).toBe(403);
    expect((await page.request.get("/api/export/backup.json")).status()).toBe(403);

    // スタッフ画面は /driver へ（URL のみ。画面の描画は次のテストで確認）
    await page.goto("/dashboard");
    await expect(page).toHaveURL(/\/driver(\?|$)/);
    await page.goto("/entries?m=2026-09");
    await expect(page).toHaveURL(/\/driver(\?|$)/);
    await page.goto("/settings");
    await expect(page).toHaveURL(/\/driver(\?|$)/);

    // RLS：driver は自分の稼働行しか読めない
    const client = await sessionFor(email);
    const own = await client.from("work_entries").select("driver_id").eq("month", "2026-09-01");
    expect(own.error).toBeNull();
    expect((own.data ?? []).length).toBeGreaterThan(0);
    expect((own.data ?? []).every((r) => r.driver_id === driverId)).toBe(true);
    const months = await client.rpc("driver_portal_months");
    expect(months.error).toBeNull();
    expect((months.data ?? []).map((m) => [m.month, Number(m.payout), Number(m.payout_incl)])).toEqual([["2026-09-01", 396643, 436307]]);
  });

  /**
   * 以前は本番ビルドで /driver が「エラーが発生しました」になる不具合（lucide のアイコン関数が
   * Server → Client 境界を越えていた）で test.fixme にしていた。app/driver/layout.tsx を
   * navVariant="driver" 指定に変更して解消済み（コミット 040e127）。
   */
  test("driver：ポータルに締め済みの自分の月だけ表示され、会社側の数字は出ない（/driver の描画）", async ({ page }, testInfo) => {
    await setMonthClosed("2026-09", true);
    const driverId = driverIdByName("相曽慧");
    const email = `driver-ui-${testInfo.project.name}-${Date.now()}@example.com`;
    const token = createInvitation({ email, role: "driver", displayName: "相曽慧", driverId });
    await loginViaInvite(page, token);
    await expect(page).toHaveURL(/\/driver(\?|$)/);
    await expect(page.getByRole("heading", { name: "支払明細一覧" })).toBeVisible();

    const monthLink = page.getByRole("link", { name: /2026年9月/ });
    await expect(monthLink).toContainText(yen(436307)); // 税込
    await monthLink.click();
    await expect(page).toHaveURL(/\/driver\/statements\/2026-09/);
    await expect(page.getByRole("heading", { name: "2026年9月 支払明細", level: 1 })).toBeVisible();

    const main = page.locator("main");
    await expect(main).toContainText("お支払額（税込）");
    await expect(main).toContainText(yen(436307));
    await expect(main).toContainText("小計（税抜）");
    await expect(main).toContainText(yen(39664));
    await expect(main).toContainText("振込予定日：2026年10月31日");
    await expect(main).toContainText("21日 × ¥21,780");
    await expect(main).toContainText(yen(-14999));
    await expect(main).not.toContainText("会社利益");
    await expect(main).not.toContainText("会社売上");
    await expect(main).not.toContainText("単価差額");
    await expect(page.getByRole("link", { name: "PDF をダウンロード" })).toBeVisible();
    if (testInfo.project.name === "mobile") await saveScreenshot(page, "driver-portal-mobile.png");

    // 未締めの月は「集計中」
    await page.goto("/driver/statements/2026-10");
    await expect(page.getByText("集計中")).toBeVisible();

    await logout(page);
    await expect(page).toHaveURL(/\/login/);
  });
});

/**
 * 代表（owner）だけの領域（0019・0020）。画面は /executive 配下。
 * ここではナビ・コマンドパレット・ヘッダーのベルの出し分けと、管理者が直接開いたときの差し戻しを見る。
 */
test.describe("代表（owner）の出し分け", () => {
  const MONTH = "2026-09";

  /** スマホは下タブの「メニュー」シート、PC はサイドナビを見る */
  async function navScope(page: Page, isMobile: boolean) {
    const nav = page.getByRole("navigation", { name: "メインナビゲーション" });
    if (!isMobile) return nav;
    await nav.getByRole("button", { name: "メニュー", exact: true }).click();
    const sheet = page.getByRole("dialog");
    await expect(sheet.getByRole("heading", { name: "メニュー" })).toBeVisible();
    return sheet;
  }

  test.beforeAll(async () => {
    const state = readState();
    if (!state || state.appSkipped) return;
    await resetToSeed();
    // ベルが 0 件から始まるように、ほかの spec が残した未対応を消す（reset_company_data は決裁だけを消す）
    const { companyId } = requireState();
    adminSql(`delete from public.alerts where company_id = '${companyId}'`);
    adminSql(`delete from public.chat_messages where company_id = '${companyId}'`);
    adminSql(`delete from public.approvals where company_id = '${companyId}'`);
  });

  test("代表：ナビに「代表」が出て、コマンドパレットにも代表の画面が並ぶ", async ({ page }, testInfo) => {
    const isMobile = testInfo.project.name === "mobile";
    await loginViaMagicLink(page, E2E.users.owner.email, `/dashboard?m=${MONTH}`);

    const scope = await navScope(page, isMobile);
    await expect(scope.getByRole("link", { name: "代表", exact: true }).filter({ visible: true }).first()).toBeVisible();
    if (isMobile) await page.keyboard.press("Escape");

    // コマンドパレット：代表の画面（決裁・意思決定ログ・中期計画）が候補に出る
    await page.getByRole("button", { name: "検索" }).first().click();
    await page.getByLabel("検索語").fill("代表");
    const dialog = page.getByRole("dialog");
    await expect(dialog.getByText("代表", { exact: true }).first()).toBeVisible();
    await page.getByLabel("検索語").fill("決裁");
    await expect(dialog.getByText("決裁（承認）").first()).toBeVisible();
    await expect(dialog.getByText("決裁のルールと委任").first()).toBeVisible();
    await page.getByLabel("検索語").fill("ちゅうきけいかく");
    await expect(dialog.getByText("中期計画").first()).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(page.getByLabel("検索語")).toHaveCount(0);

    await logout(page);
  });

  test("管理者：ナビにもコマンドパレットにも「代表」が出ず、/executive はダッシュボードへ戻される", async ({ page }, testInfo) => {
    const isMobile = testInfo.project.name === "mobile";
    const email = `admin-exec-${testInfo.project.name}-${Date.now()}@example.com`;
    const token = createInvitation({ email, role: "admin", displayName: "管理者テスト" });
    await loginViaInvite(page, token);
    await expect(page).toHaveURL(/\/dashboard/);

    const scope = await navScope(page, isMobile);
    await expect(scope.getByRole("link", { name: "代表", exact: true })).toHaveCount(0);
    if (isMobile) await page.keyboard.press("Escape");

    // コマンドパレットにも出ない
    await page.getByRole("button", { name: "検索" }).first().click();
    await page.getByLabel("検索語").fill("代表");
    await expect(page.getByRole("dialog").getByText("該当する候補はありません。")).toBeVisible();
    await page.keyboard.press("Escape");

    // 直接開いても requirePageRole(["owner"]) でダッシュボードへ戻される
    await page.goto("/executive");
    await expect(page).toHaveURL(/\/dashboard/);
    await page.goto("/executive/approvals");
    await expect(page).toHaveURL(/\/dashboard/);

    await logout(page);
  });

  test("閲覧者：ナビに「代表」が出ず、/executive はダッシュボードへ戻される", async ({ page }, testInfo) => {
    const isMobile = testInfo.project.name === "mobile";
    const email = `viewer-exec-${testInfo.project.name}-${Date.now()}@example.com`;
    const token = createInvitation({ email, role: "viewer", displayName: "閲覧者テスト" });
    await loginViaInvite(page, token);
    await expect(page).toHaveURL(/\/dashboard/);

    const scope = await navScope(page, isMobile);
    await expect(scope.getByRole("link", { name: "代表", exact: true })).toHaveCount(0);
    if (isMobile) await page.keyboard.press("Escape");

    await page.goto("/executive");
    await expect(page).toHaveURL(/\/dashboard/);

    await logout(page);
  });

  test("ヘッダーのベル：未対応が無ければ「いまは何もありません」、決裁待ちは代表だけに出る", async ({ page }) => {
    const { companyId } = requireState();
    await loginViaMagicLink(page, E2E.users.owner.email, `/dashboard?m=${MONTH}`);

    // 0 件：バッジを出さず、開いても何も並ばない
    const bell = page.getByRole("button", { name: "お知らせ", exact: true });
    await expect(bell).toBeVisible();
    const box = await bell.boundingBox();
    expect(box?.height ?? 0).toBeGreaterThanOrEqual(44); // スマホでも押せる大きさ
    expect(box?.width ?? 0).toBeGreaterThanOrEqual(44);
    await bell.click();
    await expect(page.getByText("いまは何もありません")).toBeVisible();
    await page.keyboard.press("Escape");

    // 決裁待ちを 1 件入れると、代表のベルに「決裁待ち」が出る
    adminSql(`insert into public.approvals (company_id, kind, title, status) values ('${companyId}', 'expense', 'E2E の決裁テスト', 'pending')`);
    await page.reload();
    await page.getByRole("button", { name: /^お知らせ/ }).click();
    const approvalRow = page.getByRole("link", { name: /決裁待ち/ });
    await expect(approvalRow).toBeVisible();
    await expect(approvalRow).toContainText("1");
    await page.keyboard.press("Escape");
    await logout(page);

    // 管理者には決裁待ちの行が出ない（決裁は代表の仕事）
    const email = `admin-bell-${Date.now()}@example.com`;
    await loginViaInvite(page, createInvitation({ email, role: "admin", displayName: "管理者テスト" }));
    await page.getByRole("button", { name: /^お知らせ/ }).click();
    await expect(page.getByRole("link", { name: /決裁待ち/ })).toHaveCount(0);
    await expect(page.getByText("いまは何もありません")).toBeVisible();
    await page.keyboard.press("Escape");
    await logout(page);

    adminSql(`delete from public.approvals where company_id = '${companyId}'`);
  });
});
