/**
 * Gate 1.2 spike: PIN認証後にサーバーだけがSupabase Auth sessionを発行できるか。
 *
 * 検証する構成（Gate 1.4で実装する予定の形の最小再現）:
 *   1. （このspikeでは省略）サーバーがPINを検証し、試行制限を適用する
 *   2. サーバーが secret key で auth.admin.generateLink({ type: "magiclink" }) を呼び、hashed_token を得る
 *      （メールは送られない。hashed_tokenはブラウザへ返さない）
 *   3. サーバーが anon key のSSR clientで verifyOtp({ token_hash }) を呼び、sessionをcookieへ書く
 *
 * 対象はローカルのSupabase（`supabase start`）のみ。hosted project（Development / Production）へは接続しない。
 * 必要な環境変数はローカルの `supabase status -o env` の値（公開済みの既定鍵）から渡す。
 */
import { createServerClient } from "@supabase/ssr";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const url = process.env.SPIKE_SUPABASE_URL ?? "";
const anonKey = process.env.SPIKE_ANON_KEY ?? "";
const serviceKey = process.env.SPIKE_SERVICE_ROLE_KEY ?? "";

const NO_SESSION_PERSISTENCE = { auth: { autoRefreshToken: false, persistSession: false } } as const;

type CookieJar = Map<string, string>;

/** Route Handler内のSSR clientを模す。setAllで受けたcookieをjarへ保持する */
function createSsrClient(jar: CookieJar) {
  return createServerClient(url, anonKey, {
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
}

let admin: SupabaseClient;
const createdUserIds: string[] = [];
const createdSpaceIds: string[] = [];

type Fixture = { userId: string; email: string; spaceId: string };

/** 架空のAuth利用者（パスワードなし・実在しないメール）とspace / profileを作る（管理者操作） */
async function createMember(spaceId: string, displayName: string): Promise<Fixture> {
  const email = `spike-${randomUUID()}@example.test`;
  const { data, error } = await admin.auth.admin.createUser({ email, email_confirm: true });
  if (error || !data.user) throw new Error(`createUser failed: ${error?.message}`);
  createdUserIds.push(data.user.id);

  const { error: profileError } = await admin
    .from("profiles")
    .insert({ id: data.user.id, couple_space_id: spaceId, display_name: displayName });
  if (profileError) throw new Error(`profile insert failed: ${profileError.message}`);
  return { userId: data.user.id, email, spaceId };
}

async function createSpace(): Promise<string> {
  const { data, error } = await admin.from("couple_spaces").insert({}).select("id").single();
  if (error || !data) throw new Error(`space insert failed: ${error?.message}`);
  createdSpaceIds.push(data.id as string);
  return data.id as string;
}

/** サーバー側の処理: userIdからsessionを発行してcookieへ書く。tokenはこの関数の外へ出さない */
async function issueSessionForUser(userId: string, jar: CookieJar) {
  const { data: userData, error: userError } = await admin.auth.admin.getUserById(userId);
  if (userError || !userData.user?.email) throw new Error(`getUserById failed: ${userError?.message}`);

  const { data: link, error: linkError } = await admin.auth.admin.generateLink({
    type: "magiclink",
    email: userData.user.email,
  });
  if (linkError || !link.properties) throw new Error(`generateLink failed: ${linkError?.message}`);

  const tokenHash = link.properties.hashed_token;
  const ssr = createSsrClient(jar);
  const verified = await ssr.auth.verifyOtp({ token_hash: tokenHash, type: "email" });
  return { tokenHash, verificationType: link.properties.verification_type, ssr, verified };
}

beforeAll(() => {
  if (!url || !anonKey || !serviceKey) {
    throw new Error(
      "SPIKE_SUPABASE_URL / SPIKE_ANON_KEY / SPIKE_SERVICE_ROLE_KEY が未設定です。ローカルの `supabase status -o env` の値を渡してください。",
    );
  }
  const host = new URL(url).hostname;
  if (host !== "127.0.0.1" && host !== "localhost") {
    throw new Error("拒否: このテストはローカルSupabase（127.0.0.1 / localhost）専用です。");
  }
  admin = createClient(url, serviceKey, NO_SESSION_PERSISTENCE);
});

afterAll(async () => {
  if (!admin) return;
  for (const id of createdUserIds) await admin.auth.admin.deleteUser(id); // profilesはcascadeで消える
  for (const id of createdSpaceIds) await admin.from("couple_spaces").delete().eq("id", id);
});

describe("サーバーだけがsessionを発行できる（generateLink + verifyOtp）", () => {
  let spaceA = "";
  let spaceB = "";
  let userA: Fixture;
  let userA2: Fixture;
  let userB: Fixture;

  beforeAll(async () => {
    spaceA = await createSpace();
    spaceB = await createSpace();
    userA = await createMember(spaceA, "fixture-a");
    userA2 = await createMember(spaceA, "fixture-a2");
    userB = await createMember(spaceB, "fixture-b");
  });

  it("1. secret keyのサーバー処理でsessionが発行され、SSR cookieへ書かれる", async () => {
    const jar: CookieJar = new Map();
    const { verified, verificationType, ssr } = await issueSessionForUser(userA.userId, jar);

    expect(verified.error).toBeNull();
    expect(verified.data.session?.access_token).toBeTruthy();
    expect(verified.data.session?.refresh_token).toBeTruthy();
    expect(verified.data.user?.id).toBe(userA.userId);
    expect(verificationType).toBeTruthy();
    // Supabase SSRのcookie（sb-<ref>-auth-token。大きい場合は .0 .1 に分割）
    expect([...jar.keys()].some((name) => /^sb-.+-auth-token(\.\d+)?$/.test(name))).toBe(true);

    // cookieだけから別のSSR clientを作ってもuserを取得できる（次のリクエストを模す）
    const next = createSsrClient(new Map(jar));
    const { data, error } = await next.auth.getUser();
    expect(error).toBeNull();
    expect(data.user?.id).toBe(userA.userId);

    // refreshも動く
    const refreshed = await ssr.auth.refreshSession();
    expect(refreshed.error).toBeNull();
    expect(refreshed.data.session?.access_token).toBeTruthy();
  });

  it("2. 発行したsessionでGate 1.1のRLSが効く（自分のspaceだけ読める）", async () => {
    const jar: CookieJar = new Map();
    const { verified } = await issueSessionForUser(userA.userId, jar);
    const accessToken = verified.data.session?.access_token ?? "";
    expect(accessToken).not.toBe("");

    const asUser = createClient(url, anonKey, {
      ...NO_SESSION_PERSISTENCE,
      global: { headers: { Authorization: `Bearer ${accessToken}` } },
    });

    const spaces = await asUser.from("couple_spaces").select("id");
    expect(spaces.error).toBeNull();
    expect((spaces.data ?? []).map((row) => row.id)).toEqual([spaceA]);

    const profiles = await asUser.from("profiles").select("id, couple_space_id, display_name");
    expect(profiles.error).toBeNull();
    expect((profiles.data ?? []).map((row) => row.id).sort()).toEqual([userA.userId, userA2.userId].sort());
    expect((profiles.data ?? []).some((row) => row.id === userB.userId)).toBe(false);

    // session無しのanonは読めない
    const anon = createClient(url, anonKey, NO_SESSION_PERSISTENCE);
    const denied = await anon.from("profiles").select("id");
    expect(denied.error).not.toBeNull();
  });

  it("3. tokenは一回限り: 使用済みのtoken_hashは再利用できない", async () => {
    const jar: CookieJar = new Map();
    const { tokenHash, verified } = await issueSessionForUser(userA.userId, jar);
    expect(verified.error).toBeNull();

    const reuse = await createSsrClient(new Map()).auth.verifyOtp({ token_hash: tokenHash, type: "email" });
    expect(reuse.error).not.toBeNull();
    expect(reuse.data.session).toBeNull();
  });

  it("3b. tokenは期限切れで拒否される（ローカルはotp_expiry=20秒）", async () => {
    const { data: userData } = await admin.auth.admin.getUserById(userA.userId);
    const { data: link, error } = await admin.auth.admin.generateLink({
      type: "magiclink",
      email: userData.user?.email ?? "",
    });
    expect(error).toBeNull();

    await new Promise((resolve) => setTimeout(resolve, 25_000));

    const expired = await createSsrClient(new Map()).auth.verifyOtp({
      token_hash: link.properties?.hashed_token ?? "",
      type: "email",
    });
    expect(expired.error).not.toBeNull();
    expect(expired.data.session).toBeNull();
  }, 60_000);

  describe("4. ブラウザ側（anon key）からの回避は成立しない", () => {
    const browser = () => createClient(url, anonKey, NO_SESSION_PERSISTENCE);

    it("a. パスワード未設定のアカウントへ推測したPIN/パスワードでログインできない", async () => {
      for (const guess of ["000000", "123456", "111111"]) {
        const { data, error } = await browser().auth.signInWithPassword({ email: userA.email, password: guess });
        expect(error).not.toBeNull();
        expect(data.session).toBeNull();
      }
    });

    it("b. 公開サインアップは拒否される", async () => {
      const { data, error } = await browser().auth.signUp({
        email: `spike-${randomUUID()}@example.test`,
        password: `${randomUUID()}-${randomUUID()}`,
      });
      expect(error).not.toBeNull();
      expect(data.session).toBeNull();
    });

    it("c. ログインメールの送信を要求されても、sessionは得られない（結果は記録）", async () => {
      const { data, error } = await browser().auth.signInWithOtp({
        email: userA.email,
        options: { shouldCreateUser: false },
      });
      // メール送信の成否は環境依存（ローカルはMailpit）。どちらでもsessionは返らないことを確認する
      console.info(`[spike] signInWithOtp by anon: ${error ? `error(${error.status}, ${error.code})` : "accepted (email queued)"}`);
      expect(data.session).toBeNull();
    });

    it("d. 推測した6桁OTP・任意のtoken_hashではsessionを得られない", async () => {
      const guess = await browser().auth.verifyOtp({ email: userA.email, token: "123456", type: "email" });
      expect(guess.error).not.toBeNull();
      expect(guess.data.session).toBeNull();

      const forged = await browser().auth.verifyOtp({ token_hash: "a".repeat(64), type: "email" });
      expect(forged.error).not.toBeNull();
      expect(forged.data.session).toBeNull();
    });

    it("e. anon keyではAdmin API（generateLink / createUser）を呼べない", async () => {
      const link = await browser().auth.admin.generateLink({ type: "magiclink", email: userA.email });
      expect(link.error).not.toBeNull();
      expect(link.data.properties).toBeNull();

      const created = await browser().auth.admin.createUser({ email: `spike-${randomUUID()}@example.test` });
      expect(created.error).not.toBeNull();
    });

    it("f. 発行済みユーザーのアクセストークンでも他人のsessionは発行できない", async () => {
      const { verified } = await issueSessionForUser(userA.userId, new Map());
      const asUserA = createClient(url, anonKey, {
        ...NO_SESSION_PERSISTENCE,
        global: { headers: { Authorization: `Bearer ${verified.data.session?.access_token ?? ""}` } },
      });
      const link = await asUserA.auth.admin.generateLink({ type: "magiclink", email: userB.email });
      expect(link.error).not.toBeNull();
    });
  });

  it("5. Authアカウントにパスワード（PIN）は保存されない", async () => {
    const { data, error } = await admin.auth.admin.getUserById(userA.userId);
    expect(error).toBeNull();
    // Admin APIのレスポンスにパスワード/ハッシュ関連のフィールドが含まれない
    expect(JSON.stringify(data.user)).not.toMatch(/encrypted_password|password_hash/i);
    // メール認証のprovider（PINではない）で作成されており、パスワード未設定のためパスワードログインは4-aで拒否された
    expect(data.user?.app_metadata?.provider).toBe("email");
  });
});
