import type { Metadata, Viewport } from "next";
import { ServiceWorkerRegistration } from "@/components/pwa/service-worker";
import "./globals.css";

export const metadata: Metadata = {
  title: "ふたりの献立",
  description: "週1回の計画だけで、平日は選んで作れる2人専用の献立アプリ",
  applicationName: "ふたりの献立",
  appleWebApp: {
    capable: true,
    title: "ふたりの献立",
    statusBarStyle: "default",
  },
  formatDetection: { telephone: false },
  // 2人専用の非公開アプリのため検索エンジンへ載せない
  robots: { index: false, follow: false },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: "#f7f3ea",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="ja">
      <body>
        {children}
        <ServiceWorkerRegistration />
      </body>
    </html>
  );
}
