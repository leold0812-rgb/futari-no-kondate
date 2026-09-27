"use server";

import { revalidatePath } from "next/cache";
import { requireMember } from "@/lib/auth/session";
import { addDays, tokyoDate } from "@/lib/dates";
import { parseWeightKg } from "@/lib/records/summary";
import { createSupabaseServerClient } from "@/lib/supabase/server";

type State = { error?: string; ok?: string };

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

/** 暦に実在する日付か（2026-02-31 のような繰り上がりを受け付けない） */
function isCalendarDate(value: string): boolean {
  if (!DATE_PATTERN.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

/** 自分の体重を記録する（同じ日は上書き）。値はログや応答の本文以外へ出さない */
export async function saveWeightAction(_previous: State, formData: FormData): Promise<State> {
  const member = await requireMember();
  const measuredOn = String(formData.get("measuredOn") ?? "");
  const weightKg = parseWeightKg(String(formData.get("weightKg") ?? ""));
  const today = tokyoDate();
  if (!isCalendarDate(measuredOn)) return { error: "日付を選んでください。" };
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
  if (!isCalendarDate(measuredOn)) return;
  await (await createSupabaseServerClient())
    .from("weight_records")
    .delete()
    .eq("user_id", member.userId)
    .eq("measured_on", measuredOn);
  revalidatePath("/records");
}
