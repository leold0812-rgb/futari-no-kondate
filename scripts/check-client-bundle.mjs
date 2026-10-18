// `next build` 後に実行し、ブラウザへ配信されるbundleにserver secretの変数名が含まれないことを検査する。
// 変数名が見つかった場合はファイル名だけを出力し、周辺の内容（値の可能性がある）は出力しない。
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";

const STATIC_DIR = join(process.cwd(), ".next", "static");
const SERVER_SECRET_NAMES = [
  "SUPABASE_SERVICE_ROLE_KEY",
  "OPENAI_API_KEY",
  "CRON_SECRET",
  "BLOB_READ_WRITE_TOKEN",
];

if (!existsSync(STATIC_DIR)) {
  console.error("`.next/static` がありません。先に `npm run build` を実行してください。");
  process.exit(1);
}

function listFiles(dir) {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? listFiles(path) : [path];
  });
}

const findings = [];
for (const file of listFiles(STATIC_DIR)) {
  const content = readFileSync(file, "utf8");
  for (const name of SERVER_SECRET_NAMES) {
    if (content.includes(name)) findings.push(`${relative(process.cwd(), file)}: ${name}`);
  }
}

if (findings.length > 0) {
  console.error("client bundleにserver secretの変数名が含まれています：");
  for (const finding of findings) console.error(`  ${finding}`);
  process.exit(1);
}

console.log("client bundleにserver secretの変数名は含まれていません。");
