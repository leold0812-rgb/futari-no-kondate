"use server";

import { revalidatePath } from "next/cache";
import { requireMember } from "@/lib/auth/session";
import { addDays, tokyoDate } from "@/lib/dates";
import { parseWeightKg } from "@/lib/records/summary";
import { createSupabaseServerClient } from "@/lib/supabase/server";

type State = { error?: string; ok?: string };

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

/** 自分の体重を記録する（同じ日は上書き）。値はログや応答の本文以外へ出さない */
export async function saveWeightAction(_previous: State, formData: FormData): Promise<State> {
  const member = await requireMember();
  const measuredOn = String(formData.get("measuredOn") ?? "");
  const weightKg = parseWeightKg(String(formData.get("weightKg") ?? ""));
  const today = tokyoDate();
  if (!DATE_PATTERN.test(measuredOn) || Number.isNaN(Date.parse(`${measuredOn}T00:00:00Z`))) return { error: "日付を選んでください。" };
  if (measuredOn > today) return { error: "未来の日付には記録できません。" };
  if (measuredOn < addDays(today, -366)) return { error: "1年以内の日付を選んでください。" };
  if (weightKg === null) return { error: "体重は20〜300kgの範囲で、小数は1桁まで入力してください。" };
  const { error } = await (await createSupabaseServerClient())
    .from("weight_records")
    .upsert({ user_id: member.userId, measured_on: measuredOn, weight_kg: weightKg }, { onConflict: "user_id,measured_on" });
  if (error) return { error: "記録できませんでした。通信状態を確かめて、もう一度お試しください。" };
  revalidatePath("/records");
  return { ok: "記録しました。" };
}

/** 自分の体重の記録を1件消す（入力の間違いを直すため） */
export async function deleteWeightAction(measuredOn: string): Promise<void> {
  const member = await requireMember();
  if (!DATE_PATTERN.test(measuredOn)) return;
  await (await createSupabaseServerClient())
    .from("weight_records")
    .delete()
    .eq("user_id", member.userId)
    .eq("measured_on", measuredOn);
  revalidatePath("/records");
}
