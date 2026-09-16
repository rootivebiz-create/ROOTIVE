/**
 * ダッシュボード（§4.1）のデータ取得。集計はすべて DB ビュー（v_*）から取り、画面側で再計算しない。
 */
import type { ServerSupabase } from "@/lib/supabase/server";
import type { AiInsight, DriverMonthSummary, MonthSummary } from "@/lib/db/types";
import { loadMonthSummary } from "@/lib/db/queries";
import { addMonths, compareMonth, currentMonthJST, dateToMonth, isFutureMonth, monthRange, monthToDate, prevMonth } from "@/lib/month";

/** 利益の推移 1 か月分（データが無い月は 0 埋め） */
export interface TrendPoint {
  month: string; // YYYY-MM
  bill: number;
  profit: number;
  payout: number;
  profitRate: number;
  hasData: boolean;
  isCurrent: boolean;
}

/** 支払単価 > 受注単価 の稼働行 */
export interface LossEntry {
  id: string;
  driverId: string;
  driverName: string;
  projectName: string;
  itemName: string;
  qty: number;
  billRate: number;
  payRate: number;
}

/** 今月の管理費がドライバー標準と異なる */
export interface MgmtFeeMismatch {
  driverId: string;
  driverName: string;
  setting: number;
  defaultFee: number;
}

export interface IdleDriver {
  driverId: string;
  driverName: string;
}

/** 数量 0 のままの稼働行 */
export interface ZeroQtyEntry {
  id: string;
  driverId: string;
  driverName: string;
  projectName: string;
  itemName: string;
}

export interface DashboardWarnings {
  lossEntries: LossEntry[];
  mgmtFeeMismatches: MgmtFeeMismatch[];
  idleDrivers: IdleDriver[];
  zeroQtyEntries: ZeroQtyEntry[];
  /** 未締めの過去月（YYYY-MM、昇順） */
  openPastMonths: string[];
}

export interface DashboardData {
  month: string;
  isClosed: boolean;
  isFuture: boolean;
  summary: MonthSummary;
  /** 前月の集計（データが無ければ null → 前月比は「—」） */
  prevSummary: MonthSummary | null;
  /** 直近 12 か月（当月を含む、昇順） */
  trend: TrendPoint[];
  drivers: DriverMonthSummary[];
  warnings: DashboardWarnings;
  /** 当月の最新の AI 分析（無ければ null） */
  insight: AiInsight | null;
}

/** 警告判定に必要な稼働行の列（v_work_entry_calc の一部） */
export interface WarningEntryRow {
  id: string | null;
  driver_id: string | null;
  driver_name: string | null;
  project_name: string | null;
  item_name: string | null;
  qty: number | null;
  bill_rate: number | null;
  pay_rate: number | null;
}

export interface BuildWarningsInput {
  month: string;
  isClosed: boolean;
  isFuture: boolean;
  entryCount: number;
  entries: WarningEntryRow[];
  drivers: DriverMonthSummary[];
  activeDrivers: { id: string; name: string }[];
  openMonths: string[]; // YYYY-MM（status open かつ entry_count > 0）
  /** 「過去月」の基準（この月より前を過去とみなす） */
  pastThreshold: string;
}

/** 警告の判定（純関数。§4.1・§12-1） */
export function buildDashboardWarnings(input: BuildWarningsInput): DashboardWarnings {
  const { entries, drivers, activeDrivers, isClosed, isFuture, entryCount } = input;

  // 支払単価 > 受注単価（支払単価 0 のドライバーは該当しない）
  const lossEntries: LossEntry[] = entries
    .filter((e) => Number(e.pay_rate ?? 0) > Number(e.bill_rate ?? 0))
    .map((e) => ({
      id: e.id ?? "",
      driverId: e.driver_id ?? "",
      driverName: e.driver_name ?? "",
      projectName: e.project_name ?? "",
      itemName: e.item_name ?? "",
      qty: Number(e.qty ?? 0),
      billRate: Number(e.bill_rate ?? 0),
      payRate: Number(e.pay_rate ?? 0),
    }));

  // 今月の管理費がドライバー標準と異なる（稼働がある行のみ）
  // 締め済み月は数字が確定しているため警告しない
  const mgmtFeeMismatches: MgmtFeeMismatch[] = (isClosed ? [] : drivers)
    .filter((d) => Number(d.active_entry_count ?? 0) > 0 && Number(d.mgmt_fee_setting ?? 0) !== Number(d.driver_default_mgmt_fee ?? 0))
    .map((d) => ({
      driverId: d.driver_id ?? "",
      driverName: d.driver_name ?? "",
      setting: Number(d.mgmt_fee_setting ?? 0),
      defaultFee: Number(d.driver_default_mgmt_fee ?? 0),
    }));

  // 稼働中なのに今月稼働ゼロ（未来月・締め済み月・データが全く無い月は除く）
  let idleDrivers: IdleDriver[] = [];
  if (!isFuture && !isClosed && entryCount > 0) {
    const working = new Set(drivers.filter((d) => Number(d.active_entry_count ?? 0) > 0).map((d) => d.driver_id ?? ""));
    idleDrivers = activeDrivers.filter((d) => !working.has(d.id)).map((d) => ({ driverId: d.id, driverName: d.name }));
  }

  // 数量 0 のままの行（未来月は「予定」なので除く）
  const zeroQtyEntries: ZeroQtyEntry[] = isFuture || isClosed
    ? []
    : entries
        .filter((e) => Number(e.qty ?? 0) === 0)
        .map((e) => ({
          id: e.id ?? "",
          driverId: e.driver_id ?? "",
          driverName: e.driver_name ?? "",
          projectName: e.project_name ?? "",
          itemName: e.item_name ?? "",
        }));

  const openPastMonths = [...input.openMonths].filter((m) => compareMonth(m, input.pastThreshold) < 0).sort(compareMonth);

  return { lossEntries, mgmtFeeMismatches, idleDrivers, zeroQtyEntries, openPastMonths };
}

/** 直近 12 か月の推移（無い月は 0 埋め） */
export function buildTrend(rows: { month: string | null; bill: number | null; profit: number | null; payout: number | null; profit_rate: number | null }[], month: string): TrendPoint[] {
  const byMonth = new Map(rows.map((r) => [dateToMonth(r.month ?? ""), r]));
  return monthRange(addMonths(month, -11), month).map((m) => {
    const r = byMonth.get(m);
    return {
      month: m,
      bill: Number(r?.bill ?? 0),
      profit: Number(r?.profit ?? 0),
      payout: Number(r?.payout ?? 0),
      profitRate: Number(r?.profit_rate ?? 0),
      hasData: Boolean(r),
      isCurrent: m === month,
    };
  });
}

/** ダッシュボードのデータ一式を並列で取得する */
export async function loadDashboardData(supabase: ServerSupabase, companyId: string, month: string): Promise<DashboardData> {
  const monthDate = monthToDate(month);
  const prev = prevMonth(month);
  const now = currentMonthJST();
  // 「過去月」の基準：実際の当月より前（表示中の月に関わらず、締めていない過去の月をすべて警告する）
  const pastThreshold = now;

  const [summary, prevRes, trendRes, driversRes, entriesRes, activeDriversRes, openMonthsRes, insightRes] = await Promise.all([
    loadMonthSummary(supabase, companyId, month),
    supabase.from("v_month_summary").select("*").eq("company_id", companyId).eq("month", monthToDate(prev)).maybeSingle(),
    supabase
      .from("v_month_summary")
      .select("month, bill, profit, payout, profit_rate")
      .eq("company_id", companyId)
      .gte("month", monthToDate(addMonths(month, -11)))
      .lte("month", monthDate)
      .order("month"),
    supabase.from("v_driver_month_summary").select("*").eq("company_id", companyId).eq("month", monthDate).order("driver_sort_order").order("driver_name"),
    supabase
      .from("v_work_entry_calc")
      .select("id, driver_id, driver_name, project_name, item_name, qty, bill_rate, pay_rate")
      .eq("company_id", companyId)
      .eq("month", monthDate),
    supabase.from("drivers").select("id, name").eq("company_id", companyId).eq("is_active", true).order("sort_order").order("name"),
    supabase.from("v_month_list").select("month, entry_count").eq("company_id", companyId).eq("status", "open").lt("month", monthToDate(pastThreshold)),
    supabase.from("ai_insights").select("*").eq("company_id", companyId).eq("month", monthDate).order("created_at", { ascending: false }).limit(1).maybeSingle(),
  ]);
  if (prevRes.error) throw prevRes.error;
  if (trendRes.error) throw trendRes.error;
  if (driversRes.error) throw driversRes.error;
  if (entriesRes.error) throw entriesRes.error;
  if (activeDriversRes.error) throw activeDriversRes.error;
  if (openMonthsRes.error) throw openMonthsRes.error;
  if (insightRes.error) throw insightRes.error;

  const isClosed = summary.status === "closed";
  const isFuture = isFutureMonth(month);
  const drivers = driversRes.data ?? [];

  const warnings = buildDashboardWarnings({
    month,
    isClosed,
    isFuture,
    entryCount: Number(summary.entry_count ?? 0),
    entries: entriesRes.data ?? [],
    drivers,
    activeDrivers: activeDriversRes.data ?? [],
    openMonths: (openMonthsRes.data ?? []).filter((m) => Number(m.entry_count ?? 0) > 0).map((m) => dateToMonth(m.month ?? "")),
    pastThreshold,
  });

  return {
    month,
    isClosed,
    isFuture,
    summary,
    prevSummary: prevRes.data ?? null,
    trend: buildTrend(trendRes.data ?? [], month),
    drivers,
    warnings,
    insight: insightRes.data ?? null,
  };
}
