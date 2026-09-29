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
 * PDF 用の日本語フォント（lib/pdf/fonts.ts）。**public/ には置かない**（Vercel では public/ がサーバーの関数に入らない）。
 * PDF を作る所（出力の口・請求書のメール送付の画面・本番の確認口）にはすべて明示して同梱する
 */
const PDF_FONTS = ["./assets/fonts/**/*"];
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

const nextConfig: NextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  // web-push は Node の crypto と https をそのまま使うのでバンドルしない
  serverExternalPackages: ["@react-pdf/renderer", "iconv-lite", "web-push"],
  // PDF 用の日本語フォントを Vercel のサーバーレス関数に同梱する
  outputFileTracingIncludes: Object.fromEntries(PDF_ROUTES.map((r) => [r, PDF_FONTS])),
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
