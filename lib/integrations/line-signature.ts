/**
 * LINE Webhook の署名検証（純関数。node:crypto のみに依存するのでテストできる）
 * 署名は「チャネルシークレットを鍵にした本文の HMAC-SHA256」を base64 にしたもの。
 */
import { createHmac, timingSafeEqual } from "node:crypto";

/** 生のボディ文字列から署名を作る */
export function lineSignature(body: string, channelSecret: string): string {
  return createHmac("sha256", channelSecret).update(body, "utf8").digest("base64");
}

/** x-line-signature ヘッダを検証する（タイミング安全比較。長さが違えば false） */
export function verifyLineSignature(body: string, signature: string | null | undefined, channelSecret: string | null | undefined): boolean {
  const sig = (signature ?? "").trim();
  const secret = (channelSecret ?? "").trim();
  if (!sig || !secret) return false;
  const expected = Buffer.from(lineSignature(body, secret), "utf8");
  const actual = Buffer.from(sig, "utf8");
  if (expected.length !== actual.length) return false;
  return timingSafeEqual(expected, actual);
}
