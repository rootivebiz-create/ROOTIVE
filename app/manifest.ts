import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "ROOTIVE 利益管理",
    short_name: "ROOTIVE",
    description: "株式会社ROOTIVE 利益管理システム",
    start_url: "/dashboard",
    display: "standalone",
    background_color: "#f7f7f8",
    theme_color: "#1f5eff",
    lang: "ja",
    icons: [
      { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png" },
      { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png" },
      { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}
