import path from "node:path";
import type { NextConfig } from "next";

const securityHeaders = [
  { key: "X-Frame-Options", value: "DENY" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "same-origin" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
  { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains" },
];

const nextConfig: NextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  // 計算の部品（side-business/lib）をサイトと共有する。コピーしない
  outputFileTracingRoot: path.join(__dirname, ".."),
  serverExternalPackages: ["@electric-sql/pglite", "@react-pdf/renderer", "exceljs", "postgres"],
  outputFileTracingIncludes: {
    "/**": ["./fonts/**/*", "./db/migrations/**/*"],
  },
  experimental: {
    externalDir: true,
    serverActions: { bodySizeLimit: "10mb" },
  },
  async headers() {
    // ドライバーが開くリンク（明細 /s・取引条件 /t）は検索に出さない・残さない・リンク元を送らない（後に書いたものが勝つ）
    const privateLink = [
      { key: "X-Robots-Tag", value: "noindex, nofollow" },
      { key: "Referrer-Policy", value: "no-referrer" },
      { key: "Cache-Control", value: "private, no-store" },
    ];
    return [
      { source: "/(.*)", headers: securityHeaders },
      { source: "/s/:path*", headers: privateLink },
      { source: "/t/:path*", headers: privateLink },
      { source: "/api/s/:path*", headers: privateLink },
      { source: "/api/t/:path*", headers: privateLink },
      // デモの入口は検索に出さない・たどらせない（開いただけでは何も作らないが、ロボットを呼び込まない）
      { source: "/demo/:path*", headers: [{ key: "X-Robots-Tag", value: "noindex, nofollow" }] },
    ];
  },
};

export default nextConfig;
