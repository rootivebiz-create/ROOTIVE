/**
 * 社内チャットと異常の検知（0011）
 * 前提：§8.6 の初期データ（resetToSeed）。テストは順番に依存するため serial
 */
import { test, expect } from "@playwright/test";
import { E2E, adminSql, loginViaMagicLink, readState, requireState, resetToSeed, saveScreenshot, setMonthClosed, toast } from "./helpers";

test.describe.configure({ mode: "serial" });

const MONTH = "2026-09";

function clearChatAndAlerts(): void {
  const { companyId } = requireState();
  adminSql(
    `delete from public.chat_messages where company_id = '${companyId}';
     delete from public.chat_reads where company_id = '${companyId}';
     delete from public.alerts where company_id = '${companyId}';`,
  );
}

test.beforeEach(async () => {
  const state = readState();
  test.skip(!state || state.appSkipped, "E2E_SKIP_APP=1 のため Next.js を起動していません");
});

test.describe("社内チャット", () => {
  test.beforeAll(async () => {
    const state = readState();
    if (!state || state.appSkipped) return;
    await resetToSeed();
    await setMonthClosed(MONTH, false);
    clearChatAndAlerts();
  });

  test.afterAll(async () => {
    const state = readState();
    if (!state || state.appSkipped) return;
    clearChatAndAlerts();
  });

  test("既定のルームが並び、オーナーが発言できる", async ({ page }, testInfo) => {
    await loginViaMagicLink(page, E2E.users.owner.email, "/chat");
    await expect(page.getByRole("heading", { name: "チャット" })).toBeVisible();
    // PC のサイドナビにも「経営」の見出しがあるため、見えているものだけを対象にする
    await expect(page.getByText("全体").filter({ visible: true }).first()).toBeVisible();
    await expect(page.getByText("経営").filter({ visible: true }).first()).toBeVisible();

    await page.getByRole("link", { name: /全体/ }).first().click();
    await expect(page.getByLabel("メッセージ")).toBeVisible();
    await page.getByLabel("メッセージ").fill("今月もよろしくお願いします");
    await page.getByRole("button", { name: "送信" }).click();
    await expect(page.getByText("今月もよろしくお願いします")).toBeVisible();
    if (testInfo.project.name === "mobile") await saveScreenshot(page, "chat-mobile.png");
  });

  test("閲覧者も発言でき、オーナーには未読が出る", async ({ page }) => {
    await loginViaMagicLink(page, E2E.users.viewer.email, "/chat");
    await page.getByRole("link", { name: /全体/ }).first().click();
    await expect(page.getByText("今月もよろしくお願いします")).toBeVisible();
    await page.getByLabel("メッセージ").fill("確認しました");
    await page.getByRole("button", { name: "送信" }).click();
    await expect(page.getByText("確認しました")).toBeVisible();

    // オーナーから見ると未読が 1 件（閲覧者の発言）
    await loginViaMagicLink(page, E2E.users.owner.email, "/chat");
    await expect(page.getByText(/未読が 1 件あります/)).toBeVisible();
    await page.getByRole("link", { name: /全体/ }).first().click();
    await expect(page.getByText("確認しました")).toBeVisible();

    // 開くと既読になる（既読の反映は画面側の効果なので、読み直しながら待つ）
    await expect(async () => {
      await page.goto(`${E2E.appUrl}/chat`);
      await expect(page.getByText(/未読が/)).toHaveCount(0);
    }).toPass({ timeout: 15_000 });
  });

});

test.describe("気になること（異常の検知）", () => {
  test.beforeAll(async () => {
    const state = readState();
    if (!state || state.appSkipped) return;
    await resetToSeed();
    await setMonthClosed(MONTH, false);
    clearChatAndAlerts();
    // 数量 0 の稼働を 1 件だけ作って、確実に検知させる
    const { companyId } = requireState();
    adminSql(
      `insert into public.work_entries (company_id, month, driver_id, project_item_id, qty, bill_rate, pay_rate, royalty_rate)
       select '${companyId}', '2026-09-01', x.driver_id, x.item_id, 0, x.bill_rate, x.pay_rate, x.royalty_rate
         from (
           select d.id as driver_id, i.id as item_id, ed.bill_rate, ed.pay_rate, ed.royalty_rate
             from public.drivers d
             cross join public.project_items i
             cross join lateral public.entry_defaults(d.id, i.id) ed
            where d.company_id = '${companyId}' and d.is_active and i.company_id = '${companyId}' and i.is_active
              and not exists (
                select 1 from public.work_entries w
                 where w.month = '2026-09-01' and w.driver_id = d.id and w.project_item_id = i.id
              )
            limit 1
         ) x;`,
    );
  });

  test.afterAll(async () => {
    const state = readState();
    if (!state || state.appSkipped) return;
    clearChatAndAlerts();
  });

  test("検査すると数量 0 の稼働が見つかり、対応済みにできる", async ({ page }, testInfo) => {
    await loginViaMagicLink(page, E2E.users.owner.email, `/alerts?m=${MONTH}`);
    await expect(page.getByRole("heading", { name: "気になること" })).toBeVisible();

    await page.getByRole("button", { name: /今すぐ検査する/ }).click();
    await expect(toast(page, /見つかりました|ありませんでした/)).toBeVisible();
    await expect(page.getByText(/数量が 0 の稼働/).first()).toBeVisible();
    if (testInfo.project.name === "mobile") await saveScreenshot(page, "alerts-mobile.png");

    // 対応済みにするとタブから消える（数量 0 の行だけを操作する）
    const qtyRow = page.locator("li").filter({ hasText: "数量が 0 の稼働" }).first();
    await qtyRow.getByRole("button", { name: "対応済みにする" }).click();
    await expect(toast(page, /変更しました|対応済み/)).toBeVisible();
    await expect(page.getByText(/数量が 0 の稼働/)).toHaveCount(0);

    await page.getByRole("link", { name: "対応済み" }).click();
    await expect(page.getByText(/数量が 0 の稼働/).first()).toBeVisible();
  });

  test("CSV を取得できる", async ({ page }) => {
    await loginViaMagicLink(page, E2E.users.owner.email, `/alerts?m=${MONTH}&status=all`);
    const [download] = await Promise.all([page.waitForEvent("download"), page.getByRole("link", { name: "CSV" }).click()]);
    const stream = await download.createReadStream();
    const chunks: Buffer[] = [];
    for await (const c of stream) chunks.push(Buffer.from(c));
    const csv = Buffer.concat(chunks).toString("utf8");
    expect(csv).toContain("重さ");
    expect(csv).toContain("数量が 0 の稼働");
  });

  test("閲覧者は検査も状態変更もできない", async ({ page }) => {
    await loginViaMagicLink(page, E2E.users.viewer.email, `/alerts?m=${MONTH}&status=all`);
    await expect(page.getByRole("heading", { name: "気になること" })).toBeVisible();
    await expect(page.getByRole("button", { name: /今すぐ検査する/ })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "対応済みにする" })).toHaveCount(0);
  });

  test("ダッシュボードのカードから一覧へ移動できる", async ({ page }) => {
    await loginViaMagicLink(page, E2E.users.owner.email, `/alerts?m=${MONTH}`);
    await page.getByRole("button", { name: /今すぐ検査する/ }).click();
    await expect(toast(page, /見つかりました|ありませんでした/)).toBeVisible();

    // スマホではサイドナビが隠れているため、本文（main）の中のカードを見る
    await page.goto(`${E2E.appUrl}/dashboard?m=${MONTH}`);
    await expect(page.getByRole("main").getByText("気になること").first()).toBeVisible();
    await page.getByRole("main").getByRole("link", { name: /すべて見る/ }).first().click();
    await expect(page.getByRole("heading", { name: "気になること" })).toBeVisible();
  });
});
