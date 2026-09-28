import { expect, test } from "@playwright/test";
import { asDriver, expectNoHorizontalScroll, firstStatementLink, MONTH, startDemo } from "./helpers";

/**
 * ひと月の流れをブラウザで通す（デモの架空の会社）：
 * 取り込み（見本のファイル）→ 明細 → ドライバーのリンクで「確認しました」→ 締め → 振込データ → 締めを外す。
 * 画面のフォーム（ブラウザ側の送り方・入力の残り方）と、本番のビルドでの動きを確かめる
 */
test.describe.configure({ mode: "serial" });

test("取り込みの画面 → 明細 → 確認 → 締め（断られても入力が残る）→ 振込データ → 締めを外す", async ({ page, browser }, info) => {
  await startDemo(page);

  // 取り込み：見本のファイルで試せる（置いたファイルの確認の画面まで）
  await page.goto(`/import?m=${MONTH}`);
  await expect(page.locator("h1").first()).toBeVisible();

  // 明細を作り、1 人目のドライバーのリンクを開く（ログインなしのブラウザ）
  const { driverUrl } = await firstStatementLink(page);
  const viewport = info.project.use.viewport ?? { width: 375, height: 812 };
  const driver = await asDriver(browser, driverUrl, viewport);
  await driver.page.getByRole("button", { name: "内容を確認しました" }).click();
  await expect(driver.page.getByText(/に確認しました/).first()).toBeVisible();
  await expectNoHorizontalScroll(driver.page, "確認したあとの /s");
  await driver.context.close();

  // 会社の一覧に「確認済」が出る
  await page.goto(`/statements?m=${MONTH}`);
  await expect(page.getByText(/確認済/).first()).toBeVisible();

  // 締める（赤い指摘が残っていれば、オーナーとして理由を書いて締める）
  await page.goto(`/close?m=${MONTH}`);
  const override = page.getByRole("button", { name: /赤い指摘が残ったまま.*を締める…/ });
  if (await override.isVisible().catch(() => false)) {
    await override.click();
    await page.getByLabel(/赤い指摘が残ったまま締める理由/).fill("E2E の確かめのため。デモの架空の会社で、指摘は来月直す");
    await page.getByLabel(/締めにかかった時間/).fill("abc");
    await page.getByRole("button", { name: "理由を残して締める" }).click();
  } else {
    await page.getByRole("button", { name: /を締める…$/ }).click();
    // 分数の欄に数でないものを入れて断られても、入れた理由・分数は消えない（React が入力を空に戻さない）
    await page.getByLabel(/締めにかかった時間/).fill("abc");
    await page.getByRole("button", { name: "締める", exact: true }).click();
  }
  await expect(page.getByRole("alert").first()).toBeVisible();
  await expect(page.getByLabel(/締めにかかった時間/)).toHaveValue("abc");
  await page.getByLabel(/締めにかかった時間/).fill("90");
  await page.getByRole("button", { name: /^(締める|理由を残して締める)$/ }).click();
  await expect(page.getByRole("heading", { name: /は締めました/ })).toBeVisible();

  // 振込データ（締めたあとに作る）
  await page.goto(`/transfer?m=${MONTH}`);
  const changed = page.getByLabel(/口座が変わった人を確かめました/);
  if (await changed.isVisible().catch(() => false)) await changed.check();
  const make = page.getByRole("button", { name: /^振込データを作る（/ });
  await expect(make).toBeEnabled();
  await make.click();
  await expect(page.getByRole("status").filter({ hasText: /振込/ }).first()).toBeVisible();
  await expectNoHorizontalScroll(page, "振込データを作ったあと");

  // 締めを外す（オーナーだけ・理由つき）
  await page.goto(`/close?m=${MONTH}`);
  await page.getByLabel(/締めを外す理由/).fill("E2E の確かめのため、稼働を 1 件直す");
  await page.getByRole("button", { name: "締めを外す" }).click();
  await expect(page.getByText(/締めを外しています/).first()).toBeVisible();
  await expect(page.getByRole("heading", { name: /を締める$/ })).toBeVisible();
});

test("デモでは、ログインの画面は開かずにデモの入口へ移る", async ({ page }) => {
  await page.goto("/login");
  await expect(page).toHaveURL(/\/demo\/start/);
});
