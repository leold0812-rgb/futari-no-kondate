/**
 * Gate 1.4 / 1.7: PINログイン（lib/auth/pin-login.ts）をローカルSupabaseで検証する。
 * - 正しいPINでだけsessionが発行され、RLSを通して同じspaceのデータを読める
 * - 誤りが続いてもアカウントはロックしない（送信元単位の制限だけ。20261007090000）
 * - PINハッシュ・試行制限はブラウザ側（anon / authenticated）から触れない
 */
import { createServerClient } from "@supabase/ssr";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { deriveSourceKey, hashPin } from "@/lib/auth/pin";
import { loginWithPin } from "@/lib/auth/pin-login";
import { createAdminClient, createAnonClient, readLocalSupabaseEnv, type LocalSupabaseEnv } from "./helpers/local-supabase";

const pepper = `test-pepper-${randomUUID()}`;
const PIN_A = "274951";
const PIN_B = "860317";

let env: LocalSupabaseEnv;
let admin: SupabaseClient;
const userIds: string[] = [];
let spaceId = "";

function newSessionClient() {
  const jar = new Map<string, string>();
  const client = createServerClient(env.url, env.anonKey, {
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
  return { client, jar };
}

async function createMember(displayName: string, pin: string) {
  const { data, error } = await admin.auth.admin.createUser({
    email: `pin-${randomUUID()}@futari-no-kondate.invalid`,
    email_confirm: true,
  });
  if (error || !data.user) throw new Error(`createUser failed: ${error?.message}`);
  userIds.push(data.user.id);
  const { error: profileError } = await admin
    .from("profiles")
    .insert({ id: data.user.id, couple_space_id: spaceId, display_name: displayName });
  if (profileError) throw new Error(profileError.message);
  const { error: pinError } = await admin.rpc("pin_set", { p_user_id: data.user.id, p_pin_hash: await hashPin(pin, pepper) });
  if (pinError) throw new Error(pinError.message);
  return data.user.id;
}

let userA = "";
let userB = "";

beforeAll(async () => {
  env = readLocalSupabaseEnv();
  admin = createAdminClient(env);
  const { data, error } = await admin.from("couple_spaces").insert({}).select("id").single();
  if (error) throw new Error(error.message);
  spaceId = data.id as string;
  userA = await createMember("pin-a", PIN_A);
  userB = await createMember("pin-b", PIN_B);
});

afterAll(async () => {
  if (!admin) return;
  for (const id of userIds) await admin.auth.admin.deleteUser(id);
  if (spaceId) await admin.from("couple_spaces").delete().eq("id", spaceId);
});

const source = (label: string) => deriveSourceKey(`198.51.100.${label}`, pepper);

describe("PINログイン", () => {
  it("正しいPINでsessionが発行され、同じspaceの2人分を読める", async () => {
    const { client, jar } = newSessionClient();
    const result = await loginWithPin({ admin, sessionClient: client, pepper, userId: userA, pin: PIN_A, sourceKey: source("1") });
    expect(result).toEqual({ ok: true });
    expect([...jar.keys()].some((name) => /^sb-.+-auth-token/.test(name))).toBe(true);

    const { data: user } = await client.auth.getUser();
    expect(user.user?.id).toBe(userA);
    const { data: profiles } = await client.from("profiles").select("display_name").order("display_name");
    expect(profiles?.map((p) => p.display_name)).toEqual(["pin-a", "pin-b"]);
  });

  it("相手のPINや誤ったPINではsessionが発行されない", async () => {
    const { client, jar } = newSessionClient();
    const result = await loginWithPin({ admin, sessionClient: client, pepper, userId: userA, pin: PIN_B, sourceKey: source("2") });
    expect(result).toEqual({ ok: false, reason: "wrong_pin" });
    expect(jar.size).toBe(0);
  });

  it("形式が不正な入力は試行として数えずに拒否する", async () => {
    const { client } = newSessionClient();
    for (const [userId, pin] of [
      [userA, "12345"],
      [userA, "abcdef"],
      ["not-a-uuid", PIN_A],
    ]) {
      const result = await loginWithPin({ admin, sessionClient: client, pepper, userId, pin, sourceKey: source("3") });
      expect(result).toEqual({ ok: false, reason: "invalid_input" });
    }
  });

  it("連続で間違えてもロックされず、正しいPINでログインできる", async () => {
    const { client, jar } = newSessionClient();
    const results = [];
    for (let i = 0; i < 6; i += 1) {
      results.push(
        (await loginWithPin({ admin, sessionClient: client, pepper, userId: userB, pin: "111112", sourceKey: source("4") })).ok,
      );
    }
    expect(results).toEqual([false, false, false, false, false, false]);
    expect(jar.size).toBe(0);

    const afterMistakes = await loginWithPin({ admin, sessionClient: client, pepper, userId: userB, pin: PIN_B, sourceKey: source("4") });
    expect(afterMistakes).toEqual({ ok: true });
  });

  it("PIN未登録・profileの無いIDは照合せずに「準備ができていない」を返す", async () => {
    const { data } = await admin.auth.admin.createUser({
      email: `no-pin-${randomUUID()}@futari-no-kondate.invalid`,
      email_confirm: true,
    });
    userIds.push(data.user!.id);
    const { client } = newSessionClient();
    const result = await loginWithPin({ admin, sessionClient: client, pepper, userId: data.user!.id, pin: PIN_A, sourceKey: source("8") });
    expect(result).toEqual({ ok: false, reason: "not_ready" });
    const random = await loginWithPin({ admin, sessionClient: client, pepper, userId: randomUUID(), pin: PIN_A, sourceKey: source("8") });
    expect(random).toEqual({ ok: false, reason: "not_ready" });
  });

  it("PINハッシュと試行制限はブラウザ側から触れない", async () => {
    const anon = createAnonClient(env);
    const begin = await anon.rpc("pin_login_begin", { p_user_id: userA, p_source: "x" });
    expect(begin.error).not.toBeNull();
    const set = await anon.rpc("pin_set", { p_user_id: userA, p_pin_hash: "scrypt$1$x" });
    expect(set.error).not.toBeNull();

    // ログイン済みの利用者（authenticated）でも実行できない
    const { client } = newSessionClient();
    await loginWithPin({ admin, sessionClient: client, pepper, userId: userA, pin: PIN_A, sourceKey: source("7") });
    const asUser = await client.rpc("pin_set", { p_user_id: userA, p_pin_hash: "scrypt$1$x" });
    expect(asUser.error).not.toBeNull();
    const reset = await client.rpc("pin_login_succeeded", { p_user_id: userB });
    expect(reset.error).not.toBeNull();

    // private schemaはAPIに公開されていない
    const direct = await createClient(env.url, env.anonKey, { db: { schema: "private" } })
      .from("pin_credentials")
      .select("pin_hash");
    expect(direct.error).not.toBeNull();
  });
});
