import type { MetadataRoute } from "next";
import { SITE } from "@/site.config";

export default function robots(): MetadataRoute.Robots {
  return {
    rules: [{ userAgent: "*", allow: "/", disallow: ["/api/", "/demo/print", "/kit/"] }],
    sitemap: `${SITE.url}/sitemap.xml`,
  };
}
