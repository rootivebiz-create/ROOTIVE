import { expect, type Browser, type BrowserContext, type Locator, type Page, type TestInfo } from "@playwright/test";

/** デモの月（架空の会社のデータがある月） */
export const MONTH = "2026-10";

/** 横にはみ出していない（ページ全体の横スクロールが出ない） */
export async function expectNoHorizontalScroll(page: Page, where: string) {
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect(overflow, `${where}：ページが横にはみ出しています（${overflow}px）`).toBeLessThanOrEqual(1);
}

/** 本文の中の見えているボタン・ボタンの形のリンクが、押しやすい高さ（44px 以上）か（スマホの幅のときだけ。SPEC 4-0） */
export async function expectTapTargets(page: Page, where: string) {
  if ((page.viewportSize()?.width ?? 0) >= 768) return;
  const small = await page.evaluate(() => {
    const out: string[] = [];
    const main = document.querySelector("main") ?? document.body;
    for (const el of Array.from(main.querySelectorAll<HTMLElement>("button, a.inline-flex, a.flex, input[type=submit]"))) {
      const r = el.getBoundingClientRect();
      const style = getComputedStyle(el);
      if (r.width === 0 || r.height === 0 || style.visibility === "hidden" || style.display === "none") continue;
      // 文の中のリンクや、表の中の小さな印は対象外（ボタンの形のものだけ）
      if (r.height < 43.5) out.push(`${el.tagName.toLowerCase()}「${(el.textContent ?? "").trim().slice(0, 30)}」${Math.round(r.height)}px`);
    }
    return out;
  });
  expect(small, `${where}：押せる所が 44px より小さい`).toEqual([]);
}

/**
 * 来た人ごとの接続元（テストごとに別の人として数える）。
 * デモの入口は同じ接続元から 10 分に 10 社までしか作らせないため、テストのたびに別の接続元にする。
 * 置き場所（Vercel）では X-Forwarded-For は置き場所が付け直すので、外から書き換えることはできない
 */
export async function asNewVisitor(context: BrowserContext) {
  const n = () => Math.floor(Math.random() * 250) + 1;
  await context.setExtraHTTPHeaders({ "x-forwarded-for": `10.${n()}.${n()}.${n()}` });
}

/** デモを始める（入口のボタンを押す。開いただけでは作らない） */
export async function startDemo(page: Page, next?: string) {
  await asNewVisitor(page.context());
  await page.goto(next ? `/demo/start?next=${encodeURIComponent(next)}` : "/demo/start");
  await page.getByRole("button", { name: "デモを始める" }).click();
  await page.waitForURL((url) => !url.pathname.startsWith("/demo/start"), { timeout: 60_000 });
  await expect(page.getByText("デモです（架空の会社・架空のデータ）")).toBeVisible();
}

/** 支払明細を作る（まだ無ければ）。作ったあとの一覧を開いた状態で返る */
export async function ensureStatements(page: Page) {
  await page.goto(`/statements?m=${MONTH}`);
  const make = page.getByRole("button", { name: "明細を作る", exact: true });
  if (await make.isVisible().catch(() => false)) {
    await make.click();
    await expect(page.getByText(/作りました|明細を作りました/).first()).toBeVisible();
    await page.goto(`/statements?m=${MONTH}`);
  }
}

/** 1 人目の明細の画面を開き、ドライバー用のリンクを返す */
export async function firstStatementLink(page: Page): Promise<{ detailUrl: string; driverUrl: string }> {
  await ensureStatements(page);
  const first = page.locator('a[href^="/statements/"]:not([href*="inbox"])').first();
  await first.click();
  await page.waitForURL(/\/statements\/[0-9a-f-]{36}/);
  const detailUrl = page.url();
  const input = page.getByLabel("ドライバー用のリンク");
  const driverUrl = await input.inputValue();
  expect(driverUrl).toContain("/s/");
  return { detailUrl, driverUrl };
}

/** 取引条件の明示書を作り（まだ無ければ）、1 人目のドライバー用のリンク（/t/…）を返す */
export async function firstTermsLink(page: Page): Promise<{ detailUrl: string; driverUrl: string }> {
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
  const detailUrl = page.url();
  const driverUrl = await page.getByLabel("ドライバー用のリンク").inputValue();
  expect(driverUrl).toContain("/t/");
  return { detailUrl, driverUrl };
}

/** ログインしていない（クッキーの無い）ドライバーのブラウザで開く。スマホの設定（幅・タッチ）はそのテストの設定に合わせる */
export async function asDriver(browser: Browser, url: string, viewport = { width: 375, height: 812 }, info?: TestInfo) {
  const use = info?.project.use ?? {};
  const context = await browser.newContext({
    viewport,
    isMobile: use.isMobile,
    hasTouch: use.hasTouch,
    userAgent: use.userAgent,
    locale: "ja-JP",
    timezoneId: "Asia/Tokyo",
  });
  await asNewVisitor(context);
  const page = await context.newPage();
  await page.goto(url);
  return { page, context };
}

/**
 * ブラウザのコンソールのエラーと、画面の中で投げられた例外を集める。
 * `take()` でそれまでの分を取り出して空にする（画面ごとに確かめる）
 */
export function collectBrowserErrors(page: Page) {
  let errors: string[] = [];
  page.on("console", (msg) => {
    if (msg.type() === "error") errors.push(`console: ${msg.text()}`);
  });
  page.on("pageerror", (err) => errors.push(`pageerror: ${err.message}`));
  return {
    take(): string[] {
      const out = errors;
      errors = [];
      return out;
    },
  };
}

/**
 * 会社の側の操作（押す・入れる・選ぶ）を数える（SPEC §3：0:00 から「確認しました」まで 25 回以内）。
 * 画面の URL を直接開くことはしない（メニューやボタンを押して進む）
 */
export class StaffOps {
  readonly log: string[] = [];
  get count() {
    return this.log.length;
  }
  async click(target: Locator, what: string) {
    await target.click();
    this.log.push(`押す：${what}`);
  }
  async fill(target: Locator, value: string, what: string) {
    await target.fill(value);
    this.log.push(`入れる：${what}`);
  }
  async check(target: Locator, what: string) {
    await target.check();
    this.log.push(`選ぶ：${what}`);
  }
}

/** 見えている方のメニュー（スマホは上の横スクロール、パソコンは左）の項目 */
export function menuLink(page: Page, label: string, short: string): Locator {
  return page.locator('nav[aria-label="メニュー"]:visible').getByRole("link", { name: new RegExp(`^(${label}|${short})$`) });
}
