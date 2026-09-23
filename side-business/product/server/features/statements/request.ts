import "server-only";
import { headers } from "next/headers";
import type { Db } from "~/db/client";
import { clientIpHash, currentUser } from "~/server/auth";
import { findStatementByToken, type PortalContext } from "~/server/features/portal";

/**
 * 要求（リクエスト）から読むもの：リンクの頭の部分・IP のハッシュ・端末・会社の人のログイン中か。
 * 画面・Server Action・ダウンロードから使う（テストでは使わない。機能の関数には値を渡す）。
 */

/** ドライバーに送るリンクの頭（https://…）。プロキシの後ろでも正しく作る */
export async function requestOrigin(): Promise<string> {
  const h = await headers();
  const host = h.get("x-forwarded-host")?.split(",")[0]?.trim() || h.get("host") || "localhost:3300";
  const local = /^(localhost|127\.|\[::1\])/.test(host);
  const proto = h.get("x-forwarded-proto")?.split(",")[0]?.trim() || (local ? "http" : "https");
  return `${proto}://${host}`;
}

/**
 * 会社の人が、自分の会社の明細のリンクをログインしたまま開いているか。
 * そのときは「開いた」「確認しました」「質問」を本人の操作として記録しない（デモは除く）。
 */
export async function isStaffPreview(db: Db, token: string): Promise<boolean> {
  if (process.env.DEMO_MODE === "1") return false;
  const user = await currentUser();
  if (!user) return false;
  const st = await findStatementByToken(db, token);
  return !!st && st.tenantId === user.tenantId;
}

export async function portalRequestContext(db: Db, token: string): Promise<PortalContext> {
  const h = await headers();
  return {
    ipHash: await clientIpHash(),
    userAgent: h.get("user-agent"),
    byStaff: await isStaffPreview(db, token),
  };
}

/** ドライバー向けのダウンロードに付ける見出し（検索に出さない・リファラーを送らない・残さない） */
export function portalHeaders(res: Response): Response {
  res.headers.set("X-Robots-Tag", "noindex, nofollow");
  res.headers.set("Referrer-Policy", "no-referrer");
  res.headers.set("Cache-Control", "private, no-store");
  return res;
}
