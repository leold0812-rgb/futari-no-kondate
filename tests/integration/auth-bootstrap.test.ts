/**
 * Gate 1.3: 固定2人のbootstrapスクリプト（scripts/auth/bootstrap-runner.mts）をローカルSupabaseで検証する。
 * - dry-runは書き込まない / applyで2人・1 space・2 profileになる / 再実行は変更なし
 * - 作ったアカウントはパスワード無しで、サーバー発行のsession（ADR 0001）でRLSを通して2人分を読める
 * - 設定にないAuthユーザーがいると何も変更せずに止まる
 */
import { createServerClient } from "@supabase/ssr";
import type { SupabaseClient } from "@supabase/supabase-js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { MemberConfig } from "@/scripts/auth/bootstrap-plan.mts";
import { readBootstrapState, runBootstrap } from "@/scripts/auth/bootstrap-runner.mts";
import {
  createAdminClient,
  createAnonClient,
  listAllAuthUsers,
  readLocalSupabaseEnv,
  type LocalSupabaseEnv,
} from "./helpers/local-supabase";

const members: MemberConfig[] = [
  { email: "member-1@futari-no-kondate.invalid", displayName: "テスト太郎" },
  { email: "member-2@futari-no-kondate.invalid", displayName: "テスト花子" },
];

let env: LocalSupabaseEnv;
let admin: SupabaseClient;

async function cleanUp() {
  for (const user of await listAllAuthUsers(admin)) await admin.auth.admin.deleteUser(user.id);
  await admin.from("couple_spaces").delete().not("id", "is", null);
}

beforeAll(async () => {
  env = readLocalSupabaseEnv();
  admin = createAdminClient(env);
  const existing = await listAllAuthUsers(admin);
  if (existing.length > 0) {
    throw new Error(`前提違反: ローカルSupabaseに既存のAuthユーザーが${existing.length}人います。`);
  }
});

afterAll(async () => {
  if (admin) await cleanUp();
});

describe("bootstrap（固定2人の初期登録）", () => {
  it("dry-runは予定を返すだけで書き込まない", async () => {
    const result = await runBootstrap({ admin, members, apply: false });
    expect(result.outcome).toBe("dry-run");
    const state = await readBootstrapState(admin);
    expect(state.authUsers).toHaveLength(0);
    expect(state.spaceIds).toHaveLength(0);
  });

  it("applyで2人のAuthユーザー・1つのspace・2件のprofileを作る", async () => {
    const logs: string[] = [];
    const result = await runBootstrap({ admin, members, apply: true, log: (m) => logs.push(m) });
    expect(result.outcome).toBe("applied");
    expect(logs.join("\n")).toContain("再計画の結果は「変更なし」");

    const state = await readBootstrapState(admin);
    expect(state.authUsers.map((u) => u.email).sort()).toEqual(members.map((m) => m.email).sort());
    expect(state.spaceIds).toHaveLength(1);
    expect(state.profiles).toHaveLength(2);
    expect(new Set(state.profiles.map((p) => p.coupleSpaceId))).toEqual(new Set(state.spaceIds));
    expect(state.profiles.map((p) => p.displayName).sort()).toEqual(members.map((m) => m.displayName).sort());

    for (const user of await listAllAuthUsers(admin)) {
      expect(user.email_confirmed_at).toBeTruthy();
      // パスワード関連の項目がAdmin APIの応答に含まれない（PINをAuthへ保存しない）
      expect(JSON.stringify(user)).not.toMatch(/password/i);
    }
  });

  it("再実行は変更なしで終わる（冪等）", async () => {
    const result = await runBootstrap({ admin, members, apply: true });
    expect(result.outcome).toBe("noop");
    const state = await readBootstrapState(admin);
    expect(state.authUsers).toHaveLength(2);
    expect(state.spaceIds).toHaveLength(1);
  });

  it("作ったアカウントはパスワードでログインできない", async () => {
    const { data, error } = await createAnonClient(env).auth.signInWithPassword({
      email: members[0].email,
      password: "123456",
    });
    expect(error).not.toBeNull();
    expect(data.session).toBeNull();
  });

  it("サーバー発行のsessionで、RLSを通して同じspaceの2人分のprofileを読める", async () => {
    const jar = new Map<string, string>();
    const ssr = createServerClient(env.url, env.anonKey, {
      cookies: {
        getAll: () => [...jar].map(([name, value]) => ({ name, value })),
        setAll: (cookies) => {
          for (const { name, value } of cookies) {
            if (value === "") jar.delete(name);
            else jar.set(name, value);
          }
        },
      },
    });
    const { data: link, error: linkError } = await admin.auth.admin.generateLink({
      type: "magiclink",
      email: members[0].email,
    });
    expect(linkError).toBeNull();
    const verified = await ssr.auth.verifyOtp({ token_hash: link.properties!.hashed_token, type: "email" });
    expect(verified.error).toBeNull();

    const { data: profiles, error } = await ssr.from("profiles").select("id, couple_space_id, display_name");
    expect(error).toBeNull();
    expect(profiles?.map((p) => p.display_name).sort()).toEqual(members.map((m) => m.displayName).sort());
    await ssr.auth.signOut();
  });

  it("設定にないAuthユーザーがいれば、何も変更せずに止まる", async () => {
    const { data } = await admin.auth.admin.createUser({
      email: "unexpected@futari-no-kondate.invalid",
      email_confirm: true,
    });
    const before = await readBootstrapState(admin);
    const result = await runBootstrap({ admin, members, apply: true });
    expect(result.outcome).toBe("blocked");
    const after = await readBootstrapState(admin);
    expect(after.profiles).toEqual(before.profiles);
    expect(after.spaceIds).toEqual(before.spaceIds);
    await admin.auth.admin.deleteUser(data.user!.id);
  });
});
