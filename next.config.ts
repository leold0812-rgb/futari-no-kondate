import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  poweredByHeader: false,
  // `next dev` がルートの AGENTS.md / CLAUDE.md を書き換えないようにする（開発ルールはプロジェクト側で管理）
  agentRules: false,
};

export default nextConfig;
