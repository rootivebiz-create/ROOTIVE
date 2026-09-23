import { expect, test } from "@playwright/test";
import { asDriver, expectNoHorizontalScroll, expectTapTargets, firstStatementLink, MONTH, startDemo } from "./helpers";

/**
 * スマホ（320px・375px）とパソコンで、主な画面が横にはみ出さない・押せる所が 44px 以上（SPEC 4-0）。
 * デモの架空の会社を 1 つ作り、その中の画面を順に開く
 */
const PAGES = [
  "/",
  `/import?m=${MONTH}`,
  `/work?m=${MONTH}`,
  `/watch?m=${MONTH}`,
  `/terms`,
  `/statements?m=${MONTH}`,
  `/close?m=${MONTH}`,
  `/transfer?m=${MONTH}`,
  `/parallel?m=${MONTH}`,
  `/reconcile?m=${MONTH}`,
  `/profit?m=${MONTH}`,
  `/export?m=${MONTH}`,
  "/settings",
  "/help",
];

test.describe.configure({ mode: "serial" });

test("デモの入口は、開いただけでは会社を作らない（ボタンを押したときだけ）", async ({ page }) => {
  await page.goto("/demo/start");
  await expect(page.getByRole("button", { name: "デモを始める" })).toBeVisible();
  await expectNoHorizontalScroll(page, "/demo/start");
  // ログインしていないので、ほかの画面を開くと入口に戻る（ループしない）
  await page.goto("/statements");
  await expect(page).toHaveURL(/\/demo\/start/);
});

test("主な画面が横にはみ出さず、スマホでは押せる所が 44px 以上。いまの画面のメニューに印が付く", async ({ page }) => {
  await startDemo(page);
  for (const path of PAGES) {
    const errors: string[] = [];
    page.on("pageerror", (e) => errors.push(e.message));
    const res = await page.goto(path);
    expect(res?.status(), path).toBe(200);
    await expect(page.locator("h1").first()).toBeVisible();
    await expectNoHorizontalScroll(page, path);
    await expectTapTargets(page, path);
    // いま開いている画面の項目に印（aria-current）が 1 つ付いている（見えているメニューの中で）
    await expect(page.locator('nav[aria-label="メニュー"]:visible [aria-current="page"]')).toHaveCount(1);
    expect(errors, path).toEqual([]);
    page.removeAllListeners("pageerror");
  }
});

test("明細の画面と、ドライバーのリンク（/s）がはみ出さない", async ({ page, browser }, info) => {
  await startDemo(page);
  const { detailUrl, driverUrl } = await firstStatementLink(page);
  await page.goto(detailUrl);
  await expectNoHorizontalScroll(page, "明細の画面");
  // 明細の検索（月をまたいで探す）
  await page.goto(`/records?from=${MONTH}&to=${MONTH}`);
  await expect(page.getByRole("link", { name: "いまの明細を開く" }).first()).toBeVisible();
  await expectNoHorizontalScroll(page, "/records");
  await expectTapTargets(page, "/records");
  const viewport = info.project.use.viewport ?? { width: 375, height: 812 };
  const driver = await asDriver(browser, driverUrl, viewport);
  await expect(driver.page.getByRole("button", { name: "内容を確認しました" })).toBeVisible();
  await expectNoHorizontalScroll(driver.page, "/s（ドライバーの明細）");
  await expectTapTargets(driver.page, "/s（ドライバーの明細）");
  await driver.context.close();
});

test("取引条件のドライバーのリンク（/t）がはみ出さない", async ({ page, browser }, info) => {
  await startDemo(page);
  await page.goto("/terms");
  // 未作成の人の明示書をまとめて作る（押すと、作る人数と中身を見せてから作る）
  const bulk = page.getByRole("button", { name: /^未作成の人の明示書をまとめて作る（/ });
  if (await bulk.isVisible().catch(() => false)) {
    await bulk.click();
    await page.getByRole("button", { name: /人分を作る$/ }).click();
    await expect(page.getByRole("button", { name: /人分を作る$/ })).toHaveCount(0);
  }
  await page.goto("/terms");
  await page.locator('a[href^="/terms/"]').first().click();
  await page.waitForURL(/\/terms\/[0-9a-f-]{36}/);
  await expectNoHorizontalScroll(page, "取引条件（1 人）");
  const url = await page.getByLabel("ドライバー用のリンク").inputValue();
  expect(url).toContain("/t/");
  const viewport = info.project.use.viewport ?? { width: 375, height: 812 };
  const driver = await asDriver(browser, url, viewport);
  await expect(driver.page.getByRole("heading", { name: "取引条件のお知らせ" })).toBeVisible();
  await expectNoHorizontalScroll(driver.page, "/t（ドライバーの取引条件）");
  await expectTapTargets(driver.page, "/t（ドライバーの取引条件）");
  await driver.context.close();
});

test("区切りの無い長いファイル名でも、突合の画面がはみ出さない", async ({ page }) => {
  await startDemo(page);
  await page.goto(`/reconcile?m=${MONTH}`);
  const csv = "品目,数量,単価,金額\n宅配（個建て）,100,190,19000\n";
  await page.locator('input[type="file"][name="file"]').first().setInputFiles({
    name: "motouke_payment_notice_202610_final_version_from_the_client_portal.csv",
    mimeType: "text/csv",
    buffer: Buffer.from(csv, "utf8"),
  });
  await page.getByRole("button", { name: "取り込んで突き合わせる" }).click();
  await page.waitForURL(/\/reconcile\/[0-9a-f-]{36}/);
  await expect(page.getByText("motouke_payment_notice_202610_final_version_from_the_client_portal.csv").first()).toBeVisible();
  await expectNoHorizontalScroll(page, "突合の結果（長いファイル名）");
});
