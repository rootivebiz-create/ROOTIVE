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
