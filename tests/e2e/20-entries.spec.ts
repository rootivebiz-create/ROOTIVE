/**
 * 稼働入力（§4.2）：一覧・追加（30 秒以内）・編集・削除・前月から複製・一括入力
 * 前提：§8.6 の初期データ（resetToSeed）。テストは順番に依存するため serial
 */
import { test, expect } from "@playwright/test";
import { E2E, listRow, loginViaMagicLink, readState, resetToSeed, saveScreenshot, toast, yen } from "./helpers";

test.describe.configure({ mode: "serial" });

test.beforeEach(async () => {
  const state = readState();
  test.skip(!state || state.appSkipped, "E2E_SKIP_APP=1 のため Next.js を起動していません");
});

test.describe("稼働入力", () => {
  test.beforeAll(async () => {
    const state = readState();
    if (!state || state.appSkipped) return;
    await resetToSeed();
  });

  test.beforeEach(async ({ page }) => {
    await loginViaMagicLink(page, E2E.users.owner.email, "/entries?m=2026-09");
  });

  test("一覧に 10 行と合計が表示され、稼働 1 行を 30 秒以内に追加できる（§0）", async ({ page }, testInfo) => {
    const isMobile = testInfo.project.name === "mobile";
    await expect(page.getByRole("heading", { name: "稼働入力" })).toBeVisible();
    await expect(page.getByText("2026年9月の稼働行 10 件")).toBeVisible();
    await expect(listRow(page, "相曽慧")).toContainText(yen(483525));
    await expect(listRow(page, /合計/)).toContainText(yen(2559573));
    if (isMobile) await saveScreenshot(page, "entries-mobile.png");

    // ＋ 稼働を追加 → 保存 → 一覧に反映されるまでの所要時間を計測する
    const started = Date.now();
    await page.getByRole("button", { name: "稼働を追加" }).click();
    const dialog = page.getByRole("dialog");
    await expect(dialog.getByRole("heading", { name: "稼働を追加" })).toBeVisible();
    await dialog.getByLabel("ドライバー", { exact: true }).selectOption({ label: "吉田雅一" });
    await dialog.getByLabel("案件", { exact: true }).selectOption({ label: "三郷Amazon" });
    await dialog.getByLabel("稼働日数").fill("20");

    // 支払単価は個別単価（吉田雅一 → 三郷Amazon 21,960）が自動入力され「自動」表示
    await expect(dialog.getByLabel("受注単価")).toHaveValue("23025");
    await expect(dialog.getByLabel("支払単価")).toHaveValue("21960");
    await expect(dialog.getByLabel("ロイヤリティ率（%）")).toHaveValue("10");
    await expect(dialog.getByText("自動", { exact: true })).toHaveCount(4);
    await expect(dialog.getByText("手入力", { exact: true })).toHaveCount(0);

    // プレビュー：会社売上 23,025 × 20、ドライバー売上 21,960 × 20
    await expect(dialog.getByText(yen(460500))).toBeVisible();
    await expect(dialog.getByText(yen(439200))).toBeVisible();
    if (isMobile) await saveScreenshot(page, "entry-dialog-mobile.png", { fullPage: false });

    await dialog.getByRole("button", { name: "保存", exact: true }).click();
    await expect(toast(page, "稼働を追加しました")).toBeVisible();
    await expect(page.getByText("2026年9月の稼働行 11 件")).toBeVisible();
    const elapsedMs = Date.now() - started;
    testInfo.annotations.push({ type: "稼働 1 行の追加にかかった時間", description: `${(elapsedMs / 1000).toFixed(1)} 秒` });
    expect(elapsedMs).toBeLessThan(30_000);

    await expect(listRow(page, "吉田雅一")).toContainText("20日");
    await expect(listRow(page, "吉田雅一")).toContainText(yen(460500));
  });

  test("稼働を編集できる（数量 20 → 21）", async ({ page }) => {
    const row = listRow(page, "吉田雅一");
    await expect(row).toContainText("20日");
    await row.getByRole("button", { name: "編集" }).click();
    const dialog = page.getByRole("dialog");
    await expect(dialog.getByRole("heading", { name: "稼働を編集" })).toBeVisible();
    await expect(dialog.getByLabel("稼働日数")).toHaveValue("20");
    await dialog.getByLabel("稼働日数").fill("21");
    await expect(dialog.getByText(yen(483525))).toBeVisible();
    await dialog.getByRole("button", { name: "保存", exact: true }).click();
    await expect(toast(page, "稼働を更新しました")).toBeVisible();
    await expect(listRow(page, "吉田雅一")).toContainText("21日");
    await expect(listRow(page, "吉田雅一")).toContainText(yen(483525));
  });

  test("稼働を削除できる（確認ダイアログ）", async ({ page }) => {
    await listRow(page, "吉田雅一").getByRole("button", { name: "削除" }).click();
    const dialog = page.getByRole("dialog");
    await expect(dialog.getByRole("heading", { name: "稼働を削除" })).toBeVisible();
    await expect(dialog).toContainText("吉田雅一／三郷Amazon");
    await dialog.getByRole("button", { name: "削除する" }).click();
    await expect(toast(page, "稼働を削除しました")).toBeVisible();
    await expect(page.getByText("2026年9月の稼働行 10 件")).toBeVisible();
    await expect(listRow(page, "吉田雅一")).toHaveCount(0);
  });

  test("「前月から複製」で 2026年10月に数量 0 の行（未入力）が作られる", async ({ page }) => {
    await page.goto("/entries?m=2026-10");
    await expect(page.getByText("この月の稼働はまだありません")).toBeVisible();
    await page.getByRole("button", { name: "前月から複製" }).first().click();
    const dialog = page.getByRole("dialog");
    await expect(dialog.getByRole("heading", { name: "前月から複製" })).toBeVisible();
    await expect(dialog).toContainText("2026年9月の稼働行を数量 0 で2026年10月に複製します");
    await dialog.getByRole("button", { name: "複製する" }).click();
    await expect(toast(page, "2026年9月から 10 件を複製しました")).toBeVisible();
    await expect(page.getByText("2026年10月の稼働行 10 件")).toBeVisible();
    await expect(page.getByText("未入力").filter({ visible: true })).toHaveCount(10);
    await expect(listRow(page, "藤田裕介")).toContainText("0日");

    // もう一度実行しても重複しない（冪等）
    await page.getByRole("button", { name: "前月から複製" }).first().click();
    await page.getByRole("dialog").getByRole("button", { name: "複製する" }).click();
    await expect(toast(page, "複製対象がありません")).toBeVisible();
    await expect(page.getByText("2026年10月の稼働行 10 件")).toBeVisible();
  });

  test("一括入力：Temu に 藤田裕介 22・高森豪介 3 を保存すると件数が toast に出る", async ({ page }) => {
    await page.goto("/entries/bulk?m=2026-10");
    await expect(page.getByRole("heading", { name: "一括入力" })).toBeVisible();
    await page.getByLabel("案件（内容）").selectOption({ label: "Temu" });
    const fujita = page.getByLabel("藤田裕介の稼働日数");
    await expect(fujita).toHaveValue("0");
    await fujita.fill("22");
    await page.getByLabel("高森豪介の稼働日数").fill("3");
    await expect(page.getByText("変更 2 件")).toBeVisible();
    await page.getByRole("button", { name: "保存", exact: true }).click();
    await expect(toast(page, /追加 1 件／更新 1 件／削除 0 件/)).toBeVisible();

    await page.goto("/entries?m=2026-10");
    await expect(page.getByText("2026年10月の稼働行 11 件")).toBeVisible();
    await expect(listRow(page, "高森豪介")).toContainText("3日");
    await expect(listRow(page, "藤田裕介")).toContainText("22日");
  });
});
