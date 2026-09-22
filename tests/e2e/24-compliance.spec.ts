/**
 * 法令対応（0024）：運転者台帳の記入 → 監査で足りないものが消える →
 * 適性診断の記録 → 保存期間の一覧 → 監査一式 ZIP と運転者台帳 PDF。
 * 前提：§8.6 の初期データ（resetToSeed）。テストは順番に依存するため serial
 */
import { test, expect } from "@playwright/test";
import { E2E, adminSql, driverIdByName, loginViaMagicLink, readState, requireState, resetToSeed, saveScreenshot, toast } from "./helpers";

test.describe.configure({ mode: "serial" });

test.beforeEach(async () => {
  const state = readState();
  test.skip(!state || state.appSkipped, "E2E_SKIP_APP=1 のため Next.js を起動していません");
});

test.describe("法令対応", () => {
  test.beforeAll(async () => {
    const state = readState();
    if (!state || state.appSkipped) return;
    await resetToSeed();
    adminSql("delete from public.aptitude_tests");
    adminSql("delete from public.driver_instructions");
    adminSql("delete from public.documents");
    adminSql(
      "update public.drivers set birth_date = null, address = '', hired_on = null, appointed_on = null, retired_on = null, roster_no = '', license_kinds = '', license_conditions = ''",
    );
  });

  test("足りないものが一覧に出て、台帳を埋めると消える", async ({ page }, testInfo) => {
    await loginViaMagicLink(page, E2E.users.owner.email, "/compliance");
    await expect(page.getByRole("heading", { name: "法令対応" })).toBeVisible();

    // 台帳が空なので「記入漏れ」と「免許証の記録なし」が出る
    await expect(page.getByText("運転者台帳の記入漏れ")).toBeVisible();
    await expect(page.getByText("運転免許証の記録なし")).toBeVisible();
    if (testInfo.project.name === "mobile") await saveScreenshot(page, "compliance-mobile.png");

    // 台帳を埋める（設定 → ドライバー）
    const driverId = driverIdByName("相曽慧");
    await page.goto(`${E2E.appUrl}/settings/drivers/${driverId}`);
    await expect(page.getByRole("heading", { name: "運転者台帳" })).toBeVisible();

    // 入力は「値が残るまで入れ直す」。読み込んだ直後はまだ React が動いておらず、
    // 先に入れた値が上書きで消えることがあるため（消えたまま保存すると原因が分からなくなる）
    const fill = async (label: string, value: string) => {
      const input = page.getByLabel(label, { exact: true });
      await expect
        .poll(async () => {
          await input.fill(value);
          return input.inputValue();
        })
        .toBe(value);
    };
    await fill("生年月日", "1986-04-01");
    await fill("住所", "埼玉県三郷市1-2-3");
    await fill("雇入れ年月日", "2024-04-01");
    await fill("選任年月日", "2024-04-01");
    await fill("免許の種類", "普通");
    await page.getByRole("button", { name: "保存する", exact: true }).click();
    await expect(toast(page, "保存しました")).toBeVisible();
    // 画面の表示ではなく DB で確かめる（保存が届いていないと後の判定が読めなくなる）
    await expect
      .poll(() => adminSql(`select coalesce(birth_date::text, '') || '/' || address from public.drivers where id = '${driverId}'`))
      .toBe("1986-04-01/埼玉県三郷市1-2-3");

    // 保存が DB に届いたことを先に確かめる（届いていないと次の判定が読めなくなる）
    await expect
      .poll(() => adminSql(`select coalesce(birth_date::text, '(null)') from public.drivers where id = '${driverId}'`))
      .toBe("1986-04-01");

    // 台帳の記入漏れから相曽慧が消える（画面の見出しは他の人の分が残るので、判定は DB のビューで確かめる）
    await expect
      .poll(() => adminSql(`select count(*) from public.v_compliance_gaps where kind = 'roster_incomplete' and driver_id = '${driverId}'`))
      .toBe("0");
    await page.goto(`${E2E.appUrl}/compliance`);
    await expect(page.getByRole("heading", { name: "法令対応" })).toBeVisible();
  });

  test("運転者台帳のタブに入力した内容が並ぶ", async ({ page }) => {
    await loginViaMagicLink(page, E2E.users.owner.email, "/compliance");
    await page.getByRole("tab", { name: "運転者台帳" }).click();
    const row = page.getByRole("row").filter({ hasText: "相曽慧" });
    await expect(row).toContainText("1986-04-01");
    await expect(row).toContainText("2024-04-01");
  });

  test("適性診断を記録すると台帳と監査の不足に反映される", async ({ page }) => {
    await loginViaMagicLink(page, E2E.users.owner.email, "/settings/safety");
    await page.getByRole("button", { name: "適性診断を記録" }).click();
    const dialog = page.getByRole("dialog");
    await dialog.getByLabel("ドライバー").selectOption({ label: "相曽慧" });
    await dialog.getByLabel("種類").selectOption("initial");
    await dialog.getByLabel("受診日").fill("2024-04-10");
    await dialog.getByLabel("実施機関（任意）").fill("適性診断センター");
    await dialog.getByRole("button", { name: "保存" }).click();
    await expect(toast(page, "適性診断の記録を保存しました")).toBeVisible();

    await expect.poll(() => adminSql("select count(*) from public.aptitude_tests")).toBe("1");

    // 初任診断の不足が消える
    await page.goto(`${E2E.appUrl}/compliance`);
    await expect(page.getByText("初任診断なし")).toHaveCount(0);
  });

  test("保存期間の一覧が出る", async ({ page }) => {
    await loginViaMagicLink(page, E2E.users.owner.email, "/compliance");
    await page.getByRole("tab", { name: "保存期間" }).click();
    await expect(page.getByText("運転日報・点呼記録")).toBeVisible();
    await expect(page.getByText("適性診断の記録")).toBeVisible();
    await expect(page.getByText(/自動では消しません/)).toBeVisible();
  });

  test("運転者台帳 PDF と監査一式 ZIP が出せる", async ({ page }) => {
    await loginViaMagicLink(page, E2E.users.owner.email, "/compliance");

    const pdf = await page.request.get("/api/export/roster.pdf?all=1");
    expect(pdf.status()).toBe(200);
    const pdfBody = await pdf.body();
    expect(pdfBody.subarray(0, 4).toString()).toBe("%PDF");
    expect(pdfBody.length).toBeGreaterThan(5000);

    const zip = await page.request.get("/api/export/audit-pack.zip");
    expect(zip.status()).toBe(200);
    const zipBody = await zip.body();
    expect(zipBody.subarray(0, 2).toString()).toBe("PK");

    const csv = await page.request.get("/api/export/compliance.csv?kind=roster");
    expect(csv.status()).toBe(200);
    const text = await csv.text();
    expect(text.charCodeAt(0)).toBe(0xfeff);
    expect(text).toContain("作成番号");
    expect(text).toContain("相曽慧");
  });

  test("閲覧者は台帳を編集できないが、出力はできる", async ({ page }) => {
    await loginViaMagicLink(page, E2E.users.viewer.email, "/compliance");
    await expect(page.getByRole("heading", { name: "法令対応" })).toBeVisible();
    const csv = await page.request.get("/api/export/compliance.csv?kind=aptitude");
    expect(csv.status()).toBe(200);

    const { companyId } = requireState();
    expect(adminSql(`select count(*) from public.aptitude_tests where company_id = '${companyId}'`)).toBe("1");
  });
});
