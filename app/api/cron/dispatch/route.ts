import { NextResponse, type NextRequest } from "next/server";
import { createAdminClient, hasServiceRoleKey } from "@/lib/supabase/admin";
import { notifyTomorrowDispatch } from "@/lib/push/notify-dispatch";

/**
 * 前日の夕方に「明日の配車」を各ドライバーへ知らせる（Vercel の Cron）。
 *
 * 確定した配車だけを送り、一度知らせたものは印（notified_at）が付くので二度送らない。
 * CRON_SECRET が設定されているときだけ動く（Bearer で検証）。
 */
export async function GET(request: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (!secret) {
    return NextResponse.json({ ok: false, error: "CRON_SECRET が未設定のため無効です" }, { status: 503 });
  }
  if ((request.headers.get("authorization") ?? "") !== `Bearer ${secret}`) {
    return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }
  if (!hasServiceRoleKey()) {
    return NextResponse.json({ ok: false, error: "SUPABASE_SERVICE_ROLE_KEY が未設定" }, { status: 500 });
  }

  // 日本時間の「明日」
  const jstNow = new Date(Date.now() + 9 * 60 * 60 * 1000);
  jstNow.setUTCDate(jstNow.getUTCDate() + 1);
  const tomorrow = jstNow.toISOString().slice(0, 10);

  const admin = createAdminClient();
  const { data: companies, error } = await admin.from("companies").select("id, name").order("created_at");
  if (error) {
    return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  }

  const results: { company: string; drivers: number; push: number; line: number; error?: string }[] = [];
  for (const company of companies ?? []) {
    try {
      const r = await notifyTomorrowDispatch(company.id, tomorrow);
      results.push({ company: company.id, drivers: r.drivers, push: r.push, line: r.line });
    } catch (e) {
      results.push({ company: company.id, drivers: 0, push: 0, line: 0, error: e instanceof Error ? e.message : String(e) });
    }
  }

  return NextResponse.json({ ok: true, at: new Date().toISOString(), date: tomorrow, results });
}
