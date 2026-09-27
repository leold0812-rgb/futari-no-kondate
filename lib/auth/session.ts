import "server-only";
import { redirect } from "next/navigation";
import { cache } from "react";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export type CurrentMember = {
  userId: string;
  coupleSpaceId: string;
  displayName: string;
};

/**
 * ログイン中の利用者と所属space。1リクエスト内ではcacheで1回だけ問い合わせる。
 * profileが無い（2人のどちらでもない）Authユーザーは未ログインとして扱う。
 */
export const getCurrentMember = cache(async (): Promise<CurrentMember | null> => {
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.auth.getClaims();
  const userId = data?.claims?.sub;
  if (error || typeof userId !== "string") return null;

  const { data: profile } = await supabase
    .from("profiles")
    .select("id, couple_space_id, display_name")
    .eq("id", userId)
    .maybeSingle();
  if (!profile) return null;

  return {
    userId,
    coupleSpaceId: profile.couple_space_id as string,
    displayName: profile.display_name as string,
  };
});

/** 画面・Server Actionの入口で使う。未ログインならログイン画面へ送る */
export async function requireMember(): Promise<CurrentMember> {
  const member = await getCurrentMember();
  if (!member) redirect("/login");
  return member;
}
