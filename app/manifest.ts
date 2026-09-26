import type { MetadataRoute } from "next";

// Service Worker / offline cache はまだ導入しない（Gate 8で検討）
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "ふたりの献立",
    short_name: "献立",
    description: "週1回の計画だけで、平日は選んで作れる2人専用の献立アプリ",
    lang: "ja",
    start_url: "/",
    scope: "/",
    display: "standalone",
    orientation: "portrait",
    background_color: "#f7f3ea",
    theme_color: "#f7f3ea",
    icons: [
      {
        // 仮アイコン。正式なPNG（192/512・apple-touch-icon）は後続作業で差し替える
        src: "/icons/icon.svg",
        sizes: "any",
        type: "image/svg+xml",
        purpose: "any",
      },
    ],
  };
}
