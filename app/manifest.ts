import type { MetadataRoute } from "next";

/**
 * PWA の設定（ホーム画面に追加したときの見え方）
 * - 電波の弱い現場でも開けるよう、起点は "/"（ロールに応じた画面へ自動で移る）
 * - ショートカットから「今日の報告」をすぐ開ける
 */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "ROOTIVE 利益管理",
    short_name: "ROOTIVE",
    description: "株式会社ROOTIVE 利益管理システム",
    start_url: "/",
    scope: "/",
    id: "/",
    display: "standalone",
    orientation: "portrait",
    background_color: "#f7f7f8",
    theme_color: "#1f5eff",
    lang: "ja",
    dir: "ltr",
    categories: ["business", "productivity"],
    icons: [
      { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
    shortcuts: [
      {
        name: "今日の報告",
        short_name: "今日の報告",
        description: "出発前・稼働・終了後を記録します",
        url: "/driver/today",
        icons: [{ src: "/icons/icon-192.png", sizes: "192x192", type: "image/png" }],
      },
      {
        name: "稼働",
        short_name: "稼働",
        description: "月次の稼働を入力します",
        url: "/entries",
        icons: [{ src: "/icons/icon-192.png", sizes: "192x192", type: "image/png" }],
      },
    ],
  };
}
