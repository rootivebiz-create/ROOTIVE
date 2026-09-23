import { NextResponse, type NextRequest } from "next/server";
import { isManagementAlert } from "@/lib/alerts/helpers";
import { createAdminClient, hasServiceRoleKey } from "@/lib/supabase/admin";
import { multicastLineMessage } from "@/lib/integrations/line";
import { alertMessage } from "@/lib/integrations/messages";
import { logIntegration } from "@/lib/integrations/logs";
import { loadMonthPl } from "@/lib/db/queries";
import { loadExecutiveSummary } from "@/lib/executive/queries";
import { calcCockpit } from "@/lib/executive/cockpit";
import { calcRunway } from "@/lib/executive/runway";
import { explainVariance, sortVarianceByImpact } from "@/lib/executive/variance";
import { executiveBrief, BRIEF_EMPTY_TEXT } from "@/lib/executive/brief";
import { forecastMonth } from "@/lib/calc";
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

  const results: { company: string; detected: number; open: number; notified: number; briefed?: number; error?: string }[] = [];
  for (const company of companies ?? []) {
    try {
      const { data, error: rpcError } = await admin.rpc("detect_anomalies_core", { p_company_id: company.id, p_month: month });
      if (rpcError) throw new Error(rpcError.message);
      const summary = (data ?? {}) as unknown as { detected?: number; open?: number };
      const notified = await notifyHighAlerts(company.id, company.name, appUrl);
      // 代表だけに「朝のひとこと」を送る（決裁・現金・着地。AI は使わず数字だけで作る）
      const briefed = await notifyOwnerBrief(company.id, company.name, appUrl);
      results.push({ company: company.id, detected: summary.detected ?? 0, open: summary.open ?? 0, notified, briefed });
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
    .select("id, code, title, detail, href, severity, status, detected_at")
    .eq("company_id", companyId)
    .eq("status", "open")
    .eq("severity", "high")
    .gte("detected_at", since)
    .order("detected_at", { ascending: false })
    .limit(3);
  if (!alerts || alerts.length === 0) return 0;

  const { data: staff } = await admin
    .from("profiles")
    .select("line_user_id, is_active, role")
    .eq("company_id", companyId)
    .eq("is_active", true)
    .neq("role", "driver");
  const linked = (staff ?? []).filter((s) => (s.line_user_id ?? "").trim().length > 0);
  if (linked.length === 0) return 0;
  // 経営のアラート（利益の急減・資金不足・税務など）は事務員（0027）には送らない。画面の RLS と同じ線
  const idsFor = (management: boolean) =>
    linked.filter((s) => !(management && s.role === "clerk")).map((s) => (s.line_user_id ?? "").trim());

  let sent = 0;
  for (const alert of alerts) {
    const text = alertMessage({
      companyName,
      title: alert.title,
      detail: alert.detail,
      url: appUrl && alert.href ? `${appUrl}${alert.href}` : null,
    });
    const to = idsFor(isManagementAlert(alert.code));
    if (to.length === 0) continue;
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

/** 資金繰りを何日先まで見るか（代表ホームと同じ） */
const CASH_DAYS = 120;

function addDays(date: string, days: number): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/** 日本時間の今日 "YYYY-MM-DD" */
function todayJst(now: Date): string {
  return new Date(now.getTime() + 9 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

/**
 * 代表の LINE に「朝のひとこと」を送る（代表 1 人だけ。決裁・現金は代表の領域なので広げない）。
 * 書くことが無い日は送らない。
 *
 * サービスロールで動くので、RLS 頼りの cash_forecast ではなく
 * 会社を明示する cash_forecast_for を使う（0017 と同じ理由）。
 */
async function notifyOwnerBrief(companyId: string, companyName: string, appUrl: string): Promise<number> {
  const admin = createAdminClient();
  const { data: owners } = await admin
    .from("profiles")
    .select("line_user_id, is_active, role")
    .eq("company_id", companyId)
    .eq("role", "owner")
    .eq("is_active", true);
  const to = (owners ?? []).map((o) => (o.line_user_id ?? "").trim()).filter((v) => v.length > 0);
  if (to.length === 0) return 0;

  const now = new Date();
  const today = todayJst(now);
  const month = currentMonthJST(now);

  const [summary, pl, cashRes] = await Promise.all([
    loadExecutiveSummary(admin, companyId).catch(() => null),
    loadMonthPl(admin, companyId, month).catch(() => null),
    admin.rpc("cash_forecast_for", { p_company_id: companyId, p_from: today, p_to: addDays(today, CASH_DAYS) }),
  ]);
  const { data: snapshots } = await admin
    .from("cash_snapshots")
    .select("balance")
    .eq("company_id", companyId)
    .order("as_of", { ascending: false })
    .limit(1);

  const runway = cashRes.error
    ? null
    : calcRunway({
        from: today,
        to: addDays(today, CASH_DAYS),
        openingBalance: Number(snapshots?.[0]?.balance ?? 0),
        events: cashRes.data ?? [],
      });

  const cockpit = calcCockpit({ summary, pl, runway });
  const forecast = pl
    ? forecastMonth({
        month,
        now,
        isClosed: pl.status === "closed",
        actual: {
          bill: Number(pl.bill ?? 0),
          payout: Number(pl.payout ?? 0),
          profit: Number(pl.profit ?? 0),
          mgmtFee: Number(pl.mgmt_fee ?? 0),
          expenseTotal: Number(pl.expense_total ?? 0),
          expenseFixed: Number(pl.expense_fixed ?? 0),
          expenseVariable: Number(pl.expense_variable ?? 0),
          operatingProfit: Number(pl.operating_profit ?? 0),
          entryCount: Number(pl.entry_count ?? 0),
          billTarget: Number(pl.bill_target ?? 0),
          profitTarget: Number(pl.profit_target ?? 0),
        },
      })
    : null;
  const variance = pl
    ? sortVarianceByImpact(
        explainVariance(
          { bill: Number(pl.bill_target ?? 0), operatingProfit: Number(pl.profit_target ?? 0) },
          {
            bill: Number(pl.bill ?? 0),
            margin: Number(pl.margin ?? 0),
            profit: Number(pl.profit ?? 0),
            expenseTotal: Number(pl.expense_total ?? 0),
            operatingProfit: Number(pl.operating_profit ?? 0),
            activeDriverCount: Number(pl.active_driver_count ?? 0),
          },
        ),
      )
    : [];

  const brief = executiveBrief({
    date: today,
    cockpit,
    runway,
    forecast: forecast
      ? {
          month,
          billForecast: forecast.billForecast,
          operatingProfitForecast: forecast.operatingProfitForecast,
          profitTargetRate: forecast.profitTargetRate,
        }
      : null,
    variance,
    width: 0,
  });
  // 書くことが無い日は送らない（毎朝「特にありません」が届くと見なくなる）
  if (brief.trim() === BRIEF_EMPTY_TEXT) return 0;

  const link = appUrl ? `\n${appUrl}/executive` : "";
  const text = `【${companyName}】代表へのお知らせ\n${brief}${link}`;
  try {
    const result = await multicastLineMessage(companyId, to, text);
    await logIntegration(companyId, "line", "cron_brief", "ok", `代表へ朝のひとことを送りました（${result.sent} 件）`);
    return result.sent;
  } catch (e) {
    await logIntegration(companyId, "line", "cron_brief", "error", e instanceof Error ? e.message : String(e));
    return 0;
  }
}

export const dynamic = "force-dynamic";
