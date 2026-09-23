/**
 * 購入の証明（ライセンス）。
 *
 * サーバーが秘密鍵で署名し、アプリは公開鍵だけで確かめる（ECDSA P-256 / SHA-256）。
 * 確かめるのにサーバーへの通信は要らないので、電波の無い場所でも有料機能が使える。
 * 形式は `KL1.<ペイロード>.<署名>`（どちらも base64url）。
 *
 * サーバー（Node 20+）とブラウザの両方にある WebCrypto だけを使う。
 */

export const LICENSE_PREFIX = "KL1";

export type LicensePayload = {
  /** 形式の版 */
  v: 1;
  /** 購入した商品（いまは pro のみ） */
  p: "pro";
  /** Stripe の Checkout Session ID（同じ購入を識別する） */
  s: string;
  /** 発行日時（UNIX 秒） */
  t: number;
  /** 購入者のメールを伏せたもの（本人が見分けるためだけに使う） */
  m?: string;
};

const ALGO = { name: "ECDSA", namedCurve: "P-256" } as const;
const SIGN = { name: "ECDSA", hash: "SHA-256" } as const;

function subtle(): SubtleCrypto {
  const c = globalThis.crypto;
  if (!c?.subtle) throw new Error("この環境では暗号機能が使えません");
  return c.subtle;
}

export function toBase64Url(bytes: Uint8Array): string {
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export function fromBase64Url(text: string): Uint8Array {
  const b64 = text.replace(/-/g, "+").replace(/_/g, "/");
  const padded = b64 + "=".repeat((4 - (b64.length % 4)) % 4);
  const bin = atob(padded);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

function fromBase64(text: string): Uint8Array {
  return fromBase64Url(text.trim().replace(/\s+/g, ""));
}

/** メールを伏せる：taro@example.com → t***@example.com */
export function maskEmail(email: string | null | undefined): string | undefined {
  if (!email) return undefined;
  const at = email.indexOf("@");
  if (at < 1) return undefined;
  return `${email[0]}***${email.slice(at)}`;
}

export async function importPrivateKey(pkcs8Base64: string): Promise<CryptoKey> {
  return subtle().importKey("pkcs8", fromBase64(pkcs8Base64) as BufferSource, ALGO, false, ["sign"]);
}

export async function importPublicKey(spkiBase64: string): Promise<CryptoKey> {
  return subtle().importKey("spki", fromBase64(spkiBase64) as BufferSource, ALGO, false, ["verify"]);
}

export async function signLicense(payload: LicensePayload, privateKey: CryptoKey): Promise<string> {
  const body = toBase64Url(new TextEncoder().encode(JSON.stringify(payload)));
  const data = new TextEncoder().encode(`${LICENSE_PREFIX}.${body}`);
  const sig = new Uint8Array(await subtle().sign(SIGN, privateKey, data));
  return `${LICENSE_PREFIX}.${body}.${toBase64Url(sig)}`;
}

export type VerifyResult = { ok: true; payload: LicensePayload } | { ok: false; reason: string };

/** 貼り付けられた文字列から前後の空白・改行を除いて確かめる */
export async function verifyLicense(token: string, publicKey: CryptoKey): Promise<VerifyResult> {
  const clean = token.trim().replace(/\s+/g, "");
  const parts = clean.split(".");
  if (parts.length !== 3 || parts[0] !== LICENSE_PREFIX) return { ok: false, reason: "形式が違います" };
  let payload: LicensePayload;
  try {
    payload = JSON.parse(new TextDecoder().decode(fromBase64Url(parts[1])));
  } catch {
    return { ok: false, reason: "形式が違います" };
  }
  if (payload?.v !== 1 || payload.p !== "pro" || typeof payload.s !== "string" || typeof payload.t !== "number") {
    return { ok: false, reason: "形式が違います" };
  }
  let valid = false;
  try {
    const data = new TextEncoder().encode(`${parts[0]}.${parts[1]}`);
    valid = await subtle().verify(SIGN, publicKey, fromBase64Url(parts[2]) as BufferSource, data);
  } catch {
    valid = false;
  }
  return valid ? { ok: true, payload } : { ok: false, reason: "署名が正しくありません" };
}

/** 鍵の組を作る（scripts/gen-license-keys.mjs とテストで使う） */
export async function generateKeyPair(): Promise<{ privateKey: string; publicKey: string }> {
  const pair = (await subtle().generateKey(ALGO, true, ["sign", "verify"])) as CryptoKeyPair;
  const pkcs8 = new Uint8Array(await subtle().exportKey("pkcs8", pair.privateKey));
  const spki = new Uint8Array(await subtle().exportKey("spki", pair.publicKey));
  const b64 = (u: Uint8Array) => btoa(String.fromCharCode(...u));
  return { privateKey: b64(pkcs8), publicKey: b64(spki) };
}
