import { createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";

/** 推測できないランダムな値（セッション・招待リンクに使う） */
export function randomToken(bytes = 32): string {
  return randomBytes(bytes).toString("base64url");
}

/** 保存用のハッシュ（生の値は DB に置かない） */
export function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function secret(): string {
  const s = process.env.APP_SECRET?.trim();
  if (s && s.length >= 32) return s;
  if (process.env.NODE_ENV === "production" && process.env.DEMO_MODE !== "1") {
    throw new Error("APP_SECRET（32 文字以上）が設定されていません");
  }
  return "dev-only-secret-dev-only-secret-dev-only";
}

/**
 * 用途ごとの鍵：APP_SECRET から、その用途のためだけに作る（DB にも、操作の記録にも、全データの書き出しにも入らない）。
 * 用途が違えば鍵も違うので、ある用途の値から別の用途の値を作れない。
 * APP_SECRET を変えると、前に作った値とは比べられなくなる（口座の目印・IP の目印。README の環境変数の表を参照）
 */
export function derivedKey(purpose: string): Buffer {
  return createHmac("sha256", secret()).update(`shimebi-lab:${purpose}`).digest();
}

/**
 * 鍵つきハッシュ（HMAC-SHA256・16 進）。鍵なしの sha256 では、取りうる値が少ないもの（IP アドレス・口座番号の残りの桁）を
 * 総当たりで割り出せてしまうため、そうした値の目印はこれで作る
 */
export function keyedHash(purpose: string, value: string): string {
  return createHmac("sha256", derivedKey(purpose)).update(value).digest("hex");
}

/**
 * 接続元（IP）の目印：記録に残すのは IP そのものでも鍵なしのハッシュでもなく、鍵つきハッシュ（32 文字）。
 * IPv4 は 2^32 通りしかないので、鍵なしのハッシュは総当たりで元の IP に戻せてしまうため
 */
export function ipFingerprint(ip: string): string {
  return keyedHash("client-ip:v1", ip).slice(0, 32);
}

/**
 * 画面・CSV に出す接続元の目印（8 文字）。記録してある値に、もう一度鍵をかけて短くする。
 * 同じ接続元なら同じ目印になるが、目印から IP は割り出せない（前の作り方の、鍵なしで残した記録も同じ）
 */
export function ipMarker(storedIpHash: string): string {
  return keyedHash("ip-marker:v1", storedIpHash).slice(0, 8);
}

/** 署名つきリンクの用途（用途が違えば、同じ中身でも署名が通らない） */
export type LinkPurpose = "statement" | "terms";

/**
 * 署名つきリンク：中身は ID・リンク用の値（nonce）・期限（UNIX 秒）。
 * nonce を変えると、発行済みのリンクがすべて無効になる（作り直し）。
 */
export function signLink(purpose: LinkPurpose, id: string, nonce: string, expiresAt: number): string {
  const payload = `${id}.${nonce}.${expiresAt}`;
  const mac = createHmac("sha256", secret()).update(`${purpose}:${payload}`).digest("base64url");
  return `${Buffer.from(payload).toString("base64url")}.${mac}`;
}

export type SignedLinkCheck = { ok: true; id: string; nonce: string; expiresAt: number } | { ok: false; reason: "format" | "signature" | "expired" };

export function verifyLink(purpose: LinkPurpose, token: string, now = Math.floor(Date.now() / 1000)): SignedLinkCheck {
  const [p, mac] = token.split(".");
  if (!p || !mac) return { ok: false, reason: "format" };
  let payload: string;
  try {
    payload = Buffer.from(p, "base64url").toString("utf8");
  } catch {
    return { ok: false, reason: "format" };
  }
  const parts = payload.split(".");
  if (parts.length !== 3) return { ok: false, reason: "format" };
  const [id, nonce, exp] = parts;
  const expected = createHmac("sha256", secret()).update(`${purpose}:${payload}`).digest();
  let given: Buffer;
  try {
    given = Buffer.from(mac, "base64url");
  } catch {
    return { ok: false, reason: "format" };
  }
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) return { ok: false, reason: "signature" };
  const expiresAt = Number(exp);
  if (!Number.isFinite(expiresAt) || expiresAt < now) return { ok: false, reason: "expired" };
  return { ok: true, id, nonce, expiresAt };
}

/** ドライバーの明細リンクの署名（signLink の明細用） */
export function signStatementLink(statementId: string, nonce: string, expiresAt: number): string {
  return signLink("statement", statementId, nonce, expiresAt);
}

export type LinkCheck =
  | { ok: true; statementId: string; nonce: string; expiresAt: number }
  | { ok: false; reason: "format" | "signature" | "expired" };

export function verifyStatementLink(token: string, now = Math.floor(Date.now() / 1000)): LinkCheck {
  const r = verifyLink("statement", token, now);
  return r.ok ? { ok: true, statementId: r.id, nonce: r.nonce, expiresAt: r.expiresAt } : r;
}
