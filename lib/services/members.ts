import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { CurrentMember } from "@/lib/auth/session";

export type Member = { userId: string; displayName: string };

/** 同じspaceのもう1人（RLSで同じspaceのprofileだけが見える） */
export async function getPartner(supabase: SupabaseClient, me: CurrentMember): Promise<Member | null> {
  const { data } = await supabase.from("profiles").select("id, display_name").neq("id", me.userId).limit(1).maybeSingle();
  return data ? { userId: data.id as string, displayName: data.display_name as string } : null;
}
