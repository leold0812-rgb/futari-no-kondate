import type { MetadataRoute } from "next";

// Service Worker（public/sw.js）はオフライン時の案内ページだけを持つ。利用データはキャッシュしない
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
      { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/icons/maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
      { src: "/icons/icon.svg", sizes: "any", type: "image/svg+xml", purpose: "any" },
    ],
  };
}
