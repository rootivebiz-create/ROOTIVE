/**
 * 事務員（clerk・0027）と、事務の送る仕事（0028）：
 *   事務員の出し分け → 請求書をメールで送る → 月を締めると LINE で明細が届く → 選んで送り直す → 締めのあとの手順、
 * と使い方ガイド（全体・各ページ）。
 *
 * LINE とメールはテストサーバーのモック（/__mock）に届き、/__test/outbox で中身を確かめる。
 * 前提：§8.6 の初期データ（resetToSeed）。テストは順番に依存するため serial
 */
import { test, expect, type Locator, type Page } from "@playwright/test";
import { E2E, adminSql, createInvitation, driverIdByName, listRow, loginViaInvite, loginViaMagicLink, readState, requireState, resetToSeed, saveScreenshot, setMonthClosed, toast } from "./helpers";

test.describe.configure({ mode: "serial" });

const MONTH = "2026-09";
const CLIENT = "E2E 物流株式会社";
const CLIENT_EMAIL = "keiri@e2e.test";

interface LineMessage {
  to: string;
  text: string;
}
interface MailMessage {
  to: string[];
  subject: string;
  attachments: { filename: string; size: number }[];
}

async function outbox<T>(kind: "line" | "mail"): Promise<T[]> {
  const r = await fetch(`${requireState().liteUrl}/__test/outbox?kind=${kind}`);
  return (await r.json()) as T[];
}

async function clearOutbox(): Promise<void> {
  await fetch(`${requireState().liteUrl}/__test/outbox/clear`, { method: "POST" });
}

/** 押した操作が画面の準備前に取りこぼされても、ダイアログが開くまで押し直す */
async function openDialog(page: Page, trigger: Locator, name: string | RegExp): Promise<Locator> {
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

test.describe("事務員と、事務の送る仕事", () => {
  test.beforeAll(async () => {
    const state = readState();
    if (!state || state.appSkipped) return;
    await resetToSeed();
    await setMonthClosed(MONTH, false);
    const { companyId } = requireState();
    adminSql(
      `delete from public.statement_deliveries; delete from public.invoice_sends; delete from public.month_close_checks;
       delete from public.invoice_items where company_id = '${companyId}'; delete from public.invoices where company_id = '${companyId}';
       update public.projects set client_id = null, client_name = '' where company_id = '${companyId}';
       delete from public.clients where company_id = '${companyId}';
       update public.drivers set line_user_id = '' where company_id = '${companyId}';`,
    );
    // 取引先（送り先メールつき）を三郷Amazon に紐づける
    adminSql(
      `with c as (
         insert into public.clients (company_id, name, honorific, email, payment_month_offset, payment_day, sort_order)
         values ('${companyId}', '${CLIENT}', '御中', '${CLIENT_EMAIL}', 1, 0, 1) returning id
       )
       update public.projects set client_id = (select id from c) where company_id = '${companyId}' and name = '三郷Amazon'`,
    );
    // LINE 連携（モックへ届く）。相曽慧・沼田基だけ LINE と連携済み
    adminSql(
      `insert into public.integrations (company_id, kind, is_enabled, config) values ('${companyId}', 'line', true, '{"notifyStatement": true}')
         on conflict (company_id, kind) do update set is_enabled = true, config = excluded.config;
       insert into public.integration_secrets (company_id, kind, secrets) values ('${companyId}', 'line', '{"channelAccessToken": "e2e-token", "channelSecret": "e2e-secret"}')
         on conflict (company_id, kind) do update set secrets = excluded.secrets;
       update public.drivers set line_user_id = 'Ue2eaiso0000000000000000000000001' where id = '${driverIdByName("相曽慧")}';
       update public.drivers set line_user_id = 'Ue2enumata000000000000000000000002' where id = '${driverIdByName("沼田基")}';`,
    );
    await clearOutbox();
  });

  test.afterAll(async () => {
    const state = readState();
    if (!state || state.appSkipped) return;
    const { companyId } = requireState();
    adminSql(
      `delete from public.integration_secrets where company_id = '${companyId}' and kind = 'line';
       update public.integrations set is_enabled = false, config = '{}' where company_id = '${companyId}' and kind = 'line';
       delete from public.statement_deliveries; delete from public.invoice_sends; delete from public.month_close_checks;`,
    );
    await clearOutbox();
    await resetToSeed();
  });

  test("事務員はログインすると事務が開き、経営の数字は出ない", async ({ page }, testInfo) => {
    await loginViaMagicLink(page, E2E.users.clerk.email, "/");
    await expect(page).toHaveURL(/\/office(\?|$|#)/);
    await expect(page.getByRole("heading", { name: "事務", exact: true })).toBeVisible();
    await saveScreenshot(page, `clerk-office-${testInfo.project.name}.png`);

    // ホームは開けず、事務へ戻される
    await page.goto(`/dashboard?m=${MONTH}`);
    await expect(page).toHaveURL(/\/office/);
    await page.goto(`/cashflow`);
    await expect(page).toHaveURL(/\/office/);

    // ナビに経営の画面が無い（PC はサイドナビ、スマホはメニュー）
    if (testInfo.project.name === "mobile") {
      const tabs = page.getByRole("navigation", { name: "メインナビゲーション" }).last();
      await expect(tabs.getByRole("link").first()).toContainText("事務");
      await expect(tabs.getByRole("link", { name: /ホーム/ })).toHaveCount(0);
    } else {
      const side = page.getByRole("navigation", { name: "メインナビゲーション" }).first();
      await expect(side.getByRole("link", { name: "事務", exact: true })).toBeVisible();
      await expect(side.getByRole("link", { name: /ホーム|資金繰り|財務|レポート|AI 相談/ })).toHaveCount(0);
    }

    // 稼働入力・支払明細に行ごとの利益・会社利益が出ない
    await page.goto(`/entries?m=${MONTH}`);
    await expect(page.getByRole("button", { name: /稼働を追加/ }).first()).toBeVisible();
    await expect(page.getByText("行の利益")).toHaveCount(0);
    await page.goto(`/payouts?m=${MONTH}`);
    await expect(page.getByRole("heading", { name: "支払明細" })).toBeVisible();
    await expect(page.getByText("会社利益")).toHaveCount(0);
    await expect(page.getByRole("link", { name: /支払一覧 CSV/ })).toHaveCount(0);

    // 出力に経営レポート・バックアップが出ない
    await page.goto(`/exports?m=${MONTH}`);
    await expect(page.getByText("事務員は事務に使う出力")).toBeVisible();
    await expect(page.getByText("経営レポート", { exact: true })).toHaveCount(0);
    await expect(page.getByText("全データ JSON", { exact: true })).toHaveCount(0);

    // 出力の口も閉じている
    const res = await page.request.get(`/api/export/month-report.pdf?m=${MONTH}`);
    expect(res.status()).toBe(403);
  });

  test("請求書を作って、発行と同時にメールで送る（PDF 添付・送った記録）", async ({ page }) => {
    await loginViaMagicLink(page, E2E.users.clerk.email, `/invoices?m=${MONTH}`);
    const row = listRow(page, CLIENT);
    await row.getByRole("button", { name: /請求書を作成/ }).click();
    // 作ると請求書の画面が開く
    await expect(toast(page, "稼働から請求明細を作成しました")).toBeVisible();
    await expect(page).toHaveURL(/\/invoices\/[0-9a-f-]{36}/);

    const { companyId } = requireState();
    const invoiceId = adminSql(`select id from public.invoices where company_id = '${companyId}' and month = '${MONTH}-01'`);
    const card = page.locator("#mail");
    await expect(card.getByTestId("invoice-mail-status")).toContainText("まだ送っていません");
    await page.waitForLoadState("networkidle");

    const dialog = await openDialog(page, card.getByRole("button", { name: /発行してメールで送る/ }), "請求書をメールで送る");
    await expect(dialog.getByLabel("宛先")).toHaveValue(CLIENT_EMAIL);
    await expect(dialog).toContainText("2026年9月分");
    await dialog.getByRole("button", { name: "発行して送る" }).click();
    await expect(toast(page, `発行して、${CLIENT_EMAIL} へ請求書を送りました`)).toBeVisible();
    await expect(card.getByTestId("invoice-mail-status")).toContainText("送信済み");

    const mails = await outbox<MailMessage>("mail");
    expect(mails).toHaveLength(1);
    expect(mails[0].to).toEqual([CLIENT_EMAIL]);
    expect(mails[0].subject).toContain("ご請求書のご送付");
    expect(mails[0].attachments[0].filename).toMatch(/\.pdf$/);
    expect(mails[0].attachments[0].size).toBeGreaterThan(1000);
    expect(adminSql(`select status from public.invoices where id = '${invoiceId}'`)).toBe("issued");
    expect(adminSql(`select count(*) from public.invoice_sends where invoice_id = '${invoiceId}' and status = 'sent'`)).toBe("1");

    // 送れなかったときは理由が残る
    const again = await openDialog(page, card.getByRole("button", { name: /もう一度送る/ }), "請求書をメールで送る");
    await again.getByLabel("宛先").fill("fail@e2e.test");
    await again.getByRole("button", { name: "送る", exact: true }).click();
    await expect(toast(page, /宛先か差出人の形が正しくありません/)).toBeVisible();
    await expect(card.locator('[data-send-status="failed"]')).toBeVisible();
    expect(adminSql(`select count(*) from public.invoice_sends where invoice_id = '${invoiceId}' and status = 'failed'`)).toBe("1");
  });

  test("事務員が月を締めると、LINE と連携している人へ明細が届き、手順に送った人数が出る", async ({ page }) => {
    await clearOutbox();
    await loginViaMagicLink(page, E2E.users.clerk.email, "/settings/months");
    const row = listRow(page, "2026年9月");
    await expect(row).toContainText("未締め");
    await row.getByRole("button", { name: "この月を締める" }).click();
    const dialog = page.getByRole("dialog");
    // 事務員には会社利益を出さない
    await expect(dialog).not.toContainText("会社利益");
    await dialog.getByRole("button", { name: "この月を締める" }).click();
    await expect(toast(page, /2026年9月 を締めました。LINE で 2 人に連絡しました。/)).toBeVisible();

    const lines = await outbox<LineMessage>("line");
    expect(lines.map((l) => l.to).sort()).toEqual(["Ue2eaiso0000000000000000000000001", "Ue2enumata000000000000000000000002"]);
    expect(lines[0].text).toContain("支払明細ができました");
    expect(lines[0].text).toContain(`/driver/statements/${MONTH}`);

    const { companyId } = requireState();
    const targets = Number(adminSql(`select count(distinct driver_id) from public.work_entries where company_id = '${companyId}' and month = '${MONTH}-01' and qty > 0`));
    expect(adminSql(`select count(*) from public.statement_deliveries where company_id = '${companyId}' and month = '${MONTH}-01'`)).toBe("2");

    // 事務：締めたあとの手順。LINE で送れる人はもう居ないので、送る操作は出ずにチェックだけ
    await page.goto(`/office?m=${MONTH}`);
    const card = page.locator("#closing");
    await expect(card.locator('[data-step="close"]')).toHaveAttribute("data-status", "done");
    const step = card.locator('[data-step="statements_sent"]');
    await expect(step).toHaveAttribute("data-status", "todo");
    await expect(step).toContainText(`${targets} 人中 2 人に送りました`);
    await expect(step.getByRole("button", { name: "LINE で送る" })).toHaveCount(0);
    // 並びは 締める → 明細の送付 → 振込
    const order = await card.locator("[data-step]").evaluateAll((els) => els.map((e) => e.getAttribute("data-step")));
    expect(order.slice(-3)).toEqual(["close", "statements_sent", "transfer_done"]);

    // 今日やることに「締めのあと」が出る
    await page.goto("/office");
    await expect(page.locator('[data-inbox="after_close"]')).toContainText("2026年9月の締めのあと");
  });

  test("支払の画面で 1 人ずつの状態を見て、選んで送り直せる。PDF を渡した人はチェックで済みにする", async ({ page }) => {
    await clearOutbox();
    await loginViaMagicLink(page, E2E.users.clerk.email, `/payouts?m=${MONTH}`);
    const card = page.locator("#statements");
    await expect(card.getByTestId("statement-sent-count")).toContainText("2 人に送信済み");
    await expect(card.locator('[data-statement="相曽慧"]')).toHaveAttribute("data-status", "sent");
    await expect(card.locator('[data-status="no_contact"]').first()).toBeVisible();
    await page.waitForLoadState("networkidle");

    const dialog = await openDialog(page, card.getByRole("button", { name: /選んで送る・送り直す/ }), "送る人を選ぶ");
    await dialog.getByRole("checkbox", { name: "相曽慧に送る" }).click();
    await dialog.getByRole("button", { name: "1 人に送る" }).click();
    await expect(toast(page, "支払明細を 1 人に送りました（LINE 1）。")).toBeVisible();
    const lines = await outbox<LineMessage>("line");
    expect(lines).toHaveLength(1);
    expect(lines[0].to).toBe("Ue2eaiso0000000000000000000000001");

    // 残りは LINE が届かない人 → PDF を渡してチェック。振込もチェックすると「締めのあと」が消える
    await page.goto(`/office?m=${MONTH}`);
    const closing = page.locator("#closing");
    await page.waitForLoadState("networkidle");
    await closing.getByRole("checkbox", { name: "支払明細をドライバーへ送った" }).click();
    await expect(toast(page, "チェックしました")).toBeVisible();
    await expect(closing.locator('[data-step="statements_sent"]')).toHaveAttribute("data-status", "done");
    await expect(closing.locator('[data-step="statements_sent"]')).toContainText("事務員さんが付けました");
    await closing.getByRole("checkbox", { name: "振込を済ませた" }).click();
    await expect(closing.locator('[data-step="transfer_done"]')).toHaveAttribute("data-status", "done");
    await page.goto("/office");
    await expect(page.locator('[data-inbox="after_close"]')).toHaveCount(0);
  });
});

test.describe("使い方ガイド", () => {
  test("「？」でいまの画面の使い方が出て、全体のガイドへ移れる", async ({ page }, testInfo) => {
    await loginViaMagicLink(page, E2E.users.admin.email, `/entries?m=${MONTH}`);
    await page.waitForLoadState("networkidle");
    const trigger =
      testInfo.project.name === "mobile"
        ? null
        : page.getByRole("button", { name: "この画面の使い方" });
    let dialog: Locator;
    if (trigger) {
      dialog = await openDialog(page, trigger, "使い方：稼働入力");
    } else {
      // スマホはヘッダーに出さず、下の「メニュー」から開く
      const nav = page.getByRole("navigation", { name: "メインナビゲーション" }).last();
      const menu = await openDialog(page, nav.getByRole("button", { name: "メニュー", exact: true }), "メニュー");
      await menu.getByRole("button", { name: "この画面の使い方" }).click();
      dialog = page.getByRole("dialog", { name: "使い方：稼働入力" });
      await expect(dialog).toBeVisible();
    }
    await expect(dialog).toContainText("稼働を追加");
    await expect(dialog).toContainText("声で入力");
    await saveScreenshot(page, `guide-help-${testInfo.project.name}.png`);
    await dialog.getByRole("link", { name: "使い方ガイド（全体）" }).click();
    await expect(page).toHaveURL(/\/guide#entries/);
    await expect(page.getByRole("heading", { name: "使い方ガイド" })).toBeVisible();
    await expect(page.locator("#monthly")).toContainText("月を締めます");
    await expect(page.locator("#entries")).toBeVisible();
  });

  test("事務員の全体ガイドには、見られない画面のガイドが出ない", async ({ page }) => {
    await loginViaMagicLink(page, E2E.users.clerk.email, "/guide");
    await expect(page.locator("#office")).toBeVisible();
    await expect(page.locator("#dashboard")).toHaveCount(0);
    await expect(page.locator("#cashflow")).toHaveCount(0);
    await expect(page.locator("#setup")).toHaveCount(0);
  });

  test("ドライバーは自分の画面のガイドを見られる", async ({ page }) => {
    const token = createInvitation({ email: `driver-guide-${Date.now()}@example.com`, role: "driver", driverId: driverIdByName("石田泰典"), displayName: "石田泰典" });
    await loginViaInvite(page, token);
    await page.goto("/driver/today");
    const dialog = await openDialog(page, page.getByRole("button", { name: "この画面の使い方" }), "使い方：今日の報告");
    await expect(dialog).toContainText("出発を記録");
    await dialog.getByRole("link", { name: "使い方ガイド（全体）" }).click();
    await expect(page).toHaveURL(/\/driver\/guide/);
    await expect(page.locator("#driver-daily")).toContainText("終了を記録");
  });
});
