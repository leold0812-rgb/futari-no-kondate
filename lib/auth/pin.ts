/**
 * PINの形式検証・ハッシュ化・照合（Gate 1.4、ADR 0001）。
 *
 * - ハッシュ: scrypt(HMAC-SHA256(pepper, PIN), salt)。pepperはサーバーの環境変数 PIN_PEPPER だけにあり、
 *   DBのハッシュだけが漏れても6桁程度のPINを総当たりできないようにする。
 * - 管理スクリプト（scripts/auth/set-pin.mts）からも使うため、Node標準API以外に依存せず server-only も付けない。
 *   秘密値はすべて引数で受け取り、このモジュールは環境変数を読まない。
 */
import { createHmac, randomBytes, scrypt as scryptCallback, timingSafeEqual, type ScryptOptions } from "node:crypto";

export const PIN_MIN_LENGTH = 6;
export const PIN_MAX_LENGTH = 12;
export const PIN_PEPPER_MIN_LENGTH = 32;

const HASH_VERSION = "1";
const SCRYPT_PARAMS = { N: 2 ** 15, r: 8, p: 1 } as const;
const KEY_LENGTH = 32;
const SALT_BYTES = 16;
// N=2^15, r=8 は約32MiBを使う。既定の上限（32MiB）ちょうどでは失敗するため余裕を持たせる
const SCRYPT_MAXMEM = 64 * 1024 * 1024;

function scrypt(password: Buffer, salt: Buffer, keylen: number, options: ScryptOptions): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scryptCallback(password, salt, keylen, options, (error, derived) => (error ? reject(error) : resolve(derived)));
  });
}

/** ログイン時の入力形式（数字のみ・6〜12桁）。弱いPINかどうかは設定時にだけ判定する */
export function isPinFormat(pin: string): boolean {
  return new RegExp(`^[0-9]{${PIN_MIN_LENGTH},${PIN_MAX_LENGTH}}$`).test(pin);
}

/** PIN設定時の検証。同じ数字だけのPINは拒否する（連番は利用者の指示で許可。判断ログ73） */
export function validateNewPin(pin: string): string | null {
  if (!isPinFormat(pin)) return `PINは${PIN_MIN_LENGTH}〜${PIN_MAX_LENGTH}桁の数字にしてください。`;
  if (/^(\d)\1+$/.test(pin)) return "同じ数字だけのPINは使えません。";
  return null;
}

export function validatePepper(pepper: string): string | null {
  return pepper.length >= PIN_PEPPER_MIN_LENGTH ? null : `PIN_PEPPER は${PIN_PEPPER_MIN_LENGTH}文字以上のランダムな値にしてください。`;
}

function pepperedPin(pin: string, pepper: string): Buffer {
  return createHmac("sha256", pepper).update(`pin:${pin}`).digest();
}

export async function hashPin(pin: string, pepper: string): Promise<string> {
  const salt = randomBytes(SALT_BYTES);
  const derived = await scrypt(pepperedPin(pin, pepper), salt, KEY_LENGTH, { ...SCRYPT_PARAMS, maxmem: SCRYPT_MAXMEM });
  const { N, r, p } = SCRYPT_PARAMS;
  return ["scrypt", HASH_VERSION, N, r, p, salt.toString("base64"), derived.toString("base64")].join("$");
}

type ParsedHash = { N: number; r: number; p: number; salt: Buffer; hash: Buffer };

function parseHash(stored: string): ParsedHash | null {
  const parts = stored.split("$");
  if (parts.length !== 7 || parts[0] !== "scrypt" || parts[1] !== HASH_VERSION) return null;
  const [N, r, p] = parts.slice(2, 5).map(Number);
  if (![N, r, p].every((n) => Number.isInteger(n) && n > 0)) return null;
  // 保存値のパラメータで計算量が決まるため、過大な値（DoS）を受け付けない
  if (N > 2 ** 17 || r > 16 || p > 4) return null;
  const salt = Buffer.from(parts[5], "base64");
  const hash = Buffer.from(parts[6], "base64");
  if (salt.length === 0 || hash.length !== KEY_LENGTH) return null;
  return { N, r, p, salt, hash };
}

/**
 * 照合。保存値が無い・壊れている場合も同じ計算量のダミー照合を行い、失敗までの時間で状態を推測されにくくする。
 */
export async function verifyPin(pin: string, pepper: string, stored: string | null): Promise<boolean> {
  const parsed = stored ? parseHash(stored) : null;
  const params = parsed ?? { ...SCRYPT_PARAMS, salt: Buffer.alloc(SALT_BYTES), hash: Buffer.alloc(KEY_LENGTH) };
  const derived = await scrypt(pepperedPin(pin, pepper), params.salt, KEY_LENGTH, {
    N: params.N,
    r: params.r,
    p: params.p,
    maxmem: SCRYPT_MAXMEM,
  });
  return parsed !== null && timingSafeEqual(derived, parsed.hash);
}

/** 送信元の識別子。生のIPアドレスは保存せず、pepper付きHMACだけをDBの試行制限に使う */
export function deriveSourceKey(clientAddress: string, pepper: string): string {
  return createHmac("sha256", pepper).update(`source:${clientAddress}`).digest("hex");
}
