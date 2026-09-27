import { describe, expect, it } from "vitest";
import { planBootstrap, validateMembers, type BootstrapState, type MemberConfig } from "@/scripts/auth/bootstrap-plan.mts";
import { DEVELOPMENT_PROJECT_REF, checkAdminKey, checkKnownProject, checkSupabaseTarget } from "@/scripts/lib/supabase-target.mts";

const members: MemberConfig[] = [
  { email: "member-1@example.invalid", displayName: "あお" },
  { email: "member-2@example.invalid", displayName: "みどり" },
];

const empty: BootstrapState = { authUsers: [], profiles: [], spaceIds: [] };

describe("validateMembers", () => {
  it("正しい2人分の設定を受け付ける", () => {
    expect(validateMembers(members)).toBeNull();
  });

  it.each([
    ["人数が2人でない", [members[0]]],
    ["メール形式が不正", [{ ...members[0], email: "no-at-mark" }, members[1]]],
    ["表示名が空白だけ", [{ ...members[0], displayName: "   " }, members[1]]],
    ["表示名が31文字", [{ ...members[0], displayName: "あ".repeat(31) }, members[1]]],
    ["メールが同じ（大文字小文字違い）", [members[0], { ...members[1], email: "MEMBER-1@example.invalid" }]],
    ["表示名が同じ（前後空白違い）", [members[0], { ...members[1], displayName: " あお " }]],
  ])("%sなら拒否する", (_label, input) => {
    expect(validateMembers(input as MemberConfig[])).not.toBeNull();
  });

  it("表示名はコードポイント単位で30文字まで許可する（絵文字を含む）", () => {
    expect(validateMembers([{ ...members[0], displayName: "🍚".repeat(30) }, members[1]])).toBeNull();
  });
});

describe("planBootstrap", () => {
  it("空の状態からはユーザー2人・space・profile 2件を作る", () => {
    const plan = planBootstrap(members, empty);
    expect(plan.status).toBe("changes");
    if (plan.status === "blocked") return;
    expect(plan.actions.map((a) => a.kind)).toEqual([
      "createAuthUser",
      "createAuthUser",
      "createSpace",
      "insertProfile",
      "insertProfile",
    ]);
    expect(plan.targetSpace).toEqual({ kind: "new" });
  });

  it("完成済みの状態では何もしない（冪等）", () => {
    const state: BootstrapState = {
      authUsers: [
        { id: "u1", email: "member-1@example.invalid" },
        { id: "u2", email: "Member-2@Example.invalid" },
      ],
      profiles: [
        { id: "u1", coupleSpaceId: "s1", displayName: "あお" },
        { id: "u2", coupleSpaceId: "s1", displayName: "みどり" },
      ],
      spaceIds: ["s1"],
    };
    const plan = planBootstrap(members, state);
    expect(plan.status).toBe("noop");
  });

  it("ユーザー作成後に中断した状態からは、space作成とprofile登録だけを行う", () => {
    const state: BootstrapState = {
      authUsers: [
        { id: "u1", email: "member-1@example.invalid" },
        { id: "u2", email: "member-2@example.invalid" },
      ],
      profiles: [],
      spaceIds: [],
    };
    const plan = planBootstrap(members, state);
    if (plan.status === "blocked") throw new Error(plan.reason);
    expect(plan.actions.map((a) => a.kind)).toEqual(["createSpace", "insertProfile", "insertProfile"]);
  });

  it("メンバーのいないspaceが1件だけ残っていれば再利用する", () => {
    const plan = planBootstrap(members, { ...empty, spaceIds: ["left-over"] });
    if (plan.status === "blocked") throw new Error(plan.reason);
    expect(plan.targetSpace).toEqual({ kind: "existing", id: "left-over" });
    expect(plan.actions.some((a) => a.kind === "createSpace")).toBe(false);
    expect(plan.warnings).toHaveLength(1);
  });

  it("メンバーのいないspaceが複数あれば止まる", () => {
    const plan = planBootstrap(members, { ...empty, spaceIds: ["a", "b"] });
    expect(plan.status).toBe("blocked");
  });

  it("片方だけ所属済みなら、もう1人を同じspaceへ追加する", () => {
    const state: BootstrapState = {
      authUsers: [{ id: "u1", email: "member-1@example.invalid" }],
      profiles: [{ id: "u1", coupleSpaceId: "s1", displayName: "あお" }],
      spaceIds: ["s1"],
    };
    const plan = planBootstrap(members, state);
    if (plan.status === "blocked") throw new Error(plan.reason);
    expect(plan.targetSpace).toEqual({ kind: "existing", id: "s1" });
    expect(plan.actions).toEqual([
      { kind: "createAuthUser", member: 1, email: "member-2@example.invalid" },
      { kind: "insertProfile", member: 1, displayName: "みどり" },
    ]);
  });

  it("設定にないAuthユーザーがいれば何もせず止まる", () => {
    const plan = planBootstrap(members, {
      ...empty,
      authUsers: [{ id: "x", email: "someone@example.invalid" }],
    });
    expect(plan.status).toBe("blocked");
  });

  it("2人が別々のspaceに所属していれば止まる", () => {
    const state: BootstrapState = {
      authUsers: [
        { id: "u1", email: "member-1@example.invalid" },
        { id: "u2", email: "member-2@example.invalid" },
      ],
      profiles: [
        { id: "u1", coupleSpaceId: "s1", displayName: "あお" },
        { id: "u2", coupleSpaceId: "s2", displayName: "みどり" },
      ],
      spaceIds: ["s1", "s2"],
    };
    expect(planBootstrap(members, state).status).toBe("blocked");
  });

  it("表示名が設定と違えば変更する", () => {
    const state: BootstrapState = {
      authUsers: [
        { id: "u1", email: "member-1@example.invalid" },
        { id: "u2", email: "member-2@example.invalid" },
      ],
      profiles: [
        { id: "u1", coupleSpaceId: "s1", displayName: "旧名" },
        { id: "u2", coupleSpaceId: "s1", displayName: "みどり" },
      ],
      spaceIds: ["s1"],
    };
    const plan = planBootstrap(members, state);
    if (plan.status === "blocked") throw new Error(plan.reason);
    expect(plan.actions).toEqual([
      { kind: "updateDisplayName", member: 0, profileId: "u1", from: "旧名", to: "あお" },
    ]);
  });
});

describe("checkSupabaseTarget", () => {
  const ref = "abcdefghijklmnopqrst";

  it("hosted URLとproject refが一致すれば許可する", () => {
    expect(checkSupabaseTarget(`https://${ref}.supabase.co`, ref)).toBeNull();
  });

  it.each([
    ["refの指定なし", `https://${ref}.supabase.co`, undefined],
    ["refが違う（本番を取り違えた）", `https://${ref}.supabase.co`, "zzzzzzzzzzzzzzzzzzzz"],
    ["httpのhosted URL", `http://${ref}.supabase.co`, ref],
    ["supabase.co以外のホスト", `https://${ref}.example.com`, ref],
    ["ローカルなのにrefがlocalでない", "http://127.0.0.1:54321", ref],
  ])("%sは拒否する", (_label, url, projectRef) => {
    expect(checkSupabaseTarget(url, projectRef)).not.toBeNull();
  });

  it("ローカルSupabaseは --project-ref local で許可する", () => {
    expect(checkSupabaseTarget("http://127.0.0.1:54321", "local")).toBeNull();
  });
});

describe("checkKnownProject", () => {
  it("ローカルとhosted Developmentは許可する", () => {
    expect(checkKnownProject("local", undefined)).toBeNull();
    expect(checkKnownProject(DEVELOPMENT_PROJECT_REF, undefined)).toBeNull();
  });

  it("それ以外のprojectは --production-ref に同じrefを書いたときだけ許可する", () => {
    const other = "zzzzzzzzzzzzzzzzzzzz";
    expect(checkKnownProject(other, undefined)).not.toBeNull();
    expect(checkKnownProject(other, DEVELOPMENT_PROJECT_REF)).not.toBeNull();
    expect(checkKnownProject(other, other)).toBeNull();
  });
});

describe("checkAdminKey", () => {
  const jwt = (payload: object) =>
    ["e30", Buffer.from(JSON.stringify(payload)).toString("base64url"), "sig"].join(".");

  it("secret keyとservice role JWTを許可する", () => {
    expect(checkAdminKey("sb_secret_xxx")).toBeNull();
    expect(checkAdminKey(jwt({ role: "service_role" }))).toBeNull();
  });

  it("空・publishable key・anon JWTは拒否する", () => {
    expect(checkAdminKey("")).not.toBeNull();
    expect(checkAdminKey("sb_publishable_xxx")).not.toBeNull();
    expect(checkAdminKey(jwt({ role: "anon" }))).not.toBeNull();
  });
});
