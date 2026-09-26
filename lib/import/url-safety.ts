/**
 * URL取り込みのSSRF対策（Gate 3、AGENTS.md）。副作用のない判定だけを置く。
 *
 * - http / https、既定ポート（80 / 443）のみ。認証情報付きURLは拒否
 * - 宛先IPが localhost・プライベート・リンクローカル（クラウドのメタデータ 169.254.169.254 を含む）・CGNAT・
 *   マルチキャスト・予約済み・文書用アドレスなら拒否（IPv6のIPv4埋め込み形式も展開して判定）
 * - 実際の接続時にも、DNSで解決した全アドレスをこの判定にかける（safe-fetch.ts）。リダイレクト先も同じ
 */
import { BlockList, isIP } from "node:net";

const blockList = new BlockList();
const IPV4_BLOCKED: [string, number][] = [
  ["0.0.0.0", 8],
  ["10.0.0.0", 8],
  ["100.64.0.0", 10],
  ["127.0.0.0", 8],
  ["169.254.0.0", 16],
  ["172.16.0.0", 12],
  ["192.0.0.0", 24],
  ["192.0.2.0", 24],
  ["192.88.99.0", 24],
  ["192.168.0.0", 16],
  ["198.18.0.0", 15],
  ["198.51.100.0", 24],
  ["203.0.113.0", 24],
  ["224.0.0.0", 4],
  ["240.0.0.0", 4],
];
for (const [address, prefix] of IPV4_BLOCKED) blockList.addSubnet(address, prefix, "ipv4");

const IPV6_BLOCKED: [string, number][] = [
  ["::", 128],
  ["::1", 128],
  ["fc00::", 7],
  ["fe80::", 10],
  ["fec0::", 10],
  ["ff00::", 8],
  ["2001:db8::", 32],
  ["2001::", 32],
  ["2002::", 16],
  ["100::", 64],
];
for (const [address, prefix] of IPV6_BLOCKED) blockList.addSubnet(address, prefix, "ipv6");

/** IPv4射影・NAT64・IPv4互換のIPv6から、埋め込まれたIPv4を取り出す */
function embeddedIPv4(address: string): string | null {
  const lower = address.toLowerCase();
  const dotted = /^(?:::ffff:|::ffff:0:|64:ff9b::|::)(\d{1,3}(?:\.\d{1,3}){3})$/.exec(lower);
  if (dotted) return dotted[1];
  const hex = /^(?:::ffff:|64:ff9b::|::)([0-9a-f]{1,4}):([0-9a-f]{1,4})$/.exec(lower);
  if (hex) {
    const high = parseInt(hex[1], 16);
    const low = parseInt(hex[2], 16);
    return [high >> 8, high & 255, low >> 8, low & 255].join(".");
  }
  return null;
}

/** 取り込みで接続してはいけないアドレスか */
export function isBlockedAddress(address: string): boolean {
  const plain = address.replace(/^\[|\]$/g, "").split("%")[0];
  const family = isIP(plain);
  if (family === 4) return blockList.check(plain, "ipv4");
  if (family === 6) {
    const v4 = embeddedIPv4(plain);
    if (v4) return blockList.check(v4, "ipv4");
    return blockList.check(plain, "ipv6");
  }
  return true;
}

export type UrlCheck = { ok: true; url: URL } | { ok: false; reason: string };

const BLOCKED_HOST_SUFFIXES = [".localhost", ".local", ".internal", ".home.arpa", ".lan"];

/** 入力されたURL（またはリダイレクト先）の形式を検査する。DNS解決後のIP検査は接続時に行う */
export function checkImportUrl(input: string | URL): UrlCheck {
  let url: URL;
  try {
    url = typeof input === "string" ? new URL(input.trim()) : input;
  } catch {
    return { ok: false, reason: "URLの形式が正しくありません。" };
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") {
    return { ok: false, reason: "http または https のURLだけ取り込めます。" };
  }
  if (url.username || url.password) return { ok: false, reason: "ユーザー名やパスワードを含むURLは取り込めません。" };
  if (url.port && url.port !== (url.protocol === "https:" ? "443" : "80")) {
    return { ok: false, reason: "特別なポート番号を含むURLは取り込めません。" };
  }
  const host = url.hostname.toLowerCase().replace(/\.$/, "");
  if (!host || host === "localhost" || BLOCKED_HOST_SUFFIXES.some((suffix) => host.endsWith(suffix))) {
    return { ok: false, reason: "このURLは取り込めません（端末内・社内向けのアドレス）。" };
  }
  const literal = host.replace(/^\[|\]$/g, "");
  if (isIP(literal) && isBlockedAddress(literal)) {
    return { ok: false, reason: "このURLは取り込めません（端末内・社内向けのアドレス）。" };
  }
  if (!isIP(literal) && !host.includes(".")) {
    return { ok: false, reason: "このURLは取り込めません（ドメイン名が不完全です）。" };
  }
  return { ok: true, url };
}
