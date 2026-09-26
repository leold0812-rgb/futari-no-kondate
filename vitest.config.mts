import { fileURLToPath } from "node:url";
import react from "@vitejs/plugin-react";
import { configDefaults, defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: { "@": fileURLToPath(new URL("./", import.meta.url)) },
  },
  test: {
    environment: "jsdom",
    include: ["tests/**/*.test.{ts,tsx}"],
    // 統合テストはローカルSupabaseが必要なため別コマンド（vitest.integration.config.mts）で実行する
    exclude: [...configDefaults.exclude, "tests/integration/**"],
    setupFiles: ["./tests/setup.ts"],
  },
});
