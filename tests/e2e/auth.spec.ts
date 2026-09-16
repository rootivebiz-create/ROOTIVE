/**
 * 認証の主要導線（招待リンクログイン／ログアウト／不正トークン）
 * global-setup が E2E_SKIP_APP=1 でアプリを起動していない場合は skip する
 */
import { test, expect } from "@playwright/test";
import { E2E, createInvitation, loginViaMagicLink, logout, readState, seedInitialData } from "./helpers";

test.beforeEach(async () => {
  const state = readState();
  test.skip(!state || state.appSkipped, "E2E_SKIP_APP=1 のため Next.js を起動していません");
});

test.describe("認証", () => {
  test("招待リンクを開いて「ログインして始める」でログインできる", async ({ page }, testInfo) => {
    // 招待リンクは 1 回限りなので、テスト（プロジェクト）ごとに新しい招待を作る
    const email = `invitee-${testInfo.project.name}-${Date.now()}@example.com`;
    const token = createInvitation({ email, role: "admin", displayName: "招待テスト" });

    await page.goto(`/invite/${token}`);
    await expect(page.getByText(`${E2E.companyName} への招待`)).toBeVisible();
    await expect(page.getByText(email)).toBeVisible();
    await expect(page.getByText("管理者")).toBeVisible();

    await page.getByRole("button", { name: "ログインして始める" }).click();
    await page.waitForURL(/\/(dashboard|settings)/, { timeout: 30_000 });
    expect(new URL(page.url()).pathname).toMatch(/^\/(dashboard|settings)/);
    await expect(page.getByRole("button", { name: "ユーザーメニュー" })).toBeVisible();

    // 使用済みの招待リンクは再利用できない
    await page.goto(`/invite/${token}`);
    await expect(page.getByText("既に使用されています")).toBeVisible();
  });

  test("マジックリンクでログインし、ユーザーメニューからログアウトできる", async ({ page }) => {
    await seedInitialData();
    await loginViaMagicLink(page, E2E.users.owner.email, "/settings");
    await expect(page.getByRole("button", { name: "ユーザーメニュー" })).toBeVisible();
    await page.getByRole("button", { name: "ユーザーメニュー" }).click();
    await expect(page.getByText(E2E.users.owner.email)).toBeVisible();
    await page.keyboard.press("Escape");

    await logout(page);
    await expect(page).toHaveURL(/\/login/);

    // ログアウト後は保護ページへ入れない（/login へリダイレクト）
    await page.goto("/settings");
    await expect(page).toHaveURL(/\/login/);
  });

  test("不正な招待トークンではエラーが表示される", async ({ page }) => {
    await page.goto(`/invite/${"0".repeat(48)}`);
    await expect(page.getByText("招待リンクが見つかりません")).toBeVisible();
    await expect(page.getByRole("button", { name: "ログインして始める" })).toHaveCount(0);
    await expect(page.getByRole("link", { name: "ログイン画面へ" })).toBeVisible();
  });

  test("未ログインで保護ページを開くとログイン画面へ", async ({ page }) => {
    await page.goto("/dashboard");
    await expect(page).toHaveURL(/\/login\?next=/);
    await expect(page.getByRole("heading", { name: "ログイン" })).toBeVisible();
  });
});
