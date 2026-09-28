import type { MetadataRoute } from "next";

/**
 * 製品の画面は検索に出さない（どの画面も noindex）。デモの入口と、ダウンロードの API はロボットに開かせない。
 * ドライバーのリンク（/s・/t）は X-Robots-Tag で noindex にしている（next.config.ts）
 */
export default function robots(): MetadataRoute.Robots {
  return {
    rules: [{ userAgent: "*", disallow: ["/demo/", "/api/"] }],
  };
}
