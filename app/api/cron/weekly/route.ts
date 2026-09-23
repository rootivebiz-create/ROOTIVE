import { NextResponse, type NextRequest } from "next/server";
import { createAdminClient, hasServiceRoleKey } from "@/lib/supabase/admin";
import { MANAGEMENT_VIEW_ROLES } from "@/lib/auth/session";
import { multicastLineMessage } from "@/lib/integrations/line";
import { logIntegration } from "@/lib/integrations/logs";
import { buildWeeklySummary, saveWeeklyInsight } from "@/lib/ai/weekly";
import { weekLinkPath, weekRange, weeklyLineText } from "@/lib/weekly";

/**
 * 毎週月曜の朝の経営サマリー（Vercel の Cron から呼ばれる。日曜 23:00 UTC ＝ 月曜 8:00 JST）。
 * 1. 会社ごとに先週（前の月曜〜前の日曜）の数字を集計し、ai_insights（kind='weekly'）へ保存する
 * 2. LINE 連携しているスタッフへ本文を送る（アプリを開かなくても経営が分かるように）
 *
 * CRON_SECRET が設定されているときだけ動く（Bearer で検証）。app/api/cron/daily/route.ts と同じ作法。
 * ANTHROPIC_API_KEY が無いときは AI を呼ばず、数字だけのサマリーを作って送る。
 * 1 社が失敗しても他社は続ける。
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

  const admin = createAdminClient();
  const range = weekRange(new Date());
  const appUrl = (process.env.NEXT_PUBLIC_APP_URL ?? "").replace(/\/$/, "");

  const { data: companies, error } = await admin.from("companies").select("id, name").order("created_at");
  if (error) {
    return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  }

  const results: { company: string; saved: boolean; notified: number; model: string; ai: boolean; error?: string }[] = [];
  for (const company of companies ?? []) {
    try {
      const summary = await buildWeeklySummary(admin, company.id, range, { serviceRole: true });
      await saveWeeklyInsight(admin, company.id, summary, null);

      const text = weeklyLineText({
        companyName: company.name ?? summary.companyName,
        numbers: summary.numbers,
        summary: summary.summary,
        highlights: summary.highlights,
        url: appUrl ? `${appUrl}${weekLinkPath(range)}` : null,
      });
      const notified = await notifyStaff(company.id, text);
      await logIntegration(company.id, "line", "cron_weekly", "ok", `${range.label}の週次サマリーを ${notified} 人に送りました`, {
        from: range.from,
        to: range.to,
        model: summary.model,
        ai: summary.aiUsed,
      });
      results.push({ company: company.id, saved: true, notified, model: summary.model, ai: summary.aiUsed });
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      results.push({ company: company.id, saved: false, notified: 0, model: "", ai: false, error: message });
      await logIntegration(company.id, "line", "cron_weekly", "error", `週次サマリーの作成に失敗しました: ${message}`, { from: range.from, to: range.to });
    }
  }

  return NextResponse.json({ ok: true, at: new Date().toISOString(), week: { from: range.from, to: range.to, label: range.label }, results });
}

/**
 * LINE 連携しているスタッフ（有効な人だけ）へ送る。未連携・未設定なら 0 人。
 * 経営の数字なので、見てよい人（owner・admin・viewer）だけ。事務員（0027）とドライバーには送らない
 */
async function notifyStaff(companyId: string, text: string): Promise<number> {
  const admin = createAdminClient();
  const { data: staff } = await admin
    .from("profiles")
    .select("line_user_id, is_active, role")
    .eq("company_id", companyId)
    .eq("is_active", true)
    .in("role", MANAGEMENT_VIEW_ROLES);
  const to = (staff ?? []).map((s) => (s.line_user_id ?? "").trim()).filter((v) => v.length > 0);
  if (to.length === 0) return 0;
  const result = await multicastLineMessage(companyId, to, text);
  return result.sent;
}

export const dynamic = "force-dynamic";
/** AI の応答に数十秒かかることがある */
export const maxDuration = 60;
