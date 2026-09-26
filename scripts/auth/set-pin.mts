/**
 * メンバーのPINを設定・再設定する（Gate 1.4）。再設定するとアカウントのログインロックも解除される。
 *
 *   node --env-file=.env.bootstrap.local scripts/auth/set-pin.mts --project-ref <ref> --member 1
 *
 * PINは端末で2回入力する（画面に表示しない）。CIなど非対話の環境だけ `--pin-stdin` で標準入力から1行読む。
 * 必要な環境変数: NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, PIN_PEPPER, BOOTSTRAP_MEMBER_<n>_EMAIL
 * PIN_PEPPERはアプリ（Vercel）と同じ値でなければならない。PIN・pepperは出力しない。
 */
import { createClient } from "@supabase/supabase-js";
import { parseArgs } from "node:util";
import { hashPin, validateNewPin, validatePepper } from "../../lib/auth/pin.ts";
import { checkAdminKey, checkSupabaseTarget } from "../lib/supabase-target.mts";

function fail(message: string): never {
  console.error(`エラー: ${message}`);
  process.exit(1);
}

/** 入力を画面に出さずに1行読む */
function promptHidden(question: string): Promise<string> {
  const stdin = process.stdin;
  if (!stdin.isTTY) {
    return Promise.reject(new Error("端末から実行してください（非対話の環境では --pin-stdin を使います）。"));
  }
  process.stdout.write(question);
  stdin.setRawMode(true);
  stdin.resume();
  stdin.setEncoding("utf8");
  return new Promise((resolve, reject) => {
    let value = "";
    const cleanup = () => {
      stdin.setRawMode(false);
      stdin.pause();
      stdin.off("data", onData);
    };
    const onData = (chunk: string) => {
      for (const char of chunk) {
        if (char === "\r" || char === "\n") {
          cleanup();
          process.stdout.write("\n");
          resolve(value);
          return;
        }
        if (char === "\u0003") {
          cleanup();
          process.stdout.write("\n");
          reject(new Error("中断しました。"));
          return;
        }
        if (char === "\u007f" || char === "\b") value = value.slice(0, -1);
        else value += char;
      }
    };
    stdin.on("data", onData);
  });
}

async function readStdinLine(): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) chunks.push(chunk as Buffer);
  return Buffer.concat(chunks).toString("utf8").split(/\r?\n/)[0] ?? "";
}

async function main() {
  const { values } = parseArgs({
    options: {
      "project-ref": { type: "string" },
      member: { type: "string" },
      "pin-stdin": { type: "boolean", default: false },
    },
    strict: true,
  });

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim() ?? "";
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim() ?? "";
  const pepper = process.env.PIN_PEPPER ?? "";
  const problem = checkSupabaseTarget(url, values["project-ref"]) ?? checkAdminKey(key) ?? validatePepper(pepper);
  if (problem) fail(problem);
  if (values.member !== "1" && values.member !== "2") fail("--member 1 または --member 2 を指定してください。");
  const email = process.env[`BOOTSTRAP_MEMBER_${values.member}_EMAIL`]?.trim().toLowerCase() ?? "";
  if (!email) fail(`BOOTSTRAP_MEMBER_${values.member}_EMAIL が設定されていません。`);

  let pin: string;
  if (values["pin-stdin"]) {
    pin = (await readStdinLine()).trim();
  } else {
    pin = await promptHidden(`メンバー${values.member}の新しいPIN（6〜12桁の数字）: `);
    const confirm = await promptHidden("もう一度入力してください: ");
    if (pin !== confirm) fail("2回の入力が一致しません。もう一度やり直してください。");
  }
  const pinProblem = validateNewPin(pin);
  if (pinProblem) fail(pinProblem);

  const admin = createClient(url, key, { auth: { autoRefreshToken: false, persistSession: false } });
  const { data, error } = await admin.auth.admin.listUsers({ page: 1, perPage: 1000 });
  if (error) fail(`Authユーザー一覧を取得できませんでした: ${error.message}`);
  const user = data.users.find((u) => (u.email ?? "").toLowerCase() === email);
  if (!user) fail(`メンバー${values.member}のAuthユーザーが見つかりません。先にbootstrapを実行してください。`);

  const { error: setError } = await admin.rpc("pin_set", { p_user_id: user.id, p_pin_hash: await hashPin(pin, pepper) });
  if (setError) fail(`PINを保存できませんでした: ${setError.message}`);
  console.log(`完了: メンバー${values.member}のPINを設定しました（ログインのロックも解除しました）。`);
}

main().catch((error: unknown) => fail(error instanceof Error ? error.message : "不明なエラーで停止しました。"));
