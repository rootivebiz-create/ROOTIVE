import { randomBytes, scrypt as scryptCb, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";

const scrypt = promisify(scryptCb) as (pw: string, salt: Buffer, keylen: number, opts: object) => Promise<Buffer>;

/**
 * scrypt の強さ。OWASP の Password Storage Cheat Sheet の組み合わせのうち N=2^14・r=8・p=5 を使う
 * （使うメモリは N=2^14 のまま約 16MiB で、手間を 5 倍にする。サーバーレスで同時にログインが来てもメモリが増えない）。
 * 強さを上げたら、前の強さのハッシュはログインが通ったときに作り直す（needsRehash）
 */
export const PASSWORD_PARAMS = { N: 16384, r: 8, p: 5 } as const;
const MAXMEM = 64 * 1024 * 1024;
/** 保存されたハッシュの強さの上限（これより重いものは計算しない。メモリと時間を使い切らせない） */
const MAX_WORK = 2 ** 14 * 8 * 16;

/** パスワードの長さの上限（passwordProblem と同じ。ログインでもこれより長いものは計算しない） */
export const MAX_PASSWORD_LENGTH = 200;

/** パスワードは scrypt で。形式：scrypt$N$r$p$salt$hash（base64url） */
export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const { N, r, p } = PASSWORD_PARAMS;
  const hash = await scrypt(password.normalize("NFKC"), salt, 32, { N, r, p, maxmem: MAXMEM });
  return ["scrypt", N, r, p, salt.toString("base64url"), hash.toString("base64url")].join("$");
}

/**
 * 利用者がいない・パスワードがまだ無いときに、同じだけ時間をかけるための形だけのハッシュ（どのパスワードとも合わない）。
 * いまの強さから作るので、強さを変えても時間の差が出ない
 */
export const DUMMY_PASSWORD_HASH = ["scrypt", PASSWORD_PARAMS.N, PASSWORD_PARAMS.r, PASSWORD_PARAMS.p, "A".repeat(22), "A".repeat(43)].join("$");

function parse(stored: string): { N: number; r: number; p: number; salt: Buffer; hash: Buffer } | null {
  const [algo, n, r, p, saltB64, hashB64] = stored.split("$");
  if (algo !== "scrypt" || !saltB64 || !hashB64) return null;
  const N = Number(n);
  const R = Number(r);
  const P = Number(p);
  if (![N, R, P].every((v) => Number.isInteger(v) && v > 0)) return null;
  // 使うメモリ（約 128 × N × r バイト）と手間（N × r × p）に上限を置く
  if (128 * N * R > MAXMEM / 2 || N * R * P > MAX_WORK) return null;
  return { N, r: R, p: P, salt: Buffer.from(saltB64, "base64url"), hash: Buffer.from(hashB64, "base64url") };
}

export async function verifyPassword(password: string, stored: string | null | undefined): Promise<boolean> {
  if (!stored) return false;
  const parsed = parse(stored);
  if (!parsed) return false;
  try {
    const actual = await scrypt(password.normalize("NFKC"), parsed.salt, parsed.hash.length, {
      N: parsed.N,
      r: parsed.r,
      p: parsed.p,
      maxmem: MAXMEM,
    });
    return actual.length === parsed.hash.length && timingSafeEqual(actual, parsed.hash);
  } catch {
    // 形の崩れた値（N が 2 のべき乗でない など）は、合わないものとして扱う
    return false;
  }
}

/** 保存されたハッシュが、いまの強さより弱い（ログインが通ったときに作り直す） */
export function needsRehash(stored: string | null | undefined): boolean {
  if (!stored) return false;
  const parsed = parse(stored);
  if (!parsed) return false;
  const { N, r, p } = PASSWORD_PARAMS;
  return parsed.N * parsed.r * parsed.p < N * r * p;
}

/** パスワードの最低限の決まり（長さだけ。覚えやすい長い文を勧める） */
export function passwordProblem(password: string): string | null {
  if (password.length < 10) return "パスワードは 10 文字以上にしてください（覚えやすい長めの文がおすすめです）";
  if (password.length > MAX_PASSWORD_LENGTH) return "パスワードが長すぎます";
  return null;
}
