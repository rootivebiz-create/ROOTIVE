import { expect, test, type Browser } from "@playwright/test";
import { asNewVisitor, firstStatementLink, startDemo } from "./helpers";

/**
 * 守り：ドライバーのリンクの書き換え・ほかの会社の明細・デモの入口の飛び先。
 * 画面の幅に関係しないので、パソコンの幅だけで確かめる
 */
test.skip(({ isMobile }) => isMobile, "画面の幅に関係しないので、パソコンの幅だけで確かめる");

/** 新しいブラウザ（クッキー無し）でデモの会社を 1 つ作る */
async function newDemoCompany(browser: Browser, baseURL: string) {
  const context = await browser.newContext({ baseURL, locale: "ja-JP", timezoneId: "Asia/Tokyo" });
  const page = await context.newPage();
  await startDemo(page);
  return { context, page };
}

/** 署名の部分（最後の「.」の後ろ）の 1 文字を別の文字にかえる */
function tamper(token: string, at = -5): string {
  const i = at < 0 ? token.length + at : at;
  const c = token[i];
  const swapped = c === "A" ? "B" : "A";
  return token.slice(0, i) + swapped + token.slice(i + 1);
}

test("書き換えたドライバーのリンク（/s）は、やさしい「使えません」の画面で、検索に出さない・残さない", async ({ browser, baseURL }) => {
  const staff = await newDemoCompany(browser, baseURL!);
  const { detailUrl, driverUrl } = await firstStatementLink(staff.page);
  const token = new URL(driverUrl).pathname.replace(/^\/s\//, "");
  expect(token.split(".")).toHaveLength(2);
  // もう 1 人の明細のリンク（中身だけを入れ替えるため）
  await staff.page.goto("/statements?m=2026-10");
  await staff.page.locator('a[href^="/statements/"]:visible').filter({ hasText: "井上 美咲" }).first().click();
  await staff.page.waitForURL(/\/statements\/[0-9a-f-]{36}$/);
  const other = new URL(await staff.page.getByLabel("ドライバー用のリンク").inputValue()).pathname.replace(/^\/s\//, "");
  expect(other).not.toBe(token);

  const driver = await browser.newContext({ baseURL: baseURL!, locale: "ja-JP" });
  await asNewVisitor(driver);
  const page = await driver.newPage();

  // 本物のリンクは開ける（比べるため）
  const ok = await page.goto(`/s/${token}`);
  expect(ok?.status()).toBe(200);
  await expect(page.getByRole("button", { name: "内容を確認しました" })).toBeVisible();

  // 署名の 1 文字・中身（明細の番号）の 1 文字・署名の切れ・別の人の明細の中身に差し替え・形の崩れ、のどれでも同じ画面
  const [payload, mac] = token.split(".");
  const bad: [string, string][] = [
    [tamper(token), "署名の 1 文字"],
    [tamper(token, 3), "中身の 1 文字"],
    [token.slice(0, -10), "署名が途中で切れている"],
    [`${other.split(".")[0]}.${mac}`, "別の人の明細の中身に、この明細の署名"],
    [payload, "署名なし"],
    ["abc", "形の崩れ"],
  ];
  for (const [t, what] of bad) {
    const res = await page.goto(`/s/${encodeURIComponent(t)}`);
    expect(res, what).not.toBeNull();
    expect(res!.status(), what).toBe(404);
    const headers = res!.headers();
    expect(headers["x-robots-tag"] ?? "", `${what}：X-Robots-Tag`).toMatch(/noindex/);
    expect(headers["cache-control"] ?? "", `${what}：Cache-Control`).toMatch(/no-store/);
    expect(headers["referrer-policy"] ?? "", `${what}：Referrer-Policy`).toBe("no-referrer");
    await expect(page.getByRole("heading", { level: 1, name: "このリンクは使えません" })).toBeVisible();
    await expect(page.getByText("会社に新しいリンクをお願いしてください")).toBeVisible();
    // 明細の中身・会社の名前は出さない
    await expect(page.getByText("サンプル運送株式会社")).toHaveCount(0);
    await expect(page.getByRole("button", { name: "内容を確認しました" })).toHaveCount(0);
  }

  // PDF・CSV のリンクも、書き換えたものは中身を返さない
  for (const kind of ["pdf", "csv"]) {
    const res = await page.request.get(`/api/s/${encodeURIComponent(tamper(token))}/${kind}`);
    expect([403, 404], `/api/s/…/${kind}`).toContain(res.status());
    expect(res.headers()["content-type"] ?? "").not.toMatch(/pdf|csv/);
    expect(res.headers()["cache-control"] ?? "").toMatch(/no-store/);
  }

  // 会社が「リンクを作り直す」と、前のリンクは同じ「使えません」の画面になる（新しいリンクは開ける）
  await staff.page.goto(detailUrl);
  expect(await staff.page.getByLabel("ドライバー用のリンク").inputValue()).toBe(driverUrl);
  await staff.page.getByRole("button", { name: "リンクを作り直す" }).click();
  await staff.page.getByRole("button", { name: "作り直す", exact: true }).click();
  await expect(staff.page.getByLabel("ドライバー用のリンク")).not.toHaveValue(driverUrl);
  const renewed = await staff.page.getByLabel("ドライバー用のリンク").inputValue();
  const old = await page.goto(`/s/${token}`);
  expect(old?.status()).toBe(404);
  await expect(page.getByRole("heading", { level: 1, name: "このリンクは使えません" })).toBeVisible();
  const fresh = await page.goto(renewed);
  expect(fresh?.status()).toBe(200);
  await expect(page.getByRole("button", { name: "内容を確認しました" })).toBeVisible();

  await driver.close();
  await staff.context.close();
});

test("ほかの会社（別のデモ）の明細の PDF は開けない（404 か 403）", async ({ browser, baseURL }) => {
  const a = await newDemoCompany(browser, baseURL!);
  const b = await newDemoCompany(browser, baseURL!);
  const { detailUrl } = await firstStatementLink(a.page);
  const id = new URL(detailUrl).pathname.split("/").pop()!;
  expect(id).toMatch(/^[0-9a-f-]{36}$/);

  // 自分の会社では開ける（比べるため）
  const own = await a.page.request.get(`/api/statements/${id}/pdf`);
  expect(own.status()).toBe(200);
  expect(own.headers()["content-type"]).toMatch(/application\/pdf/);
  expect((await own.body()).subarray(0, 5).toString("latin1")).toBe("%PDF-");

  // ほかの会社のログインでは開けない
  const other = await b.page.request.get(`/api/statements/${id}/pdf`);
  expect([403, 404]).toContain(other.status());
  expect(other.headers()["content-type"] ?? "").not.toMatch(/pdf/);
  expect((await other.body()).subarray(0, 5).toString("latin1")).not.toBe("%PDF-");
  // 画面でも、ほかの会社の明細は開けない
  const page = await b.page.goto(`/statements/${id}`);
  expect(page?.status()).toBe(404);
  await expect(b.page.getByText("青木 翔太さんの支払明細")).toHaveCount(0);

  // ログインしていない人も開けない
  const anon = await browser.newContext({ baseURL: baseURL! });
  const res = await anon.request.get(`/api/statements/${id}/pdf`);
  expect([401, 403, 404]).toContain(res.status());
  expect(res.headers()["content-type"] ?? "").not.toMatch(/pdf/);
  await anon.close();
  await a.context.close();
  await b.context.close();
});

test("デモの入口の next に別のサイトを入れても、サイトの外へは移らない", async ({ page, baseURL }) => {
  const origin = new URL(baseURL!).origin;
  await asNewVisitor(page.context());
  for (const next of ["//evil.example", "/\\evil.example", "https://evil.example/"]) {
    await page.goto(`/demo/start?next=${encodeURIComponent(next)}`);
    // 入口の画面にも、外へのリンク・外への飛び先は出ない
    for (const href of await page.locator("a[href]").evaluateAll((els) => els.map((e) => e.getAttribute("href") ?? ""))) {
      expect(new URL(href, origin).origin, `入口の画面のリンク ${href}`).toBe(origin);
    }
    await page.getByRole("button", { name: "デモを始める" }).click();
    await page.waitForURL((url) => !url.pathname.startsWith("/demo/start"), { timeout: 60_000 });
    const url = new URL(page.url());
    expect(url.origin, `next=${next}`).toBe(origin);
    expect(url.pathname, `next=${next}`).toBe("/");
    await expect(page.getByText("デモです（架空の会社・架空のデータ）")).toBeVisible();
  }
  // デモに入ったあとの入口の画面の「作ってあるデモの続きを開く」も、外へのリンクにならない
  await page.goto(`/demo/start?next=${encodeURIComponent("//evil.example")}`);
  const cont = page.getByRole("link", { name: "作ってあるデモの続きを開く" });
  await expect(cont).toBeVisible();
  expect(await cont.getAttribute("href")).toBe("/");
});
