import "server-only";
import { lookup as dnsLookup, type LookupAddress } from "node:dns";
import { request as httpRequest, type IncomingMessage } from "node:http";
import { request as httpsRequest } from "node:https";
import type { LookupFunction } from "node:net";
import { createBrotliDecompress, createGunzip, createInflate } from "node:zlib";
import { checkImportUrl, isBlockedAddress } from "./url-safety";

/**
 * SSRF対策付きの取得（Gate 3）。
 *   - 接続のたびにDNSの全解決結果を検査し、1つでも内部向けアドレスがあれば接続しない（DNS rebindingを含む）
 *   - リダイレクトは自分で追い、行き先ごとに形式とIPを再検査する（最大3回）
 *   - 全体の時間・受信サイズ（展開後）・Content-Typeを制限する
 * 取得した本文はログに出さない。
 */

export class SafeFetchError extends Error {
  constructor(
    message: string,
    readonly kind: "blocked" | "timeout" | "too_large" | "http_status" | "content_type" | "network",
  ) {
    super(message);
  }
}

export type SafeFetchOptions = {
  /** 受け付けるContent-Type（前方一致） */
  accept: readonly string[];
  maxBytes: number;
  timeoutMs: number;
  maxRedirects?: number;
};

export type SafeFetchResult = {
  finalUrl: string;
  contentType: string;
  body: Buffer;
};

const USER_AGENT =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1 FutariNoKondate/1.0";

/** DNSの解決結果をすべて検査するlookup。http(s).requestへ渡す */
const guardedLookup: LookupFunction = (hostname, options, callback) => {
  dnsLookup(hostname, { all: true, verbatim: true }, (error, addresses: LookupAddress[]) => {
    if (error) return callback(error, "", 4);
    if (addresses.length === 0 || addresses.some((a) => isBlockedAddress(a.address))) {
      return callback(new SafeFetchError("接続先が内部向けのアドレスでした。", "blocked"), "", 4);
    }
    if ((options as { all?: boolean }).all) {
      return (callback as unknown as (e: null, a: LookupAddress[]) => void)(null, addresses);
    }
    const [first] = addresses;
    callback(null, first.address, first.family);
  });
};

function requestOnce(url: URL, signal: AbortSignal): Promise<IncomingMessage> {
  const send = url.protocol === "https:" ? httpsRequest : httpRequest;
  return new Promise((resolve, reject) => {
    const req = send(
      url,
      {
        method: "GET",
        lookup: guardedLookup,
        signal,
        headers: {
          "User-Agent": USER_AGENT,
          Accept: "text/html,application/xhtml+xml,image/avif,image/webp,image/jpeg,image/png;q=0.9,*/*;q=0.1",
          "Accept-Language": "ja,en;q=0.5",
          "Accept-Encoding": "gzip, deflate, br",
        },
      },
      resolve,
    );
    req.on("error", reject);
    req.end();
  });
}

function decodeStream(response: IncomingMessage) {
  const encoding = String(response.headers["content-encoding"] ?? "").toLowerCase();
  if (encoding === "gzip" || encoding === "x-gzip") return response.pipe(createGunzip());
  if (encoding === "deflate") return response.pipe(createInflate());
  if (encoding === "br") return response.pipe(createBrotliDecompress());
  return response;
}

async function readLimited(response: IncomingMessage, maxBytes: number): Promise<Buffer> {
  const declared = Number(response.headers["content-length"] ?? 0);
  if (declared > maxBytes * 4) throw new SafeFetchError("ページが大きすぎます。", "too_large");
  const chunks: Buffer[] = [];
  let total = 0;
  for await (const chunk of decodeStream(response)) {
    total += (chunk as Buffer).length;
    if (total > maxBytes) {
      response.destroy();
      throw new SafeFetchError("ページが大きすぎます。", "too_large");
    }
    chunks.push(chunk as Buffer);
  }
  return Buffer.concat(chunks);
}

export async function safeFetch(input: string, options: SafeFetchOptions): Promise<SafeFetchResult> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), options.timeoutMs);
  try {
    let current = checkImportUrl(input);
    for (let redirects = 0; ; redirects += 1) {
      if (!current.ok) throw new SafeFetchError(current.reason, "blocked");
      let response: IncomingMessage;
      try {
        response = await requestOnce(current.url, controller.signal);
      } catch (error) {
        if (error instanceof SafeFetchError) throw error;
        if (controller.signal.aborted) throw new SafeFetchError("ページの応答が遅すぎます。", "timeout");
        throw new SafeFetchError("ページに接続できませんでした。", "network");
      }

      const status = response.statusCode ?? 0;
      if (status >= 300 && status < 400 && response.headers.location) {
        response.resume();
        if (redirects >= (options.maxRedirects ?? 3)) throw new SafeFetchError("転送が多すぎます。", "blocked");
        current = checkImportUrl(new URL(response.headers.location, current.url));
        continue;
      }
      if (status < 200 || status >= 300) {
        response.resume();
        throw new SafeFetchError(`ページを取得できませんでした（HTTP ${status}）。`, "http_status");
      }

      const contentType = String(response.headers["content-type"] ?? "").toLowerCase();
      if (!options.accept.some((type) => contentType.startsWith(type))) {
        response.resume();
        throw new SafeFetchError("取り込めない種類のページです。", "content_type");
      }
      const body = await readLimited(response, options.maxBytes);
      return { finalUrl: current.url.toString(), contentType, body };
    }
  } catch (error) {
    if (error instanceof SafeFetchError) throw error;
    if (controller.signal.aborted) throw new SafeFetchError("ページの応答が遅すぎます。", "timeout");
    throw new SafeFetchError("ページを取得できませんでした。", "network");
  } finally {
    clearTimeout(timer);
  }
}

/** Content-Typeや<meta charset>から文字コードを判定してHTMLを文字列にする（Shift_JIS・EUC-JPのサイトに対応） */
export function decodeHtml(body: Buffer, contentType: string): string {
  const fromHeader = /charset=["']?([\w-]+)/i.exec(contentType)?.[1];
  const head = body.subarray(0, 2048).toString("latin1");
  const fromMeta = /<meta[^>]+charset=["']?([\w-]+)/i.exec(head)?.[1];
  const charset = (fromHeader ?? fromMeta ?? "utf-8").toLowerCase();
  try {
    return new TextDecoder(charset).decode(body);
  } catch {
    return new TextDecoder("utf-8").decode(body);
  }
}
