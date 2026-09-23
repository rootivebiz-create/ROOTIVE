import { readFileSync } from "node:fs";
import { expect, test } from "@playwright/test";
import { asDriver, asNewVisitor, collectBrowserErrors, expectNoHorizontalScroll, menuLink, StaffOps } from "./helpers";
import { pdfText } from "./pdf-text";

/** PDF の文字（改行を除いてつなげる。PDF は語の途中で行を分けて書くため） */
const pdfLine = (buf: Buffer) => pdfText(buf).replace(/\n/g, "");

/**
 * SPEC §3 のデモの流れを、デモの架空の会社でブラウザから通す（SPEC §3・P0-11 の受け入れ条件）。
 *   ホーム → 取り込み「見本」→ 反映（この月をすべて入れ替え）→ 見張り番の赤（遠藤さんの取引条件・木村さんの制服代）を確かめてメモ
 *   → 明細を作る → 1 人の明細 → ドライバー用のリンクをコピー → ログインしていないブラウザで「内容を確認しました」
 *   → 会社の一覧が「確認済み」→ 振込データを作ってダウンロード → 締める → 突合の見本（A物流）→ 差 ¥91,700 → 問い合わせ文
 * 会社の側の操作は、メニューとボタンを押して進む（URL を直接開かない）。0:00 から「確認しました」までを数える
 */

/** 0:00 から「確認しました」までの会社の側の操作の上限（SPEC §3 の受け入れ条件） */
const CORE_OPS_LIMIT = 25;

test("§3 のデモ：取り込み → 見張り番 → 明細 → ドライバーの確認 → 振込 → 締め → 突合 → 問い合わせ文", async ({ page, browser, context }, info) => {
  test.setTimeout(240_000);
  const ops = new StaffOps();
  const errors = collectBrowserErrors(page);
  // 「リンクをコピー」がクリップボードに書けるように（書けないときは送った記録がつかない）
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);

  // 0:00 デモの入口（開いただけでは何も作らない）→「デモを始める」（helpers の startDemo と同じ手順。押した回数を数えるため、ここで押す）
  await asNewVisitor(context);
  await page.goto("/demo/start");
  await ops.click(page.getByRole("button", { name: "デモを始める" }), "デモを始める");
  await page.waitForURL((url) => !url.pathname.startsWith("/demo/start"), { timeout: 60_000 });

  await expect(page.getByRole("heading", { level: 1, name: "2026年10月分の締め" })).toBeVisible();

  // 取り込み：見本（1 行 1 件の表）を置く
  await ops.click(page.getByRole("link", { name: "取り込みを見る・足す →" }), "ホームの「取り込み」");
  await page.waitForURL(/\/import\?m=2026-10/);
  await ops.click(page.getByRole("button", { name: "見本：1 行 1 件の表" }), "見本：1 行 1 件の表");
  await page.waitForURL(/\/import\/[0-9a-f-]{36}/, { timeout: 60_000 });
  await expect(page.getByText("このまま反映できます")).toBeVisible();
  await expect(page.getByText(/ファイルの合計（\d+行目） 5,205 と一致しました/).first()).toBeVisible();

  // 反映：この月の稼働をすべて入れ替える（おすすめに出ていなければ選ぶ）
  const mode = page.locator('input[type="hidden"][name="mode"]');
  if ((await mode.inputValue()) !== "replaceAll") {
    await ops.click(page.getByRole("link", { name: /^この月の稼働をすべて入れ替える/ }), "すべて入れ替える");
  }
  await expect(mode).toHaveValue("replaceAll");
  await ops.click(page.getByRole("button", { name: "反映する（11件を2026年10月分へ）" }), "反映する");
  await expect(page.getByText("反映しました。11 件を2026年10月分の稼働に入れました。", { exact: false })).toBeVisible({ timeout: 30_000 });

  // 見張り番：赤は 2 件（遠藤さんの取引条件の明示・木村さんの制服代）
  await ops.click(menuLink(page, "見張り番", "見張り"), "メニュー「見張り番」");
  await page.waitForURL(/\/watch/);
  await expect(page.getByRole("heading", { level: 1, name: "見張り番" })).toBeVisible();
  await expect(page.getByText("締めを止める指摘が 2 件あります")).toBeVisible();
  const redCard = (title: string, who: string) =>
    page
      .locator("li")
      .filter({ has: page.getByRole("heading", { name: title, exact: true }) })
      .filter({ hasText: who });
  const terms = redCard("取引条件を明示した記録がありません", "遠藤 大輔");
  const uniform = redCard("書面で合意した記録が無い控除があります", "制服代（木村 誠）");
  for (const card of [terms, uniform]) {
    await expect(card).toHaveCount(1);
    await expect(card.getByText("赤", { exact: true })).toBeVisible();
  }
  await expect(terms.getByText("¥294,800")).toBeVisible();
  await expect(uniform.getByText("¥5,000")).toBeVisible();

  // 理由のメモを書いて「確認済み」にする（赤は締めを止めなくなる）
  const ack = async (card: typeof terms, note: string, who: string) => {
    await ops.click(card.locator("summary", { hasText: "確認済みにする" }), `${who}：確認済みにする（開く）`);
    await ops.fill(card.getByLabel(/何を確かめたか/), note, `${who}：メモ`);
    await ops.click(card.getByRole("button", { name: "確認済みにする" }), `${who}：確認済みにする`);
  };
  await ack(terms, "2026年5月1日に紙の取引条件の通知書を渡した控えを事務所の綴りで確認した", "遠藤さん");
  await expect(page.getByText("締めを止める指摘が 1 件あります")).toBeVisible();
  await ack(uniform, "制服代の同意書（2026年7月1日付・本人の署名あり）を確認した。来月までに台帳へ合意日を入れる", "木村さん");
  await expect(page.getByText(/締めを止める指摘が \d+ 件あります/)).toHaveCount(0);
  await expect(page.locator("summary").filter({ hasText: "確認済み" }).filter({ hasText: "取引条件を明示した記録がありません" })).toBeVisible();
  await expect(page.locator("summary").filter({ hasText: "確認済み" }).filter({ hasText: "書面で合意した記録が無い控除があります" })).toBeVisible();

  // 明細を作る → 1 人の明細を開く
  await ops.click(menuLink(page, "支払明細", "明細"), "メニュー「明細」");
  await page.waitForURL(/\/statements/);
  await ops.click(page.getByRole("button", { name: "明細を作る", exact: true }), "明細を作る");
  await expect(page.getByText(/明細を作りました（新しく 8人/)).toBeVisible({ timeout: 30_000 });
  await expect(page.getByText("8人中 0人が確認済み")).toBeVisible();
  // パソコンは表の名前、スマホはカード（名前・版・振込額・状態）がリンク
  await ops.click(page.locator('a[href^="/statements/"]:visible').filter({ hasText: "青木 翔太" }).first(), "青木さんの明細");
  await page.waitForURL(/\/statements\/[0-9a-f-]{36}$/);
  await expect(page.getByRole("heading", { level: 1, name: "青木 翔太さんの支払明細" })).toBeVisible();
  await expect(page.getByText("357,555円").first()).toBeVisible();

  // ドライバー用のリンクをコピー（送った記録がつく）。リンクは画面から読む
  await ops.click(page.getByRole("button", { name: "リンクをコピー" }), "リンクをコピー");
  await expect(page.getByText("リンクをコピーしました", { exact: false })).toBeVisible();
  const driverUrl = await page.getByLabel("ドライバー用のリンク").inputValue();
  expect(driverUrl).toMatch(/^http:\/\/localhost:\d+\/s\/[A-Za-z0-9._-]+$/);
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(driverUrl);

  // ドライバー：クッキーの無い別のブラウザで開いて「内容を確認しました」
  const viewport = info.project.use.viewport ?? { width: 375, height: 740 };
  const driver = await asDriver(browser, driverUrl, viewport, info);
  const driverErrors = collectBrowserErrors(driver.page);
  await expect(driver.page.getByRole("heading", { level: 1, name: "2026年10月分の支払明細" })).toBeVisible();
  await expect(driver.page.getByText("357,555円").first()).toBeVisible();
  await driver.page.getByRole("button", { name: "内容を確認しました" }).click();
  await expect(driver.page.getByText(/に確認しました（版 1）/)).toBeVisible();
  await expectNoHorizontalScroll(driver.page, "確認したあとの /s");
  expect(driverErrors.take(), "ドライバーの画面のエラー").toEqual([]);
  // ドライバーの「この明細を PDF で保存」も、画面と同じ振込額
  const driverPdf = await driver.page.request.get(new URL((await driver.page.getByRole("link", { name: "この明細を PDF で保存" }).getAttribute("href"))!, driverUrl).href);
  expect(driverPdf.status()).toBe(200);
  expect(pdfLine(await driverPdf.body())).toContain("357,555");

  // ここまでが §3 の「0:00 から確認しました まで」
  const coreOps = ops.count;
  info.annotations.push({ type: "会社の側の操作（0:00〜確認しました）", description: `${coreOps} 回：${ops.log.join(" / ")}` });
  console.log(`[${info.project.name}] 会社の側の操作（0:00〜確認しました）：${coreOps} 回`);
  expect(coreOps, `会社の側の操作が多すぎます：${ops.log.join(" / ")}`).toBeLessThanOrEqual(CORE_OPS_LIMIT);

  // 会社の画面：状態が「確認済み」になる（開き直すと最新）
  await page.reload();
  await expect(page.getByText(/確認済み/).first()).toBeVisible();
  await ops.click(page.getByRole("link", { name: /^← 2026年10月の明細の一覧$/ }), "明細の一覧へ");
  await page.waitForURL(/\/statements\?m=2026-10$/);
  await expect(page.getByText("8人中 1人が確認済み")).toBeVisible();
  // 会社の画面の PDF も、画面と同じ振込額・同じ人
  await page.goBack();
  await page.waitForURL(/\/statements\/[0-9a-f-]{36}$/);
  const [statementPdf] = await Promise.all([page.waitForEvent("download"), ops.click(page.getByRole("link", { name: "PDF", exact: true }), "明細の PDF")]);
  expect(statementPdf.suggestedFilename()).toMatch(/^支払明細_2026年10月_青木 翔太_版1\.pdf$/);
  const statementText = pdfLine(readFileSync(await statementPdf.path()));
  for (const v of ["青木 翔太", "357,555", "374,500", "37,450", "T9876543210987"]) expect(statementText, `明細の PDF に「${v}」`).toContain(v);
  await ops.click(page.getByRole("link", { name: /^← 2026年10月の明細の一覧$/ }), "明細の一覧へ");
  await page.waitForURL(/\/statements\?m=2026-10$/);
  // パソコンは表の行、スマホはカードに状態が出る
  const aoki = page.locator("tr:visible, a[href^='/statements/']:visible").filter({ hasText: "青木 翔太" }).first();
  await expect(aoki.getByText("確認済み", { exact: true })).toBeVisible();

  // ドライバーが明細の行（宅配）から質問する → 会社の側に未読 1 がつく（SPEC §3 の 4:30–5:00）
  await driver.page.getByRole("button", { name: "この行について質問する" }).nth(1).click();
  const question = driver.page.getByLabel("宅配（個建て）についての質問");
  await question.fill("10月の宅配の個数は、手元の控えでは 2,350 個です。確認をお願いします。");
  await driver.page.getByRole("button", { name: "送る", exact: true }).first().click();
  await expect(driver.page.getByRole("status").filter({ hasText: /送りました|届きました/ }).first()).toBeVisible();
  expect(driverErrors.take(), "ドライバーの画面のエラー（質問）").toEqual([]);
  await driver.context.close();
  await page.reload();
  await expect(page.locator("tr:visible, a[href^='/statements/']:visible").filter({ hasText: "青木 翔太" }).first().getByText(/未読 1/)).toBeVisible();
  await ops.click(page.getByRole("link", { name: "質問の一覧" }), "質問の一覧");
  await page.waitForURL(/\/statements\/inbox/);
  await expect(page.getByText("未読 1").first()).toBeVisible();
  await expect(page.getByText("2,350 個").first()).toBeVisible();

  // 振込データ：作る → ダウンロード（全銀の 120 桁のファイル）
  await ops.click(menuLink(page, "振込データ", "振込"), "メニュー「振込」");
  await page.waitForURL(/\/transfer/);
  const changed = page.getByLabel(/口座が変わった人を確かめました/);
  if (await changed.isVisible().catch(() => false)) await ops.check(changed, "口座が変わった人を確かめた");
  await ops.click(page.getByRole("button", { name: "振込データを作る（7人・2,171,664円）" }), "振込データを作る");
  await expect(page.getByText("振込データを作りました。", { exact: false })).toBeVisible({ timeout: 30_000 });
  const downloadLink = page.getByRole("link", { name: "全銀の振込データをダウンロード" });
  const [download] = await Promise.all([page.waitForEvent("download"), ops.click(downloadLink, "全銀の振込データをダウンロード")]);
  expect(download.suggestedFilename()).toMatch(/^振込_2026年10月分_\d{8}\.txt$/);
  const file = readFileSync(await download.path());
  // 全銀：1 行 120 バイト（改行つき）。ヘッダー 1・データ 7・トレーラー 1・エンド 1
  const records = file
    .toString("latin1")
    .split(/\r?\n/)
    .filter((r) => r.length > 0);
  expect(records.map((r) => r.length)).toEqual(Array(10).fill(120));
  expect(records.map((r) => r[0])).toEqual(["1", ...Array(7).fill("2"), "8", "9"]);
  // トレーラー：件数 7・合計 2,171,664 円
  expect(records[8].slice(1, 7)).toBe("000007");
  expect(records[8].slice(7, 19)).toBe("000002171664");
  // ダウンロードの応答そのもの（ファイルとして返っている）
  const res = await page.request.get(await downloadLink.getAttribute("href").then((h) => h ?? ""));
  expect(res.status()).toBe(200);
  expect(res.headers()["content-disposition"] ?? "").toMatch(/attachment/);
  expect(res.headers()["cache-control"] ?? "").toMatch(/no-store/);

  // 締める（赤は確認済みなので、理由なしで締められる）
  await ops.click(menuLink(page, "締め", "締め"), "メニュー「締め」");
  await page.waitForURL(/\/close/);
  await ops.click(page.getByRole("button", { name: "2026年10月を締める…" }), "2026年10月を締める…");
  await ops.click(page.getByRole("button", { name: "締める", exact: true }), "締める");
  await expect(page.getByRole("heading", { name: "2026年10月は締めました" })).toBeVisible({ timeout: 30_000 });

  // 締めても、中身の変わらない明細の版は上がらない（青木さんの確認は今の版のまま）。締めたあとでもドライバーは確認できる
  await ops.click(menuLink(page, "支払明細", "明細"), "メニュー「明細」");
  await page.waitForURL(/\/statements/);
  await expect(page.getByText("8人中 1人が確認済み")).toBeVisible();
  await expect(page.getByText(/旧版/)).toHaveCount(0);
  await ops.click(page.locator('a[href^="/statements/"]:visible').filter({ hasText: "井上 美咲" }).first(), "井上さんの明細");
  await page.waitForURL(/\/statements\/[0-9a-f-]{36}$/);
  await ops.click(page.getByRole("button", { name: "リンクをコピー" }), "リンクをコピー");
  await expect(page.getByText("リンクをコピーしました", { exact: false })).toBeVisible();
  const inoue = await asDriver(browser, await page.getByLabel("ドライバー用のリンク").inputValue(), viewport, info);
  await expect(inoue.page.getByText("357,720円").first()).toBeVisible();
  await inoue.page.getByRole("button", { name: "内容を確認しました" }).click();
  await expect(inoue.page.getByText(/に確認しました（版 1）/)).toBeVisible();
  await inoue.context.close();
  await ops.click(page.getByRole("link", { name: /^← 2026年10月の明細の一覧$/ }), "明細の一覧へ");
  await page.waitForURL(/\/statements\?m=2026-10$/);
  await expect(page.getByText("8人中 2人が確認済み")).toBeVisible();

  // 突合：見本（A物流）を取り込む → 受け取りが少ない可能性 ¥91,700
  await ops.click(menuLink(page, "元請との突合", "突合"), "メニュー「突合」");
  await page.waitForURL(/\/reconcile/);
  await ops.click(page.getByRole("button", { name: /^見本のファイルで試す（A物流（架空）・2026年10月分）/ }), "見本のファイルで試す");
  await page.waitForURL(/\/reconcile\/[0-9a-f-]{36}/, { timeout: 60_000 });
  await expect(page.getByRole("heading", { level: 1, name: /A物流（架空）\s*2026年10月分/ })).toBeVisible();
  const short = page.locator("section, div").filter({ has: page.getByText("受け取りが少ない可能性", { exact: true }) }).first();
  await expect(short.getByText("¥91,700")).toBeVisible();
  await expect(page.getByText("内訳：宅配（個建て） ¥81,700 ＋ 夜間便 ¥10,000")).toBeVisible();

  // 問い合わせ文：差の行が並び、本文に合計が入る
  await ops.click(page.getByRole("link", { name: "問い合わせ文を作る" }), "問い合わせ文を作る");
  await page.waitForURL(/\/reconcile\/[0-9a-f-]{36}\/letter/);
  await expect(page.getByRole("heading", { level: 1, name: "問い合わせ文を作る" })).toBeVisible();
  await expect(page.getByText("-¥81,700")).toBeVisible();
  await expect(page.getByText("-¥10,000")).toBeVisible();
  const body = page.getByLabel("本文");
  await expect(body).toHaveValue(/宅配（個建て）/);
  await expect(body).toHaveValue(/夜間便/);
  await expect(body).toHaveValue(/91,700円/);
  await expectNoHorizontalScroll(page, "問い合わせ文");
  // PDF（差の一覧の表つき）も、画面と同じ差と合計（SPEC P0-10 の 9）
  const [letterPdf] = await Promise.all([page.waitForEvent("download"), ops.click(page.getByRole("button", { name: "PDF にする（差の一覧の表つき）" }), "問い合わせ文の PDF")]);
  expect(letterPdf.suggestedFilename()).toMatch(/\.pdf$/);
  const letterText = pdfLine(readFileSync(await letterPdf.path()));
  for (const v of ["宅配（個建て）", "81,700", "夜間便", "10,000", "91,700"]) expect(letterText, `問い合わせ文の PDF に「${v}」`).toContain(v);
  // 送ったら「問い合わせ済み」にする → 結果の画面で 2 件が問い合わせ済み
  await ops.click(page.getByRole("button", { name: "2件を「問い合わせ済み」にする" }), "問い合わせ済みにする");
  await expect(page.getByText("「問い合わせ済み」にしました").first()).toBeVisible();
  await ops.click(page.getByRole("link", { name: /^← 突合の結果/ }), "突合の結果へ");
  await page.waitForURL(/\/reconcile\/[0-9a-f-]{36}$/);
  await expect(page.getByText("問い合わせ済み", { exact: true }).filter({ visible: true })).toHaveCount(2);
  await expect(page.getByText("¥91,700").first()).toBeVisible();

  // やめるときは、取り込んだときと同じ形の Excel で持ち帰れる（SPEC §3 の締め）
  await ops.click(menuLink(page, "取り込み", "取込"), "メニュー「取込」");
  await page.waitForURL(/\/import/);
  const [xlsx] = await Promise.all([page.waitForEvent("download"), ops.click(page.getByRole("link", { name: "Excel に戻す（.xlsx）" }), "Excel に戻す")]);
  expect(xlsx.suggestedFilename()).toMatch(/\.xlsx$/);
  const book = readFileSync(await xlsx.path());
  expect(book.subarray(0, 2).toString("latin1"), "xlsx（zip）の先頭").toBe("PK");

  console.log(`[${info.project.name}] 会社の側の操作（最後まで）：${ops.count} 回`);
  expect(errors.take(), "会社の画面のエラー").toEqual([]);
});
