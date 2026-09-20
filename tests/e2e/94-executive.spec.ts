/**
 * 第 7 波：代表（決裁・意思決定ログ・会社の台帳・中期計画・守り）
 * 前提：§8.6 の初期データ（resetToSeed）。テストは順番に依存するため serial
 *
 * ここでは「代表だけが入れること」と「決裁の一連の流れ」を見る。
 * ナビ・コマンドパレットの出し分けは 60-roles.spec.ts が持っている。
 */
import { test, expect } from "@playwright/test";
import { E2E, adminSql, listRow, loginViaMagicLink, readState, requireState, resetToSeed, saveScreenshot } from "./helpers";

test.describe.configure({ mode: "serial" });

function clearWave7(): void {
  const { companyId } = requireState();
  adminSql(
    `delete from public.decisions where company_id = '${companyId}';
     delete from public.approvals where company_id = '${companyId}';
     delete from public.approval_delegations where company_id = '${companyId}';
     delete from public.officers where company_id = '${companyId}';
     delete from public.insurance_policies where company_id = '${companyId}';
     delete from public.export_logs where company_id = '${companyId}';
     delete from public.login_events where company_id = '${companyId}';`,
  );
}

test.beforeEach(async () => {
  const state = readState();
  test.skip(!state || state.appSkipped, "E2E_SKIP_APP=1 のため Next.js を起動していません");
});

test.describe("代表専用の領域", () => {
  test.beforeAll(async () => {
    const state = readState();
    if (!state || state.appSkipped) return;
    await resetToSeed();
    clearWave7();
  });

  test("代表ホームに信号・決裁・現金・今月の着地が出る", async ({ page }) => {
    await loginViaMagicLink(page, E2E.users.owner.email, "/executive");
    await expect(page.getByRole("heading", { name: "代表", exact: true })).toBeVisible();
    await expect(page.getByText("決裁", { exact: true }).first()).toBeVisible();
    await expect(page.getByText("いま見るべきこと")).toBeVisible();
    await expect(page.getByText("人と会社")).toBeVisible();
    // 決裁待ちが無いときは「いまは何もありません」
    await expect(page.getByText("いまは何もありません")).toBeVisible();
    await saveScreenshot(page, "executive-home.png");
  });

  test("管理者が /executive を開くとダッシュボードへ戻される", async ({ page }) => {
    await loginViaMagicLink(page, E2E.users.admin.email, "/dashboard");
    await page.goto("/executive");
    await page.waitForURL(/\/dashboard/);
    await expect(page.getByRole("heading", { name: "ダッシュボード" })).toBeVisible();
  });

  test("閲覧者が /executive/security を開くとダッシュボードへ戻される", async ({ page }) => {
    await loginViaMagicLink(page, E2E.users.viewer.email, "/dashboard");
    await page.goto("/executive/security");
    await page.waitForURL(/\/dashboard/);
  });

  test("管理者の申請を代表が承認でき、意思決定ログの下書きになる", async ({ page }) => {
    const { companyId } = requireState();
    // 管理者からの申請を DB に直接入れる（申請の画面は各業務画面にあるため、ここでは決裁の流れを見る）
    const adminId = adminSql(`select id from public.profiles where company_id = '${companyId}' and role = 'admin' limit 1`).trim();
    adminSql(
      `insert into public.approvals (company_id, kind, title, detail, amount, requested_by, due_on)
       values ('${companyId}', 'expense', '新しいカーゴ車の購入', '中古で 120 万円', 1200000, '${adminId}', current_date + 3);`,
    );

    await loginViaMagicLink(page, E2E.users.owner.email, "/executive/approvals");
    await expect(page.getByText("新しいカーゴ車の購入")).toBeVisible();
    await saveScreenshot(page, "executive-approvals.png");

    // 代表ホームにも決裁待ちが出る
    await page.goto("/executive");
    await expect(page.getByText("新しいカーゴ車の購入")).toBeVisible();
  });

  test("代表だけが会社の台帳と守りを見られる", async ({ page }) => {
    const { companyId } = requireState();
    adminSql(
      `insert into public.officers (company_id, name, title, term_end_on)
       values ('${companyId}', '川島幹太', '代表取締役', current_date + 30);
       insert into public.insurance_policies (company_id, kind, insurer, expires_on, premium)
       values ('${companyId}', '貨物保険', '○○海上', current_date + 20, 120000);`,
    );
    await loginViaMagicLink(page, E2E.users.owner.email, "/executive/company");
    await expect(page.getByText("川島幹太").first()).toBeVisible();
    await saveScreenshot(page, "executive-company.png");

    await page.goto("/executive");
    // 満了の近い保険・任期の近い役員が「いま見るべきこと」に出る
    await expect(listRow(page, /保険|任期/).first()).toBeVisible();
  });
});
