import "server-only";
import { createAdminClient, hasServiceRoleKey } from "@/lib/supabase/admin";
import type { LoginEventKind } from "@/lib/db/types";

/**
 * ログインの記録（0019 の login_events）。
 *
 * - RPC `record_login_event` は security definer の **サービスロール専用**なので、
 *   ログイン中のセッションではなく `lib/supabase/admin.ts` のクライアントから呼ぶ。
 * - **記録に失敗してもログイン・ログアウトは絶対に止めない**（握りつぶして console.warn だけ残す）。
 * - IP は `x-forwarded-for` の先頭（プロキシが連ねる先頭が実際の接続元）、端末は `user-agent`。
 * - 古い記録は DB 側で 1 年経つと消える。アプリ側では消さない。
 */

/** ヘッダーを読める最小の形（NextRequest / Request のどちらでも渡せる） */
export interface HeaderSource {
  headers: { get(name: string): string | null };
}

/** x-forwarded-for の先頭（無ければ x-real-ip）。長すぎる値は DB 側でも切り詰められる */
export function clientIp(req: HeaderSource | null | undefined): string {
  if (!req) return "";
  const forwarded = req.headers.get("x-forwarded-for") ?? "";
  const first = forwarded.split(",")[0]?.trim() ?? "";
  if (first) return first.slice(0, 64);
  return (req.headers.get("x-real-ip") ?? "").trim().slice(0, 64);
}

/** 端末（User-Agent）。DB 側で 300 文字に切り詰められる */
export function clientUserAgent(req: HeaderSource | null | undefined): string {
  if (!req) return "";
  return (req.headers.get("user-agent") ?? "").trim().slice(0, 300);
}

/**
 * ログイン・ログアウト・招待の受諾を記録する。
 * 失敗しても例外は投げない（呼び出し側は await するだけでよい）。
 */
export async function recordLoginEvent(
  profileId: string | null | undefined,
  kind: LoginEventKind,
  req?: HeaderSource | null,
): Promise<void> {
  if (!profileId) return;
  if (!hasServiceRoleKey()) return; // サービスロールが無い環境（開発・テスト）では記録しない
  try {
    const admin = createAdminClient();
    const { error } = await admin.rpc("record_login_event", {
      p_profile_id: profileId,
      p_kind: kind,
      p_ip: clientIp(req),
      p_user_agent: clientUserAgent(req),
    });
    if (error) console.warn("[login-events] 記録に失敗しました:", error.message);
  } catch (e) {
    console.warn("[login-events] 記録に失敗しました:", e instanceof Error ? e.message : e);
  }
}
