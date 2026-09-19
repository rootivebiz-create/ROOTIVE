import { NextResponse, type NextRequest } from "next/server";
import { createAdminClient, hasServiceRoleKey } from "@/lib/supabase/admin";
import { multicastLineMessage } from "@/lib/integrations/line";
import { alertMessage } from "@/lib/integrations/messages";
import { logIntegration } from "@/lib/integrations/logs";
import { currentMonthJST, monthToDate } from "@/lib/month";

/**
 * 毎朝の自動チェック（Vercel の Cron から呼ばれる）。
 * 1. 会社ごとに RPC detect_anomalies_core で当月の異常を洗い出す（書類の期限・点呼漏れ・税務の期限など 20 種類）
 * 2. 重大（high）の未対応が新しく出ていれば、LINE 連携しているスタッフに知らせる
 *
 * CRON_SECRET が設定されているときだけ動く（Bearer で検証）。
 * サービスロールで動くため、detect_anomalies ではなく会社を指定できる detect_anomalies_core を使う。
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
  const month = monthToDate(currentMonthJST());
  const appUrl = (process.env.NEXT_PUBLIC_APP_URL ?? "").replace(/\/$/, "");

  const { data: companies, error } = await admin.from("companies").select("id, name").order("created_at");
  if (error) {
    return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  }

  const results: { company: string; detected: number; open: number; notified: number; error?: string }[] = [];
  for (const company of companies ?? []) {
    try {
      const { data, error: rpcError } = await admin.rpc("detect_anomalies_core", { p_company_id: company.id, p_month: month });
      if (rpcError) throw new Error(rpcError.message);
      const summary = (data ?? {}) as unknown as { detected?: number; open?: number };
      const notified = await notifyHighAlerts(company.id, company.name, appUrl);
      results.push({ company: company.id, detected: summary.detected ?? 0, open: summary.open ?? 0, notified });
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      results.push({ company: company.id, detected: 0, open: 0, notified: 0, error: message });
      await logIntegration(company.id, "line", "cron_detect", "error", `毎朝の自動チェックに失敗しました: ${message}`);
    }
  }

  return NextResponse.json({ ok: true, at: new Date().toISOString(), month, results });
}

/** 今日 新しく出た重大な未対応アラートを、LINE 連携しているスタッフに知らせる（1 社あたり最大 3 件） */
async function notifyHighAlerts(companyId: string, companyName: string, appUrl: string): Promise<number> {
  const admin = createAdminClient();
  const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  const { data: alerts } = await admin
    .from("alerts")
    .select("id, title, detail, href, severity, status, detected_at")
    .eq("company_id", companyId)
    .eq("status", "open")
    .eq("severity", "high")
    .gte("detected_at", since)
    .order("detected_at", { ascending: false })
    .limit(3);
  if (!alerts || alerts.length === 0) return 0;

  const { data: staff } = await admin
    .from("profiles")
    .select("line_user_id, is_active")
    .eq("company_id", companyId)
    .eq("is_active", true);
  const to = (staff ?? []).map((s) => (s.line_user_id ?? "").trim()).filter((v) => v.length > 0);
  if (to.length === 0) return 0;

  let sent = 0;
  for (const alert of alerts) {
    const text = alertMessage({
      companyName,
      title: alert.title,
      detail: alert.detail,
      url: appUrl && alert.href ? `${appUrl}${alert.href}` : null,
    });
    try {
      const result = await multicastLineMessage(companyId, to, text);
      sent += result.sent;
      await logIntegration(companyId, "line", "cron_alert", "ok", `重大なお知らせを ${result.sent} 人に送りました`, { alert_id: alert.id });
    } catch (e) {
      await logIntegration(companyId, "line", "cron_alert", "error", e instanceof Error ? e.message : String(e), { alert_id: alert.id });
    }
  }
  return sent;
}

export const dynamic = "force-dynamic";
