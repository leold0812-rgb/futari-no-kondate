import "server-only";
import { MAX_IMAGE_BYTES } from "@/lib/services/recipe-images";
import { safeFetch } from "./safe-fetch";
import { checkImportUrl } from "./url-safety";

/**
 * 取り込み元ページの写真を取得する（利用者が「利用条件で許可されている」と確認した場合だけ呼ぶ）。
 * ページ本体と同じSSRF対策で取得し、JPEG・PNG・WebPの5MBまでに限る。失敗はnull（レシピの保存は続ける）。
 */
export async function fetchRemoteImage(url: string): Promise<File | null> {
  const checked = checkImportUrl(url);
  if (!checked.ok) return null;
  try {
    const result = await safeFetch(checked.url.toString(), {
      accept: ["image/jpeg", "image/png", "image/webp"],
      maxBytes: MAX_IMAGE_BYTES,
      timeoutMs: 10_000,
    });
    const type = result.contentType.split(";")[0].trim();
    return new File([new Uint8Array(result.body)], "source-photo", { type });
  } catch {
    return null;
  }
}
