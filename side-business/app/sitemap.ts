import type { MetadataRoute } from "next";
import { listArticles } from "@/lib/content";
import { SITE } from "@/site.config";

const STATIC_ROUTES = [
  "/",
  "/demo",
  "/tools",
  "/tools/invoice-cost",
  "/tools/torihiki-joken",
  "/tools/payout",
  "/for",
  "/for/trucking",
  "/for/publishing",
  "/for/it",
  "/for/beauty",
  "/for/school",
  "/articles",
  "/about",
  "/contact",
  "/legal/privacy",
];

export default function sitemap(): MetadataRoute.Sitemap {
  const now = new Date();
  return [
    ...STATIC_ROUTES.map((p) => ({ url: `${SITE.url}${p}`, lastModified: now })),
    ...listArticles().map((a) => ({ url: `${SITE.url}/articles/${a.slug}`, lastModified: new Date(a.updated) })),
  ];
}
