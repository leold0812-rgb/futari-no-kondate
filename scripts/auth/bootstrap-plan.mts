/**
 * 固定2人のbootstrapで「今の状態から何をすべきか」を決める純粋関数（DB・ネットワークに触れない）。
 *
 * 方針：
 *   - 何度実行しても同じ最終状態（2人のAuthユーザー＋同じspaceに2件のprofile）へ収束させる。
 *   - 想定外の状態（設定にないAuthユーザー、別々のspaceへの所属など）では何も変更せずに止まる。
 *   - Authユーザーはパスワード無しで作る（PINをAuthへ保存しない。ADR 0001）。
 */

export type MemberConfig = { email: string; displayName: string };

export type AuthUserState = { id: string; email: string | null };
export type ProfileState = { id: string; coupleSpaceId: string; displayName: string };
export type BootstrapState = {
  authUsers: readonly AuthUserState[];
  profiles: readonly ProfileState[];
  spaceIds: readonly string[];
};

/** member は設定の添字（0 / 1） */
export type BootstrapAction =
  | { kind: "createAuthUser"; member: number; email: string }
  | { kind: "createSpace" }
  | { kind: "insertProfile"; member: number; displayName: string }
  | { kind: "updateDisplayName"; member: number; profileId: string; from: string; to: string };

/** profileを追加する先。既存spaceを使うか、新しく作るか */
export type TargetSpace = { kind: "existing"; id: string } | { kind: "new" };

export type BootstrapPlan =
  | {
      status: "noop" | "changes";
      actions: BootstrapAction[];
      targetSpace: TargetSpace | null;
      warnings: string[];
    }
  | { status: "blocked"; reason: string };

export const DISPLAY_NAME_MAX_LENGTH = 30;
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

/** DBの制約（btrim後1〜30文字、同一space内で重複不可）と同じ条件で設定を検証する */
export function validateMembers(members: readonly MemberConfig[]): string | null {
  if (members.length !== 2) return "メンバーはちょうど2人を指定してください。";

  for (const [index, member] of members.entries()) {
    const label = `メンバー${index + 1}`;
    if (!EMAIL_PATTERN.test(member.email.trim())) {
      return `${label}の管理用メールアドレスの形式が正しくありません。`;
    }
    const length = [...member.displayName.trim()].length;
    if (length < 1 || length > DISPLAY_NAME_MAX_LENGTH) {
      return `${label}の表示名は1〜${DISPLAY_NAME_MAX_LENGTH}文字で指定してください。`;
    }
  }
  if (normalizeEmail(members[0].email) === normalizeEmail(members[1].email)) {
    return "2人の管理用メールアドレスが同じです。別々のアドレスを指定してください。";
  }
  if (members[0].displayName.trim() === members[1].displayName.trim()) {
    return "2人の表示名が同じです。ログイン画面で区別できる名前にしてください。";
  }
  return null;
}

export function planBootstrap(members: readonly MemberConfig[], state: BootstrapState): BootstrapPlan {
  const invalid = validateMembers(members);
  if (invalid) return { status: "blocked", reason: invalid };

  const configuredEmails = members.map((m) => normalizeEmail(m.email));
  const unexpectedUsers = state.authUsers.filter(
    (user) => !configuredEmails.includes(normalizeEmail(user.email ?? "")),
  );
  if (unexpectedUsers.length > 0) {
    return {
      status: "blocked",
      reason: `設定にないAuthユーザーが${unexpectedUsers.length}人います。2人専用のため、対象projectと設定を確認してください（このスクリプトは既存ユーザーを削除しません）。`,
    };
  }

  const userByEmail = new Map(state.authUsers.map((user) => [normalizeEmail(user.email ?? ""), user]));
  const profileById = new Map(state.profiles.map((profile) => [profile.id, profile]));
  const memberUsers = configuredEmails.map((email) => userByEmail.get(email) ?? null);
  const memberProfiles = memberUsers.map((user) => (user ? (profileById.get(user.id) ?? null) : null));

  const joinedSpaceIds = new Set(
    memberProfiles.filter((p): p is ProfileState => p !== null).map((p) => p.coupleSpaceId),
  );
  if (joinedSpaceIds.size > 1) {
    return {
      status: "blocked",
      reason: "2人が別々のspaceに所属しています。自動では移動しないため、状態を確認してください。",
    };
  }

  const warnings: string[] = [];
  let targetSpace: TargetSpace | null;
  if (joinedSpaceIds.size === 1) {
    const [spaceId] = joinedSpaceIds;
    targetSpace = { kind: "existing", id: spaceId };
    const otherSpaces = state.spaceIds.filter((id) => id !== spaceId);
    if (otherSpaces.length > 0) {
      warnings.push(`メンバーのいないspaceが${otherSpaces.length}件あります（変更しません）。`);
    }
  } else if (state.spaceIds.length === 0) {
    targetSpace = { kind: "new" };
  } else if (state.spaceIds.length === 1) {
    // 前回の実行がspace作成後に中断した場合の残り。メンバーがいないことは上の判定で確定している
    targetSpace = { kind: "existing", id: state.spaceIds[0] };
    warnings.push("メンバーのいない既存spaceを使います（前回の実行の途中状態とみなします）。");
  } else {
    return {
      status: "blocked",
      reason: `メンバーのいないspaceが${state.spaceIds.length}件あり、どれを使うか決められません。不要なspaceを確認してください。`,
    };
  }

  const actions: BootstrapAction[] = [];
  members.forEach((member, index) => {
    if (!memberUsers[index]) {
      actions.push({ kind: "createAuthUser", member: index, email: normalizeEmail(member.email) });
    }
  });
  if (targetSpace.kind === "new") actions.push({ kind: "createSpace" });
  members.forEach((member, index) => {
    const profile = memberProfiles[index];
    const displayName = member.displayName.trim();
    if (!profile) {
      actions.push({ kind: "insertProfile", member: index, displayName });
    } else if (profile.displayName.trim() !== displayName) {
      actions.push({
        kind: "updateDisplayName",
        member: index,
        profileId: profile.id,
        from: profile.displayName,
        to: displayName,
      });
    }
  });

  if (actions.length === 0) {
    return { status: "noop", actions, targetSpace, warnings };
  }
  return { status: "changes", actions, targetSpace, warnings };
}

export function describeAction(action: BootstrapAction): string {
  switch (action.kind) {
    case "createAuthUser":
      return `メンバー${action.member + 1}：Authユーザーを作成（パスワード無し・メール確認済み、${action.email}）`;
    case "createSpace":
      return "CoupleSpaceを1件作成";
    case "insertProfile":
      return `メンバー${action.member + 1}：profileを作成（表示名「${action.displayName}」）`;
    case "updateDisplayName":
      return `メンバー${action.member + 1}：表示名を「${action.from}」から「${action.to}」へ変更`;
  }
}
