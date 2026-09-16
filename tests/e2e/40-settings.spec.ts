/**
 * 設定（§4.5）：ドライバー・案件・会社設定・ユーザー管理（招待）・監査ログ
 * 前提：初期データがあること（seedInitialData は冪等）。テスト用に作るマスタは事前に消しておく
 */
import { test, expect } from "@playwright/test";
import { E2E, adminSql, listRow, loginViaMagicLink, readState, requireState, saveScreenshot, seedInitialData, toast, yen } from "./helpers";

test.describe.configure({ mode: "serial" });

const DRIVER_NAME = "テスト太郎";
const PROJECT_NAME = "テスト案件";

test.beforeEach(async () => {
  const state = readState();
  test.skip(!state || state.appSkipped, "E2E_SKIP_APP=1 のため Next.js を起動していません");
});

test.describe("設定", () => {
  test.beforeAll(async () => {
    const state = readState();
    if (!state || state.appSkipped) return;
    await seedInitialData();
    const { companyId } = requireState();
    // 同名マスタが残っていれば削除（名前は会社内で一意）
    adminSql(
      `delete from public.driver_pay_overrides where driver_id in (select id from public.drivers where company_id = '${companyId}' and name = '${DRIVER_NAME}');
       delete from public.driver_months where company_id = '${companyId}' and driver_id in (select id from public.drivers where company_id = '${companyId}' and name = '${DRIVER_NAME}');
       delete from public.drivers where company_id = '${companyId}' and name = '${DRIVER_NAME}';
       delete from public.project_items where project_id in (select id from public.projects where company_id = '${companyId}' and name = '${PROJECT_NAME}');
       delete from public.projects where company_id = '${companyId}' and name = '${PROJECT_NAME}';`,
    );
  });

  test.beforeEach(async ({ page }) => {
    await loginViaMagicLink(page, E2E.users.owner.email, "/settings/drivers");
  });

  test("ドライバーを追加（率 10%・管理費 15,000）→ 一覧に出る → 編集で停止中にする", async ({ page }, testInfo) => {
    await expect(page.getByRole("heading", { name: "ドライバー" })).toBeVisible();
    await expect(page.getByText(/全 10 名/)).toBeVisible();
    await page.getByRole("link", { name: "ドライバーを追加" }).click();
    await expect(page.getByRole("heading", { name: "ドライバーを追加" })).toBeVisible();

    await page.getByLabel("名前（必須）").fill(DRIVER_NAME);
    await page.getByLabel("かな").fill("てすと たろう");
    // ロイヤリティ率：会社設定に従う → 個別に 10%
    const follow = page.getByRole("checkbox", { name: /会社設定に従う/ });
    await expect(follow).toBeChecked();
    await follow.click();
    await expect(follow).not.toBeChecked();
    await page.getByLabel("ロイヤリティ率", { exact: true }).fill("10");
    await page.getByLabel("管理費（月額）").fill("15000");
    await page.getByRole("button", { name: "登録する" }).click();
    await expect(toast(page, /保存しました|登録しました/)).toBeVisible();
    await expect(page).toHaveURL(/\/settings\/drivers(\?|$)/);

    await expect(page.getByText(/全 11 名/)).toBeVisible();
    const row = listRow(page, DRIVER_NAME);
    await expect(row).toContainText("稼働中");
    await expect(row).toContainText("10.0%");
    await expect(row).toContainText(yen(15000));
    if (testInfo.project.name === "mobile") await saveScreenshot(page, "settings-drivers-mobile.png");

    // 編集：停止中にする
    await page.getByRole("link", { name: DRIVER_NAME, exact: true }).click();
    await expect(page.getByRole("heading", { name: DRIVER_NAME })).toBeVisible();
    await expect(page.getByLabel("名前（必須）")).toHaveValue(DRIVER_NAME);
    const active = page.getByRole("switch", { name: "状態" });
    await expect(active).toBeChecked();
    await active.click();
    await expect(active).not.toBeChecked();
    await expect(page.getByText("停止中（稼働入力の候補に表示しない）")).toBeVisible();
    await page.getByRole("button", { name: "保存する" }).click();
    await expect(toast(page, /保存しました/)).toBeVisible();
    await expect(page).toHaveURL(/\/settings\/drivers(\?|$)/);
    await expect(listRow(page, DRIVER_NAME)).toContainText("停止中");
    await expect(page.getByText(/稼働中 10 名／全 11 名/)).toBeVisible();
  });

  test("案件を追加（内容 2 つ：日給と個数）→ 一覧に出る", async ({ page }) => {
    await page.goto("/settings/projects");
    await expect(page.getByRole("heading", { name: "案件・単価" })).toBeVisible();
    await page.getByRole("link", { name: "案件を追加" }).click();
    await expect(page.getByRole("heading", { name: "案件を追加" })).toBeVisible();

    await page.getByLabel("案件名（必須）").fill(PROJECT_NAME);
    await page.getByLabel("荷主・元請").fill("テスト荷主");
    // 内容 1：配送A（日給 10,000／9,000）
    await page.getByLabel("内容名").nth(0).fill("配送A");
    await page.getByLabel("区分").nth(0).selectOption("day");
    await page.getByLabel("受注単価").nth(0).fill("10000");
    await page.getByLabel("支払単価").nth(0).fill("9000");
    await expect(page.getByText(`差額 ${yen(1000)}`)).toBeVisible();
    // 内容 2：配送B（個数 200／180）
    await page.getByRole("button", { name: "内容を追加" }).click();
    await page.getByLabel("内容名").nth(1).fill("配送B");
    await page.getByLabel("区分").nth(1).selectOption("piece");
    await page.getByLabel("受注単価").nth(1).fill("200");
    await page.getByLabel("支払単価").nth(1).fill("180");
    await page.getByRole("button", { name: "登録する" }).click();
    await expect(toast(page, /保存しました|登録しました/)).toBeVisible();
    await expect(page).toHaveURL(/\/settings\/projects(\?|$)/);

    await expect(page.getByText(/全 8 件/)).toBeVisible();
    await expect(page.getByText(PROJECT_NAME).filter({ visible: true })).toHaveCount(1);
    await expect(page.getByText("配送A").filter({ visible: true })).toHaveCount(1);
    await expect(page.getByText("配送B").filter({ visible: true })).toHaveCount(1);
  });

  test("会社設定：住所を入力して保存すると再表示で保持される", async ({ page }) => {
    await page.goto("/settings/company");
    await expect(page.getByRole("heading", { name: "会社設定" })).toBeVisible();
    await expect(page.getByLabel("会社名")).toHaveValue(E2E.companyName);
    const address = "埼玉県三郷市テスト1-2-3";
    await page.getByLabel("住所").fill(address);
    await page.getByLabel("電話番号").fill("048-000-0000");
    await page.getByRole("button", { name: "保存" }).first().click();
    await expect(toast(page, "会社設定を保存しました。")).toBeVisible();

    await page.reload();
    await expect(page.getByLabel("住所")).toHaveValue(address);
    await expect(page.getByLabel("電話番号")).toHaveValue("048-000-0000");
    // 印刷用の明細にも反映される
    const { companyId } = requireState();
    const driverId = adminSql(`select id from public.drivers where company_id = '${companyId}' and name = '相曽慧'`);
    await page.goto(`/payouts/${driverId}/print?m=2026-09`);
    await expect(page.locator("article")).toContainText(address);
  });

  test("ユーザー管理：閲覧者を招待すると招待リンク（/invite/）が表示される", async ({ page }, testInfo) => {
    const email = `viewer-invite-${testInfo.project.name}-${Date.now()}@example.com`;
    await page.goto("/settings/users");
    await expect(page.getByRole("heading", { name: "ユーザー管理" })).toBeVisible();
    await page.getByRole("button", { name: "ユーザーを招待" }).click();
    const dialog = page.getByRole("dialog");
    await expect(dialog.getByRole("heading", { name: "ユーザーを招待" })).toBeVisible();
    await dialog.getByLabel("メールアドレス").fill(email);
    await dialog.getByLabel("ロール").selectOption("viewer");
    await expect(dialog.getByText("閲覧と CSV 出力のみ")).toBeVisible();
    await dialog.getByLabel("表示名（任意）").fill("閲覧テスト");
    const send = dialog.getByRole("checkbox", { name: "招待メールも送る" });
    await expect(send).toBeChecked();
    await send.click();
    await expect(send).not.toBeChecked();
    await dialog.getByRole("button", { name: "招待する" }).click();
    await expect(toast(page, "招待を作成しました。")).toBeVisible();

    const result = page.getByRole("dialog");
    await expect(result.getByRole("heading", { name: "招待リンクを発行しました" })).toBeVisible();
    const link = result.getByLabel("招待リンク");
    await expect(link).toHaveValue(/\/invite\/[0-9a-f]{32,128}$/);
    const inviteUrl = await link.inputValue();
    expect(inviteUrl.startsWith(readState()?.appUrl ?? "")).toBe(true);
    // 「閉じる」はフッターのボタンと右上の × （aria-label）の 2 つあるので、文字を持つ方を押す
    await result.getByRole("button", { name: "閉じる" }).filter({ hasText: "閉じる" }).click();

    const row = listRow(page, email);
    await expect(row).toContainText("閲覧者");
    await expect(row).toContainText("未受諾");
  });

  test("監査ログに drivers の INSERT（テスト太郎）が記録される", async ({ page }) => {
    await page.goto("/settings/audit?table=drivers&action=INSERT");
    await expect(page.getByRole("heading", { name: "監査ログ" })).toBeVisible();
    await expect(page.getByLabel("テーブル")).toHaveValue("drivers");
    await expect(page.getByLabel("操作")).toHaveValue("INSERT");
    // 監査ログはデータ全削除でも消えないため、以前の実行分がある場合は最新（先頭）を見る
    const row = listRow(page, DRIVER_NAME).first();
    await expect(row).toContainText("追加");
    await expect(row).toContainText("ドライバー");
    await expect(row).toContainText("オーナー");
    // UPDATE（停止中への変更）も記録されている
    await page.goto("/settings/audit?table=drivers&action=UPDATE");
    const upd = listRow(page, DRIVER_NAME).first();
    await expect(upd).toContainText("更新");
    await expect(upd).toContainText("状態");
  });
});
