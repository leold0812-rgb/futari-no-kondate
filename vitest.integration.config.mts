import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

// ローカルのSupabase（Auth / API）を必要とする統合テスト用。通常の `npm test` からは除外している。
// 実行: `npm run test:integration`（SPIKE_SUPABASE_URL / SPIKE_ANON_KEY / SPIKE_SERVICE_ROLE_KEY が必要）
export default defineConfig({
  resolve: {
    alias: { "@": fileURLToPath(new URL("./", import.meta.url)) },
  },
  test: {
    environment: "node",
    include: ["tests/integration/**/*.test.ts"],
    testTimeout: 90_000,
    hookTimeout: 90_000,
    fileParallelism: false,
  },
});
