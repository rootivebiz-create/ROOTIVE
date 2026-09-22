/**
 * GET /api/nav-badges — いまの未読・未対応の件数を返す。
 *
 * ヘッダーのベルがこれを定期的に見て、画面を開き直さなくても数が増えるようにする。
 * 認可はいつもどおり `getSessionContext()` と RLS（RPC `nav_badges` は security invoker）が行う。
 */
import { NextResponse } from "next/server";
import { getSessionContext } from "@/lib/auth/session";
import { loadNavBadges } from "@/lib/db/queries";

export const dynamic = "force-dynamic";

const EMPTY = { alerts: 0, chat: 0, approvals: 0 };

export async function GET() {
  const ctx = await getSessionContext();
  if (!ctx) return NextResponse.json(EMPTY, { status: 401, headers: { "Cache-Control": "no-store" } });
  try {
    const badges = await loadNavBadges(ctx.supabase);
    return NextResponse.json(badges, { headers: { "Cache-Control": "no-store" } });
  } catch {
    return NextResponse.json(EMPTY, { headers: { "Cache-Control": "no-store" } });
  }
}
