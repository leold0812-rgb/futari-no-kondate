/**
 * bootstrapの入出力（Supabase Admin API / PostgRESTへの読み書き）。判断は bootstrap-plan.mts が行う。
 * CLI（bootstrap-couple.mts）と統合テストから使う。secret keyの値はログへ出さない。
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  describeAction,
  planBootstrap,
  type BootstrapPlan,
  type BootstrapState,
  type MemberConfig,
} from "./bootstrap-plan.mts";

const LIST_USERS_PAGE_SIZE = 1000;

export async function readBootstrapState(admin: SupabaseClient): Promise<BootstrapState> {
  const authUsers: BootstrapState["authUsers"][number][] = [];
  for (let page = 1; ; page += 1) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage: LIST_USERS_PAGE_SIZE });
    if (error) throw new Error(`Authユーザー一覧を取得できませんでした: ${error.message}`);
    authUsers.push(...data.users.map((user) => ({ id: user.id, email: user.email ?? null })));
    if (data.users.length < LIST_USERS_PAGE_SIZE) break;
  }

  const { data: profiles, error: profileError } = await admin
    .from("profiles")
    .select("id, couple_space_id, display_name");
  if (profileError) throw new Error(`profilesを取得できませんでした: ${profileError.message}`);

  const { data: spaces, error: spaceError } = await admin.from("couple_spaces").select("id");
  if (spaceError) throw new Error(`couple_spacesを取得できませんでした: ${spaceError.message}`);

  return {
    authUsers,
    profiles: profiles.map((row) => ({
      id: row.id as string,
      coupleSpaceId: row.couple_space_id as string,
      displayName: row.display_name as string,
    })),
    spaceIds: spaces.map((row) => row.id as string),
  };
}

type ApplyContext = {
  admin: SupabaseClient;
  members: readonly MemberConfig[];
  state: BootstrapState;
  plan: Exclude<BootstrapPlan, { status: "blocked" }>;
  log: (message: string) => void;
};

async function applyPlan({ admin, members, state, plan, log }: ApplyContext): Promise<void> {
  const userIdByMember = members.map(
    (member) =>
      state.authUsers.find((user) => (user.email ?? "").toLowerCase() === member.email.trim().toLowerCase())?.id ??
      null,
  );

  for (const action of plan.actions) {
    if (action.kind !== "createAuthUser") continue;
    // パスワードは渡さない。email_confirm: true で「確認済み」にし、確認メールを送らない
    const { data, error } = await admin.auth.admin.createUser({ email: action.email, email_confirm: true });
    if (error || !data.user) {
      throw new Error(`メンバー${action.member + 1}のAuthユーザーを作成できませんでした: ${error?.message ?? "不明なエラー"}`);
    }
    userIdByMember[action.member] = data.user.id;
    log(`完了: ${describeAction(action)}`);
  }

  let spaceId = plan.targetSpace?.kind === "existing" ? plan.targetSpace.id : null;
  let createdSpaceId: string | null = null;
  if (plan.actions.some((action) => action.kind === "createSpace")) {
    const { data, error } = await admin.from("couple_spaces").insert({}).select("id").single();
    if (error || !data) throw new Error(`CoupleSpaceを作成できませんでした: ${error?.message ?? "不明なエラー"}`);
    createdSpaceId = data.id as string;
    spaceId = createdSpaceId;
    log("完了: CoupleSpaceを1件作成");
  }

  const profileRows = plan.actions
    .filter((action) => action.kind === "insertProfile")
    .map((action) => {
      const userId = userIdByMember[action.member];
      if (!userId || !spaceId) throw new Error("profileの作成に必要なIDがそろっていません。");
      return { id: userId, couple_space_id: spaceId, display_name: action.displayName };
    });
  if (profileRows.length > 0) {
    // 2件を1つのINSERT文で登録する（途中で1件だけ入る状態を作らない）
    const { error } = await admin.from("profiles").insert(profileRows);
    if (error) {
      if (createdSpaceId) {
        // 今回作った空のspaceは片付ける。失敗しても次回の実行で「メンバーのいない既存space」として再利用される
        await admin.from("couple_spaces").delete().eq("id", createdSpaceId);
      }
      throw new Error(`profileを作成できませんでした: ${error.message}`);
    }
    log(`完了: profileを${profileRows.length}件作成`);
  }

  for (const action of plan.actions) {
    if (action.kind !== "updateDisplayName") continue;
    const { error } = await admin.from("profiles").update({ display_name: action.to }).eq("id", action.profileId);
    if (error) throw new Error(`メンバー${action.member + 1}の表示名を変更できませんでした: ${error.message}`);
    log(`完了: ${describeAction(action)}`);
  }
}

export type BootstrapResult =
  | { outcome: "blocked"; reason: string }
  | { outcome: "noop"; plan: BootstrapPlan }
  | { outcome: "dry-run"; plan: BootstrapPlan }
  | { outcome: "applied"; plan: BootstrapPlan };

/**
 * 現状を読み、計画を表示し、`apply` のときだけ書き込む。書き込み後は状態を読み直し、
 * もう一度計画すると「変更なし」になることまで確かめる（冪等性の確認）。
 */
export async function runBootstrap(options: {
  admin: SupabaseClient;
  members: readonly MemberConfig[];
  apply: boolean;
  log?: (message: string) => void;
}): Promise<BootstrapResult> {
  const log = options.log ?? (() => {});
  const state = await readBootstrapState(options.admin);
  const plan = planBootstrap(options.members, state);

  if (plan.status === "blocked") {
    log(`中止: ${plan.reason}`);
    return { outcome: "blocked", reason: plan.reason };
  }
  for (const warning of plan.warnings) log(`注意: ${warning}`);
  if (plan.status === "noop") {
    log("変更なし: 2人のAuthユーザーと同じspaceのprofileがそろっています。");
    return { outcome: "noop", plan };
  }

  log("予定している操作:");
  for (const action of plan.actions) log(`  - ${describeAction(action)}`);
  if (!options.apply) {
    log("dry-runのため変更していません。実行するには --apply を付けてください。");
    return { outcome: "dry-run", plan };
  }

  await applyPlan({ admin: options.admin, members: options.members, state, plan, log });

  const after = planBootstrap(options.members, await readBootstrapState(options.admin));
  if (after.status !== "noop") {
    throw new Error("実行後の確認で、まだ変更が必要な状態が残っています。もう一度dry-runで状態を確認してください。");
  }
  log("確認: 再計画の結果は「変更なし」です。");
  return { outcome: "applied", plan };
}
