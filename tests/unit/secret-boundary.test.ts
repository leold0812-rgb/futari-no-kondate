import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";

// server secretがブラウザへ届く経路を静的に検査する（buildのserver-only検査に加えた二重の安全策）
const ROOT = join(__dirname, "..", "..");
const SERVER_SECRET_NAMES = [
  "SUPABASE_SERVICE_ROLE_KEY",
  "OPENAI_API_KEY",
  "CRON_SECRET",
  "BLOB_READ_WRITE_TOKEN",
  "PIN_PEPPER",
];
const SERVER_ONLY_MODULES = [
  "lib/env/server.ts",
  "lib/supabase/server.ts",
  "lib/supabase/admin.ts",
  "lib/auth/session.ts",
];
const ALWAYS_CLIENT_REACHABLE = ["lib/env/public.ts", "lib/supabase/client.ts"];

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return sourceFiles(path);
    return /\.(ts|tsx)$/.test(name) ? [relative(ROOT, path)] : [];
  });
}

const read = (file: string) => readFileSync(join(ROOT, file), "utf8");

describe("server secretの境界", () => {
  it.each(SERVER_ONLY_MODULES)("%s は server-only を最初にimportする", (file) => {
    expect(read(file).trimStart().startsWith('import "server-only";')).toBe(true);
  });

  const clientFiles = [
    ...ALWAYS_CLIENT_REACHABLE,
    ...["app", "components", "lib"]
      .flatMap((dir) => sourceFiles(join(ROOT, dir)))
      .filter((file) => /^["']use client["']/.test(read(file).trimStart())),
  ];

  it.each(clientFiles)("%s はserver secretとserver専用moduleを参照しない", (file) => {
    const source = read(file);
    for (const name of SERVER_SECRET_NAMES) {
      expect(source).not.toContain(name);
    }
    expect(source).not.toMatch(/lib\/(env\/server|supabase\/(server|admin)|auth\/session)/);
  });
});
