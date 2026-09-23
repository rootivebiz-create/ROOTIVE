import { defineConfig, devices } from "@playwright/test";

/**
 * 製品の画面をブラウザで確かめる（デモの架空の会社・揮発する PGlite）。
 *   npm run test:e2e                         本番のビルドを作ってから、本番のサーバーで（CI・デプロイの前）
 *   E2E_SKIP_BUILD=1 npm run test:e2e        すぐ前に作ったビルドをそのまま使う（手元でくり返すとき）
 *   E2E_DEV=1 npm run test:e2e               手元で開発用のサーバーで（ビルドしない。最初の表示が遅い）
 * スマホ 320px・375px とパソコンの 3 つで、同じ確かめをする
 */
const port = 3310;
const dev = process.env.E2E_DEV === "1";
const skipBuild = process.env.E2E_SKIP_BUILD === "1";

const command = dev ? `npx next dev -p ${port}` : skipBuild ? `npx next start -p ${port}` : `npm run build && npx next start -p ${port}`;

export default defineConfig({
  testDir: "e2e",
  timeout: dev ? 240_000 : 120_000,
  expect: { timeout: dev ? 30_000 : 10_000 },
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: "list",
  use: {
    // 127.0.0.1 ではなく localhost（http でもクッキーの Secure を受け付ける）
    baseURL: `http://localhost:${port}`,
    locale: "ja-JP",
    timezoneId: "Asia/Tokyo",
    trace: "retain-on-failure",
    navigationTimeout: dev ? 120_000 : 30_000,
    actionTimeout: dev ? 60_000 : 15_000,
    // 言語の設定が無い環境（LANG が空＝ASCII）では、Chromium が日本語のファイル名を「download」にしてしまう
    launchOptions: { env: { ...process.env, LANG: process.env.LANG || "C.UTF-8" } },
  },
  webServer: {
    command,
    url: `http://localhost:${port}`,
    // 古いサーバーを使い回すと、前のビルドの画面を確かめてしまう
    reuseExistingServer: false,
    // ビルドから始めるので長めに待つ（4 コアで数分）
    timeout: 600_000,
    stdout: "ignore",
    stderr: "pipe",
    env: {
      DEMO_MODE: "1",
      PGLITE_DIR: "memory",
      APP_SECRET: "e2e-secret-e2e-secret-e2e-secret-e2e-secret",
      NODE_ENV: dev ? "development" : "production",
      NEXT_TELEMETRY_DISABLED: "1",
    },
  },
  projects: [
    {
      name: "mobile-375",
      use: { ...devices["Pixel 5"], viewport: { width: 375, height: 740 }, isMobile: true, hasTouch: true },
    },
    {
      name: "mobile-320",
      use: { ...devices["Pixel 5"], viewport: { width: 320, height: 640 }, isMobile: true, hasTouch: true },
    },
    { name: "desktop", use: { ...devices["Desktop Chrome"], viewport: { width: 1280, height: 800 } } },
  ],
});
