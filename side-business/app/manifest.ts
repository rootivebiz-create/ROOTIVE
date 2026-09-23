import type { MetadataRoute } from "next";
import { SITE } from "@/site.config";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: SITE.name,
    short_name: SITE.shortName,
    description: SITE.description,
    lang: "ja",
    start_url: "/",
    scope: "/",
    display: "standalone",
    background_color: "#16171a",
    theme_color: "#16171a",
    icons: [
      { src: "/icon-192.png", sizes: "192x192", type: "image/png" },
      { src: "/icon-512.png", sizes: "512x512", type: "image/png" },
      { src: "/icon-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}
