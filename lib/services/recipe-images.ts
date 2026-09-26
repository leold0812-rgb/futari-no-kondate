import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { randomUUID } from "node:crypto";
import { RECIPE_IMAGE_BUCKET } from "./recipes";

const ALLOWED_TYPES: Record<string, string> = { "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp" };
export const MAX_IMAGE_BYTES = 5 * 1024 * 1024;

export class RecipeImageError extends Error {}

/** 画像ファイルの検証（申告された種類・大きさ）。問題があれば日本語の理由を返す */
export function validateImageFile(file: File): string | null {
  if (!ALLOWED_TYPES[file.type]) return "写真はJPEG・PNG・WebPのいずれかを選んでください。";
  if (file.size === 0) return "写真のファイルが空です。別の写真を選んでください。";
  if (file.size > MAX_IMAGE_BYTES) return "写真が大きすぎます（5MBまで）。";
  return null;
}

/** ファイル先頭の署名（マジックナンバー）から実際の画像形式を判定する。対応外ならnull */
export function sniffImageType(bytes: Uint8Array): string | null {
  const startsWith = (signature: number[], offset = 0) => signature.every((b, i) => bytes[offset + i] === b);
  if (startsWith([0xff, 0xd8, 0xff])) return "image/jpeg";
  if (startsWith([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return "image/png";
  if (startsWith([0x52, 0x49, 0x46, 0x46]) && startsWith([0x57, 0x45, 0x42, 0x50], 8)) return "image/webp";
  return null;
}

/** 申告された種類と実データの形式が一致するか（Server Actionへ直接送られた偽装ファイルを拒否する） */
export async function verifyImageContent(file: Blob & { type: string }): Promise<string | null> {
  const head = new Uint8Array(await file.slice(0, 16).arrayBuffer());
  const actual = sniffImageType(head);
  if (!actual || actual !== file.type) return "写真として読み込めないファイルです。別の写真を選んでください。";
  return null;
}

/**
 * 利用者のsession（RLS）で <space>/<recipe>/<ランダム名> へ保存し、保存先のパスを返す。
 * パスの先頭は必ず自分のspace IDにする（storage.objectsのpolicyで別spaceへの保存は拒否される）。
 */
export async function uploadRecipeImage(
  supabase: SupabaseClient,
  coupleSpaceId: string,
  recipeId: string,
  file: File,
): Promise<string> {
  const problem = validateImageFile(file) ?? (await verifyImageContent(file));
  if (problem) throw new RecipeImageError(problem);
  const path = `${coupleSpaceId}/${recipeId}/${randomUUID()}.${ALLOWED_TYPES[file.type]}`;
  const { error } = await supabase.storage
    .from(RECIPE_IMAGE_BUCKET)
    .upload(path, file, { contentType: file.type, upsert: false, cacheControl: "3600" });
  if (error) throw new RecipeImageError("写真を保存できませんでした。");
  return path;
}

/** 使わなくなった画像を消す（失敗してもレシピの保存は成功扱い。孤立ファイルはバックアップ時に確認できる） */
export async function removeRecipeImage(supabase: SupabaseClient, path: string | null): Promise<void> {
  if (!path) return;
  await supabase.storage.from(RECIPE_IMAGE_BUCKET).remove([path]);
}
