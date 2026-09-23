import { expect, test, type Page } from "@playwright/test";
import { asDriver, collectBrowserErrors, firstStatementLink, firstTermsLink, MONTH, startDemo } from "./helpers";

/**
 * スマホの幅（375px・320px）で、すべての主な画面が
 *   - 横にはみ出さない（document の幅 ≦ 画面の幅 ＋ 1px）
 *   - ブラウザのコンソールにエラーが出ない（画面の中の例外も含む）
 *   - 見出し（h1）が 1 つ以上ある
 *   - 押せる所（ボタン・ボタンの形のリンク・畳んだ所の見出し）が 44px 以上（SPEC 4-0）
 * デモの架空の会社を 1 つ作り、明細・取引条件・取り込み・突合のデータを入れてから、順に開く。
 * ドライバーの画面（/s・/t）は、ログインしていないブラウザで開く
 */
test.skip(({ isMobile }) => !isMobile, "スマホの幅（375px・320px）だけで確かめる");

type Problem = { path: string; problems: string[] };

async function checkPage(page: Page, url: string, errors: ReturnType<typeof collectBrowserErrors>, label = url, expectStatus = 200): Promise<Problem> {
  const problems: string[] = [];
  const res = await page.goto(url);
  const status = res?.status() ?? 0;
  if (status !== expectStatus) problems.push(`応答が ${status}（${expectStatus} のはず）`);
  // 画面の中の部品（クライアント側）が動き終わるまで待つ（遅れて出るエラー・広がる中身も拾う）
  await page.waitForLoadState("networkidle").catch(() => undefined);
  const h1 = await page.locator("h1").count();
  if (h1 === 0) problems.push("h1 がありません");
  else if (!(await page.locator("h1").first().isVisible())) problems.push("h1 が見えていません");
  const overflow = () =>
    page.evaluate(() => {
      const innerWidth = window.innerWidth;
      // はみ出している部品（原因を探しやすいように、いちばん外側のものをいくつか）
      const wide: string[] = [];
      for (const el of Array.from(document.body.querySelectorAll<HTMLElement>("*"))) {
        const r = el.getBoundingClientRect();
        if (r.right > innerWidth + 1 && r.width > 0) {
          let p = el.parentElement;
          let outer = true;
          while (p && p !== document.body) {
            const pr = p.getBoundingClientRect();
            if (pr.right > innerWidth + 1) {
              outer = false;
              break;
            }
            const ov = getComputedStyle(p).overflowX;
            if (ov === "auto" || ov === "scroll" || ov === "hidden" || ov === "clip") break;
            p = p.parentElement;
          }
          if (outer && wide.length < 5) {
            const cls = typeof el.className === "string" ? el.className.slice(0, 60) : "";
            wide.push(`${el.tagName.toLowerCase()}.${cls}「${(el.textContent ?? "").trim().slice(0, 30)}」right=${Math.round(r.right)}`);
          }
        }
      }
      return { scrollWidth: document.documentElement.scrollWidth, innerWidth, wide };
    });
  const closed = await overflow();
  if (closed.scrollWidth > closed.innerWidth + 1)
    problems.push(`横にはみ出しています（幅 ${closed.scrollWidth}px ＞ 画面 ${closed.innerWidth}px）${closed.wide.length ? "：" + closed.wide.join(" / ") : ""}`);
  // 畳んである所（<details>）を全部開いても、はみ出さない（スマホで開いたときに崩れないか）
  const opened = await page.evaluate(() => {
    const all = Array.from(document.querySelectorAll("details"));
    for (const d of all) d.open = true;
    return all.length;
  });
  if (opened > 0) {
    const open = await overflow();
    if (open.scrollWidth > open.innerWidth + 1)
      problems.push(`畳んである所（${opened} か所）を開くと横にはみ出します（幅 ${open.scrollWidth}px ＞ 画面 ${open.innerWidth}px）${open.wide.length ? "：" + open.wide.join(" / ") : ""}`);
  }
  // 押せる所（ボタン・ボタンの形のリンク）が 44px 以上（SPEC 4-0）
  const small = await page.evaluate(() => {
    const out: string[] = [];
    const main = document.querySelector("main") ?? document.body;
    for (const el of Array.from(main.querySelectorAll<HTMLElement>("button, a.inline-flex, a.flex, input[type=submit], summary"))) {
      const r = el.getBoundingClientRect();
      const style = getComputedStyle(el);
      if (r.width === 0 || r.height === 0 || style.visibility === "hidden" || style.display === "none") continue;
      if (r.height < 43.5) out.push(`${el.tagName.toLowerCase()}「${(el.textContent ?? "").trim().slice(0, 30)}」${Math.round(r.height)}px`);
    }
    return out;
  });
  if (small.length) problems.push(`押せる所が 44px より小さい：${small.slice(0, 8).join(" / ")}${small.length > 8 ? ` ほか ${small.length - 8}` : ""}`);
  // 404 と決まっている画面では、その応答のことをブラウザが書く 1 行だけは数えない
  const expected404 = (e: string) => expectStatus === 404 && /Failed to load resource: the server responded with a status of 404/.test(e);
  problems.push(...errors.take().filter((e) => !expected404(e)));
  return { path: label, problems };
}

test("スマホの幅で、すべての画面がはみ出さず・エラーが無く・h1 があり・押せる所が 44px 以上", async ({ page, browser }, info) => {
  test.setTimeout(600_000);
  const errors = collectBrowserErrors(page);
  await startDemo(page);

  // 画面に中身が出るように、取り込み・明細・取引条件・突合を 1 回ずつ通しておく
  await page.goto(`/import?m=${MONTH}`);
  await page.getByRole("button", { name: "見本：1 行 1 件の表" }).click();
  await page.waitForURL(/\/import\/[0-9a-f-]{36}/, { timeout: 60_000 });
  const importUrl = new URL(page.url()).pathname;
  const { detailUrl, driverUrl } = await firstStatementLink(page);
  const statementPath = new URL(detailUrl).pathname;
  const terms = await firstTermsLink(page);
  const termsPath = new URL(terms.detailUrl).pathname;
  await page.goto(`/reconcile?m=${MONTH}`);
  await page.getByRole("button", { name: /^見本のファイルで試す/ }).click();
  await page.waitForURL(/\/reconcile\/[0-9a-f-]{36}/, { timeout: 60_000 });
  const noticePath = new URL(page.url()).pathname;
  await page.goto("/settings/drivers");
  const driverSettingsPath = await page.locator('a[href^="/settings/drivers/"]:not([href$="/new"])').first().getAttribute("href");
  expect(driverSettingsPath).toMatch(/^\/settings\/drivers\/[0-9a-f-]{36}$/);
  errors.take(); // 準備の途中のものは数えない（下で画面ごとに確かめる）

  const staffPages = [
    "/",
    `/import?m=${MONTH}`,
    importUrl,
    `/import?m=${MONTH}&kind=bank`,
    `/work?m=${MONTH}`,
    `/watch?m=${MONTH}`,
    "/terms",
    termsPath,
    `/statements?m=${MONTH}`,
    statementPath,
    `${statementPath}/versions/1`,
    "/statements/inbox",
    "/records",
    `/transfer?m=${MONTH}`,
    `/close?m=${MONTH}`,
    `/parallel?m=${MONTH}`,
    `/parallel/report?m=${MONTH}`,
    `/reconcile?m=${MONTH}`,
    noticePath,
    `${noticePath}/letter`,
    "/reconcile/report",
    `/profit?m=${MONTH}`,
    `/export?m=${MONTH}`,
    "/settings",
    "/settings/company",
    "/settings/drivers",
    driverSettingsPath!,
    "/settings/drivers/new",
    "/settings/clients",
    "/settings/projects",
    "/settings/rates",
    "/settings/rules",
    "/settings/users",
    "/settings/account",
    "/settings/ai",
    "/help",
    `/audit?m=${MONTH}`,
    "/data",
    "/onboarding",
    "/onboarding/company",
    "/onboarding/drivers",
    "/onboarding/projects",
    "/onboarding/rules",
    "/onboarding/done",
  ];

  const results: Problem[] = [];
  for (const path of staffPages) results.push(await checkPage(page, path, errors));

  // ドライバーの画面（ログインしていないブラウザ）
  const viewport = info.project.use.viewport ?? { width: 375, height: 740 };
  const driver = await asDriver(browser, "about:blank", viewport, info);
  const driverErrors = collectBrowserErrors(driver.page);
  const broken = (url: string) => url.slice(0, -6) + (url.endsWith("AAAAAA") ? "BBBBBB" : "AAAAAA");
  const pages: [string, string, number][] = [
    [driverUrl, "/s/<明細のリンク>", 200],
    [terms.driverUrl, "/t/<取引条件のリンク>", 200],
    [broken(driverUrl), "/s/<使えないリンク>", 404],
    [broken(terms.driverUrl), "/t/<使えないリンク>", 404],
    // デモの入口（ログインしていない人が最初に開く画面）
    [new URL("/demo/start", driverUrl).href, "/demo/start", 200],
  ];
  for (const [url, label, status] of pages) results.push(await checkPage(driver.page, url, driverErrors, label, status));
  await driver.context.close();

  const failed = results.filter((r) => r.problems.length > 0);
  expect(failed.map((f) => `${f.path}\n    ${f.problems.join("\n    ")}`).join("\n"), `${results.length} 画面のうち ${failed.length} 画面に問題`).toBe("");
});
