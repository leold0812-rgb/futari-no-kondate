import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { Alert } from "@/components/ui/alert";
import { getCurrentMember } from "@/lib/auth/session";
import { safeNextPath } from "@/lib/auth/paths";
import { EnvConfigError } from "@/lib/env/errors";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { LoginForm, type LoginMember } from "./login-form";
import styles from "./login.module.css";

export const metadata: Metadata = { title: "ログイン | ふたりの献立" };

/** ログイン前に名前を選べるよう、表示名だけをサーバーで読む（anonにはprofilesの権限がない） */
async function loadMembers(): Promise<LoginMember[] | "not-configured"> {
  try {
    const admin = createSupabaseAdminClient();
    const { data, error } = await admin
      .from("profiles")
      .select("id, display_name, created_at")
      .order("created_at", { ascending: true })
      .limit(2);
    if (error) throw error;
    return data.map((row) => ({ id: row.id as string, displayName: row.display_name as string }));
  } catch (error) {
    if (error instanceof EnvConfigError) return "not-configured";
    throw error;
  }
}

export default async function LoginPage({ searchParams }: PageProps<"/login">) {
  if (await getCurrentMember()) redirect("/");
  const { next } = await searchParams;
  const members = await loadMembers();

  return (
    <>
      <header className={styles.header}>
        <p className={styles.appName}>ふたりの献立</p>
        <h1 className={styles.title}>ログイン</h1>
      </header>
      {members === "not-configured" ? (
        <Alert tone="error" title="ログインの設定が完了していません">
          <p>管理者がサーバーの環境変数（SUPABASE_SERVICE_ROLE_KEY）を設定すると、ここに2人の名前が表示されます。</p>
        </Alert>
      ) : members.length === 0 ? (
        <Alert tone="error" title="アカウントがまだ登録されていません">
          <p>管理者が初期登録（docs/runbooks/hosted-development-setup.md のD）を行うと、ここに2人の名前が表示されます。</p>
        </Alert>
      ) : (
        <LoginForm members={members} next={safeNextPath(next)} />
      )}
    </>
  );
}
