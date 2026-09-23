import { expect, test, type Page } from "@playwright/test";

/** 横にはみ出していない（ページ全体の横スクロールが出ない） */
async function expectNoHorizontalScroll(page: Page) {
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect(overflow, "ページが横にはみ出しています").toBeLessThanOrEqual(1);
}

const PAGES = [
  "/",
  "/product",
  "/demo",
  "/tools",
  "/tools/invoice-cost",
  "/tools/torihiki-joken",
  "/tools/payout",
  "/tools/payout?preset=publishing",
  "/tools/payout?preset=it",
  "/tools/payout?preset=beauty",
  "/tools/payout?preset=school",
  "/for",
  "/for/trucking",
  "/for/publishing",
  "/for/it",
  "/for/beauty",
  "/for/school",
  "/contact",
  "/about",
  "/legal/privacy",
  "/articles",
];

/** 印刷用の営業資料（検索には出さないが、開けて崩れないこと） */
const KIT_PAGES = [
  "/kit",
  "/kit/proposal",
  "/kit/fax",
  "/kit/fax?hook=70",
  "/kit/fax?hook=freelance",
  "/kit/fax?hook=safety",
  "/kit/flyer",
];

for (const path of KIT_PAGES) {
  test(`${path}（営業資料）が開ける`, async ({ page }) => {
    const errors: string[] = [];
    page.on("pageerror", (e) => errors.push(e.message));
    const res = await page.goto(path);
    expect(res?.status()).toBe(200);
    expect(errors).toEqual([]);
  });
}

for (const path of PAGES) {
  test(`${path} が開けて、横にはみ出さない`, async ({ page }) => {
    const errors: string[] = [];
    page.on("pageerror", (e) => errors.push(e.message));
    const res = await page.goto(path);
    expect(res?.status()).toBe(200);
    await expect(page.locator("h1").first()).toBeVisible();
    await expectNoHorizontalScroll(page);
    expect(errors).toEqual([]);
  });
}

test("記事はすべて開けて、出典が載っている", async ({ page }) => {
  await page.goto("/articles");
  const hrefs = await page.locator('a[href^="/articles/"]').evaluateAll((as) => as.map((a) => a.getAttribute("href")!));
  expect(hrefs.length).toBeGreaterThan(0);
  for (const href of [...new Set(hrefs)]) {
    const res = await page.goto(href);
    expect(res?.status(), href).toBe(200);
    await expect(page.getByRole("heading", { name: "出典・参考" })).toBeVisible();
    await expectNoHorizontalScroll(page);
  }
});

test.describe("製品のご紹介（スマホ 375px）", () => {
  test.use({ viewport: { width: 375, height: 812 } });

  test("/product が開けて、画面の説明が並び、横にはみ出さない", async ({ page }) => {
    const errors: string[] = [];
    page.on("pageerror", (e) => errors.push(e.message));
    const res = await page.goto("/product");
    expect(res?.status()).toBe(200);
    await expect(page.getByRole("heading", { level: 1, name: "製品のご紹介" })).toBeVisible();
    // ひと月の流れと画面ごとの中身の両方に出る
    await expect(page.getByRole("heading", { name: "元請との突き合わせ" }).first()).toBeVisible();
    await expect(page.getByRole("heading", { name: "親切の約束" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "しないこと" })).toBeVisible();
    await expectNoHorizontalScroll(page);
    expect(errors).toEqual([]);
  });

  test("ヘッダーから製品のご紹介へ行ける", async ({ page }) => {
    await page.goto("/");
    await page.getByRole("navigation", { name: "メイン" }).getByRole("link", { name: "製品" }).click();
    await expect(page).toHaveURL(/\/product$/);
    await expectNoHorizontalScroll(page);
  });
});

test("製品のデモの URL が未設定なら、製品のデモへのリンクを出さない", async ({ page }) => {
  test.skip(Boolean(process.env.NEXT_PUBLIC_PRODUCT_DEMO_URL), "製品のデモの URL を設定してビルドしたときは確かめない");
  for (const path of ["/", "/product", "/demo"]) {
    await page.goto(path);
    await expect(page.locator('a[href$="/demo/start"]'), path).toHaveCount(0);
    await expect(page.getByRole("link", { name: /製品のデモを触る/ }), path).toHaveCount(0);
  }
});

test("トップ：突き合わせと締めの見出し・無料で相談・今のツールで十分では？", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { level: 1 })).toContainText("元請の支払通知");
  await expect(page.getByRole("link", { name: /無料で相談する/ }).first()).toBeVisible();
  await expect(page.getByRole("heading", { name: "今お使いのツールで十分では？" })).toBeVisible();
});

test("デモ：支払明細・利益・振込データが出る", async ({ page }) => {
  await page.goto("/demo");
  await page.getByRole("tab", { name: "支払明細" }).or(page.getByRole("button", { name: "支払明細" })).first().click();
  await expect(page.getByText("青木 翔太").first()).toBeVisible();
  await page.getByRole("tab", { name: "利益" }).or(page.getByRole("button", { name: "利益" })).first().click();
  await expect(page.getByText("インボイスの負担").first()).toBeVisible();
  await page.getByRole("tab", { name: "振込データ" }).or(page.getByRole("button", { name: "振込データ" })).first().click();
  const [download] = await Promise.all([
    page.waitForEvent("download"),
    page.getByRole("button", { name: /振込データ.*(ダウンロード|作る|保存)|ダウンロード/ }).first().click(),
  ]);
  expect(download.suggestedFilename()).toMatch(/^furikomi_\d{6}\.txt$/);
  await expectNoHorizontalScroll(page);
});

test("デモ：印刷用の明細が開ける", async ({ page }) => {
  await page.goto("/demo/print");
  await expect(page.getByText("支払明細書").first()).toBeVisible();
  await expect(page.getByText("デモ").first()).toBeVisible();
});

test("計算ツール：10月以降は控除70%で負担を出す", async ({ page }) => {
  await page.clock.setFixedTime(new Date("2026-10-05T10:00:00+09:00"));
  await page.goto("/tools/invoice-cost");
  await expect(page.getByText("¥30,000").first()).toBeVisible();
});

test("問い合わせ：送り先が未設定なら、準備中と分かる", async ({ page }) => {
  await page.goto("/contact");
  await expect(page.getByText(/準備中/).first()).toBeVisible();
});

test.describe("とても狭い画面（320px）", () => {
  test.use({ viewport: { width: 320, height: 640 } });
  for (const path of ["/", "/product", "/demo", "/tools/invoice-cost", "/tools/payout", "/contact"]) {
    test(`${path} が 320px でも横にはみ出さない`, async ({ page }) => {
      await page.goto(path);
      await expectNoHorizontalScroll(page);
    });
  }
});
