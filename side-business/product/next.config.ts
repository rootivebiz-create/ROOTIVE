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
    return [{ source: "/(.*)", headers: securityHeaders }];
  },
};

export default nextConfig;
