import { NextResponse, type NextRequest } from "next/server";
import { createAdminClient, hasServiceRoleKey } from "@/lib/supabase/admin";

/**
 * Supabase 無料プランの自動一時停止（7 日間無操作）を防ぐための定期アクセス。
 * Vercel の Cron（vercel.json の crons）から毎日呼ばれる。CRON_SECRET が設定されていれば Bearer で検証する。
 */
export async function GET(request: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (secret) {
    const auth = request.headers.get("authorization") ?? "";
    if (auth !== `Bearer ${secret}`) {
      return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
    }
  }
  if (!hasServiceRoleKey()) {
    return NextResponse.json({ ok: false, error: "SUPABASE_SERVICE_ROLE_KEY が未設定" }, { status: 500 });
  }
  const admin = createAdminClient();
  const { error, count } = await admin.from("companies").select("id", { count: "exact", head: true });
  if (error) {
    return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  }
  return NextResponse.json({ ok: true, companies: count ?? 0, at: new Date().toISOString() });
}

export const dynamic = "force-dynamic";
