import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/db/database.types";
import type { Company, Role } from "@/lib/db/types";
import { toConfidentialScope } from "@/lib/db/types";
import { effectiveAccess } from "@/lib/auth/access";
import { isManagementAlert } from "@/lib/alerts/helpers";
import { currentMonthJST, monthToDate } from "@/lib/month";
import { forecastMonth } from "@/lib/calc";
import { calcRunway } from "@/lib/executive/runway";
import { resolvePayoutDate } from "@/lib/statement";
import {
  alertsText,
  approvalsText,
  cashText,
  detectLineIntent,
  entriesText,
  helpText,
  notAllowedText,
  notLinkedText,
  payoutText,
  summaryText,
  type LineIntent,
} from "./ask";

type Admin = SupabaseClient<Database>;

/** 資金繰りを何日先まで見るか（代表ホームと同じ） */
const CASH_DAYS = 120;

function addDays(date: string, days: number): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

function todayJst(now: Date): string {
  return new Date(now.getTime() + 9 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

/**
 * LINE に届いた質問に、その会社の数字で答える。
 *
 * **サービスロールで動く**（Webhook にはログインセッションが無い）ため、RLS は効かない。
 * したがって
 *   - すべてのクエリを company_id で明示的に絞り、
 *   - ロールと companies.confidential_scope の判定をこのコードで行う。
 * ドライバーの LINE には会社の数字を返さない。
 */
export async function answerLineQuestion(input: {
  admin: Admin;
  companyId: string;
  lineUserId: string;
  text: string;
  now?: Date;
}): Promise<string | null> {
  const { admin, companyId, lineUserId, text } = input;
  const now = input.now ?? new Date();
  const intent = detectLineIntent(text);
  if (intent === "unknown") return null; // 判定できないものは今までどおり案内文にまかせる

  // 送ってきた人を特定する（連携済みのスタッフだけが会社の数字を見られる）
  const { data: profile } = await admin
    .from("profiles")
    .select("*")
    .eq("company_id", companyId)
    .eq("line_user_id", lineUserId)
    .eq("is_active", true)
    .maybeSingle();

  if (!profile) {
    // ドライバー本人として連携している場合
    const { data: driver } = await admin
      .from("drivers")
      .select("id, name")
      .eq("company_id", companyId)
      .eq("line_user_id", lineUserId)
      .maybeSingle();
    if (driver) return "このトークでは会社の数字はお答えできません。ご自身の明細はアプリの「支払明細」から見られます。";
    return notLinkedText();
  }

  const role = profile.role as Role;
  if (role === "driver") {
    return "このトークでは会社の数字はお答えできません。ご自身の明細はアプリの「支払明細」から見られます。";
  }

  const { data: company } = await admin.from("companies").select("*").eq("id", companyId).maybeSingle();
  if (!company) return null;

  const scope = toConfidentialScope((company as Company).confidential_scope);
  // 事務員（0027）と、代表が個別に外した人（0029）は経営の数字（着地・資金繰り・経営のアラート）を見ない。
  // サービスロールなので RLS が効かない。画面と同じ判定（effectiveAccess）をここで行う
  const access = effectiveAccess(role, profile.access_overrides, scope);
  const management = access.management;
  const canSeeCash = management && access.cash;
  const isOwner = role === "owner";

  switch (intent) {
    case "help":
      return helpText({ canSeeCash, isOwner, canSeeManagement: management });
    case "summary":
      if (!management) return notAllowedText("売上と営業利益の着地");
      return await summaryAnswer(admin, companyId, now);
    case "cash":
      if (!canSeeCash) return notAllowedText("資金繰り");
      return await cashAnswer(admin, companyId, now);
    case "approvals":
      if (!isOwner) return notAllowedText("決裁");
      return await approvalsAnswer(admin, companyId, now);
    case "alerts":
      return await alertsAnswer(admin, companyId, management);
    case "payout":
      return await payoutAnswer(admin, companyId, company as Company, now);
    case "entries":
      return await entriesAnswer(admin, companyId, now);
    default:
      return null;
  }
}

/** 今月の着地 */
async function summaryAnswer(admin: Admin, companyId: string, now: Date): Promise<string> {
  const month = currentMonthJST(now);
  const { data: pl } = await admin.from("v_month_pl").select("*").eq("company_id", companyId).eq("month", monthToDate(month)).maybeSingle();
  if (!pl) return summaryText({ month, bill: 0, operatingProfit: 0, billForecast: 0, operatingProfitForecast: 0, profitTarget: 0, profitTargetRate: null, isClosed: false, entryCount: 0 });
  const isClosed = pl.status === "closed";
  const f = forecastMonth({
    month,
    now,
    isClosed,
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
  });
  return summaryText({
    month,
    bill: Number(pl.bill ?? 0),
    operatingProfit: Number(pl.operating_profit ?? 0),
    billForecast: f.billForecast,
    operatingProfitForecast: f.operatingProfitForecast,
    profitTarget: Number(pl.profit_target ?? 0),
    profitTargetRate: f.profitTargetRate,
    isClosed,
    entryCount: Number(pl.entry_count ?? 0),
  });
}

/** 資金繰り */
async function cashAnswer(admin: Admin, companyId: string, now: Date): Promise<string> {
  const today = todayJst(now);
  const to = addDays(today, CASH_DAYS);
  // サービスロールから呼ぶので、会社を明示できる *_for を使う（0017 と同じ理由）
  const [{ data: events, error }, { data: snapshots }] = await Promise.all([
    admin.rpc("cash_forecast_for", { p_company_id: companyId, p_from: today, p_to: to }),
    admin.from("cash_snapshots").select("balance").eq("company_id", companyId).order("as_of", { ascending: false }).limit(1),
  ]);
  if (error) return "資金繰りの材料をうまく読めませんでした。アプリの「資金繰り」を見てください。";
  const opening = Number(snapshots?.[0]?.balance ?? 0);
  const r = calcRunway({ from: today, to, openingBalance: opening, events: events ?? [] });
  return cashText({
    balance: opening,
    minBalance: r.minBalance,
    minBalanceOn: r.minBalanceOn,
    zeroOn: r.zeroOn,
    holdDays: r.holdDays,
    shortfall: r.shortfall,
    status: r.status,
  });
}

/** 決裁待ち（代表のみ） */
async function approvalsAnswer(admin: Admin, companyId: string, now: Date): Promise<string> {
  const { data } = await admin
    .from("v_approval_list")
    .select("title, requested_at, is_overdue")
    .eq("company_id", companyId)
    .eq("status", "pending")
    .order("requested_at");
  const rows = data ?? [];
  const oldest = rows[0]?.requested_at ? Math.floor((now.getTime() - new Date(rows[0].requested_at).getTime()) / 86400000) : null;
  return approvalsText({
    pending: rows.length,
    overdue: rows.filter((r) => r.is_overdue).length,
    oldestDays: oldest,
    titles: rows.map((r) => r.title ?? "").filter(Boolean),
  });
}

/** 気になること */
async function alertsAnswer(admin: Admin, companyId: string, management: boolean): Promise<string> {
  if (management) {
    const [{ count }, { data }] = await Promise.all([
      admin.from("alerts").select("id", { count: "exact", head: true }).eq("company_id", companyId).eq("status", "open"),
      admin.from("alerts").select("title, severity").eq("company_id", companyId).eq("status", "open").order("severity").order("detected_at", { ascending: false }).limit(3),
    ]);
    return alertsText((data ?? []).map((a) => ({ title: a.title ?? "", severity: a.severity ?? "low" })), count ?? 0);
  }
  // 事務員：経営のアラートを除いてから数える（未対応は多くても数十件なので全件読んで絞る）
  const { data } = await admin.from("alerts").select("code, title, severity").eq("company_id", companyId).eq("status", "open").order("severity").order("detected_at", { ascending: false });
  const rows = (data ?? []).filter((a) => !isManagementAlert(a.code));
  return alertsText(rows.slice(0, 3).map((a) => ({ title: a.title ?? "", severity: a.severity ?? "low" })), rows.length);
}

/** ドライバーへの支払 */
async function payoutAnswer(admin: Admin, companyId: string, company: Company, now: Date): Promise<string> {
  const month = currentMonthJST(now);
  const { data: pl } = await admin.from("v_month_pl").select("*").eq("company_id", companyId).eq("month", monthToDate(month)).maybeSingle();
  const { date } = resolvePayoutDate(month, company, null);
  return payoutText({
    month,
    total: Number(pl?.payout_incl ?? 0),
    driverCount: Number(pl?.active_driver_count ?? 0),
    payoutDate: date,
    isClosed: pl?.status === "closed",
  });
}

/** 稼働の入力状況 */
async function entriesAnswer(admin: Admin, companyId: string, now: Date): Promise<string> {
  const month = currentMonthJST(now);
  const m = monthToDate(month);
  const [entriesRes, zeroRes, pendingRes, dayRes, reportRes] = await Promise.all([
    admin.from("work_entries").select("id", { count: "exact", head: true }).eq("company_id", companyId).eq("month", m),
    admin.from("work_entries").select("id", { count: "exact", head: true }).eq("company_id", companyId).eq("month", m).eq("qty", 0),
    admin.from("work_day_entries").select("id", { count: "exact", head: true }).eq("company_id", companyId).eq("month", m).eq("status", "submitted"),
    admin.from("work_day_entries").select("work_date, driver_id").eq("company_id", companyId).eq("month", m).eq("status", "approved"),
    admin.from("daily_reports").select("work_date, driver_id").eq("company_id", companyId).eq("month", m),
  ]);
  // 稼働はあるのに点呼の記録が無い日（法令上は 1 日 1 件・1 年保存）
  const reported = new Set((reportRes.data ?? []).map((r) => `${r.work_date}:${r.driver_id}`));
  const missing = new Set(
    (dayRes.data ?? []).map((d) => `${d.work_date}:${d.driver_id}`).filter((k) => !reported.has(k)),
  );
  return entriesText({
    month,
    entryCount: entriesRes.count ?? 0,
    zeroQtyCount: zeroRes.count ?? 0,
    pendingDayEntries: pendingRes.count ?? 0,
    missingReports: missing.size,
  });
}

export type { LineIntent };
