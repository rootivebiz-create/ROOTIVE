import type { NextConfig } from "next";

const securityHeaders = [
  { key: "X-Frame-Options", value: "DENY" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
  { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains; preload" },
  { key: "X-DNS-Prefetch-Control", value: "on" },
];

const nextConfig: NextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  serverExternalPackages: ["@react-pdf/renderer", "iconv-lite"],
  // PDF 明細用の日本語フォントを Vercel のサーバーレス関数に同梱する
  outputFileTracingIncludes: {
    "/api/export/statement.pdf": ["./public/fonts/**/*"],
    "/api/export/statements.zip": ["./public/fonts/**/*"],
  },
  experimental: {
    serverActions: { bodySizeLimit: "20mb" },
  },
  async headers() {
    return [{ source: "/(.*)", headers: securityHeaders }];
  },
};

export default nextConfig;
