import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  poweredByHeader: false,
  // `next dev` がルートの AGENTS.md / CLAUDE.md を書き換えないようにする（開発ルールはプロジェクト側で管理）
  agentRules: false,
  async headers() {
    return [
      {
        // Service Workerの更新がすぐ届くよう、キャッシュさせない
        source: "/sw.js",
        headers: [
          { key: "Cache-Control", value: "no-cache, no-store, must-revalidate" },
          { key: "Content-Type", value: "application/javascript; charset=utf-8" },
        ],
      },
    ];
  },
  experimental: {
    serverActions: {
      // レシピ写真の送信用（ブラウザで長辺1600pxのJPEGへ縮小してから送る。サーバー側の上限は5MB）
      bodySizeLimit: "6mb",
    },
  },
};

export default nextConfig;
