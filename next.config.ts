import type { NextConfig } from "next";

const securityHeaders = [
  { key: "X-Frame-Options", value: "DENY" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
  { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains; preload" },
  { key: "X-DNS-Prefetch-Control", value: "on" },
];

/**
 * PDF を描くのに要るファイル。PDF を作る所（出力の口・請求書のメール送付の画面・本番の確認口）にはすべて明示して同梱する。
 * - 日本語フォント（lib/pdf/fonts.ts）。**public/ には置かない**（Vercel では public/ がサーバーの関数に入らない）
 * - pdfkit の標準フォント（Helvetica など）。pdfkit が `#standard-fonts/*` という内部の別名で読み込むため、
 *   ビルドの追跡が拾わず、Vercel だけ「Cannot find module …/standard-fonts/Helvetica.cjs」で PDF が失敗した
 *   （scripts/check-pdf-bundle.sh で手元でも再現・確認できる）
 */
const PDF_FILES = ["./assets/fonts/**/*", "./node_modules/pdfkit/js/standard-fonts/**/*"];
const PDF_ROUTES = [
  "/api/export/statement.pdf",
  "/api/export/statements.zip",
  "/api/export/invoice.pdf",
  "/api/export/month-report.pdf",
  "/api/export/roster.pdf",
  "/api/export/month-pack.zip",
  "/api/export/audit-pack.zip",
  "/api/health/pdf",
  "/invoices/[id]",
];

/**
 * 手元で「Vercel と同じく、追跡されたファイルだけ」で動くかを確かめるとき（scripts/check-pdf-bundle.sh）。
 * standalone は node_modules を追跡された分しか持たないので、Vercel だけで起きるファイル不足をここで再現できる
 */
const bundleCheck = process.env.NEXT_BUNDLE_CHECK === "1" ? ({ output: "standalone", distDir: ".next-bundle-check" } as const) : {};

const nextConfig: NextConfig = {
  ...bundleCheck,
  reactStrictMode: true,
  poweredByHeader: false,
  // web-push は Node の crypto と https をそのまま使うのでバンドルしない
  serverExternalPackages: ["@react-pdf/renderer", "iconv-lite", "web-push"],
  // PDF を描くのに要るフォントを Vercel のサーバーレス関数に同梱する
  outputFileTracingIncludes: Object.fromEntries(PDF_ROUTES.map((r) => [r, PDF_FILES])),
  experimental: {
    serverActions: { bodySizeLimit: "20mb" },
    // 一度開いた画面は数十秒のあいだ手元に残す。
    // タブを行き来したり「戻る」を押したときにサーバーを待たずに出る（0021）。
    staleTimes: { dynamic: 30, static: 180 },
  },
  async headers() {
    return [{ source: "/(.*)", headers: securityHeaders }];
  },
};

export default nextConfig;
