import type { ServerSupabase } from "@/lib/supabase/server";
import type { DayOffListRow, DispatchListRow, DispatchOutlookRow, ProjectDemand, ProjectDemandDay } from "@/lib/db/types";
import type { Assignment, DayOff, DemandDay, DemandPattern, DispatchDriver, DispatchItem, OutlookDay } from "./board";
import { projectDisplayName } from "@/components/entries/helpers";

/**
 * 配車の読み取り（サーバー専用）。
 *
 * 画面が使う形（`lib/dispatch/board.ts` の型）にそろえて返す。
 * 埋め込みリソースは使わず、名前が要るところはビュー（`v_dispatch_list` / `v_day_off_list`）を使う。
 */

export interface DispatchWeekData {
  items: DispatchItem[];
  drivers: DispatchDriver[];
  patterns: DemandPattern[];
  demandDays: DemandDay[];
  assignments: Assignment[];
  dayOffs: DayOff[];
  /** 直近の実績から出した「1 日あたりの数量」の目安（キーは `driverId|itemId` と `itemId`） */
  recentQty: Record<string, number>;
}

function toAssignment(row: DispatchListRow): Assignment {
  return {
    id: row.id ?? "",
    onDate: row.on_date ?? "",
    driverId: row.driver_id ?? "",
    projectItemId: row.project_item_id ?? "",
    qtyPlan: Number(row.qty_plan ?? 0),
    status: (row.status ?? "planned") as Assignment["status"],
    hasReport: row.has_report ?? false,
  };
}

function toDayOff(row: DayOffListRow): DayOff {
  return {
    driverId: row.driver_id ?? "",
    onDate: row.on_date ?? "",
    status: (row.status ?? "requested") as DayOff["status"],
  };
}

/** 期間ぶんの配車をまとめて読む（画面 1 枚あたり 6 往復） */
export async function loadDispatchWeek(supabase: ServerSupabase, companyId: string, from: string, to: string): Promise<DispatchWeekData> {
  const [driversRes, projectsRes, itemsRes, patternsRes, demandDaysRes, assignmentsRes, dayOffsRes, recentRes] = await Promise.all([
    supabase.from("drivers").select("id, name, is_active, weekly_off, sort_order").eq("company_id", companyId).eq("is_active", true).order("sort_order").order("name"),
    supabase.from("projects").select("id, name, is_active").eq("company_id", companyId).eq("is_active", true),
    supabase.from("project_items").select("id, project_id, name, unit, bill_rate, pay_rate, is_active, sort_order").eq("company_id", companyId).eq("is_active", true).order("sort_order"),
    supabase.from("project_demands").select("project_item_id, weekday, need").eq("company_id", companyId),
    supabase.from("project_demand_days").select("project_item_id, on_date, need").eq("company_id", companyId).gte("on_date", from).lte("on_date", to),
    supabase.from("v_dispatch_list").select("*").eq("company_id", companyId).gte("on_date", from).lte("on_date", to).order("on_date"),
    supabase.from("v_day_off_list").select("*").eq("company_id", companyId).gte("on_date", from).lte("on_date", to).order("on_date"),
    // 直近 60 日の承認済みの実績（予定の数量の目安に使う）
    supabase
      .from("work_day_entries")
      .select("driver_id, project_item_id, qty, status, work_date")
      .eq("company_id", companyId)
      .eq("status", "approved")
      .gte("work_date", addDaysISO(from, -60))
      .lt("work_date", from),
  ]);

  const projects = new Map((projectsRes.data ?? []).map((p) => [p.id, p.name]));
  const items: DispatchItem[] = (itemsRes.data ?? [])
    .filter((i) => projects.has(i.project_id))
    .map((i) => {
      const projectName = projects.get(i.project_id) ?? "";
      return {
        id: i.id,
        projectId: i.project_id,
        projectName,
        itemName: i.name,
        label: projectDisplayName(projectName, i.name),
        unit: i.unit,
        billRate: Number(i.bill_rate ?? 0),
        payRate: Number(i.pay_rate ?? 0),
      };
    });

  const drivers: DispatchDriver[] = (driversRes.data ?? []).map((d) => ({
    id: d.id,
    name: d.name,
    weeklyOff: (d.weekly_off ?? []).map((n) => Number(n)),
  }));

  // 数量の目安：ドライバー × 案件内容の平均 → 案件内容の平均
  const sums = new Map<string, { total: number; count: number }>();
  for (const row of recentRes.data ?? []) {
    const qty = Number(row.qty ?? 0);
    if (!(qty > 0)) continue;
    for (const key of [`${row.driver_id}|${row.project_item_id}`, row.project_item_id]) {
      const cur = sums.get(key) ?? { total: 0, count: 0 };
      cur.total += qty;
      cur.count += 1;
      sums.set(key, cur);
    }
  }
  const recentQty: Record<string, number> = {};
  for (const [key, v] of sums) recentQty[key] = Math.round((v.total / v.count) * 100) / 100;

  return {
    items,
    drivers,
    patterns: (patternsRes.data ?? []).map((p) => ({ projectItemId: p.project_item_id, weekday: Number(p.weekday), need: Number(p.need) })),
    demandDays: (demandDaysRes.data ?? []).map((d) => ({ projectItemId: d.project_item_id, onDate: d.on_date, need: Number(d.need) })),
    assignments: (assignmentsRes.data ?? []).map(toAssignment),
    dayOffs: (dayOffsRes.data ?? []).map(toDayOff),
    recentQty,
  };
}

/** 休み希望の一覧（決まっていないものを先に） */
export async function loadDayOffs(supabase: ServerSupabase, companyId: string, from: string): Promise<DayOffListRow[]> {
  const { data, error } = await supabase
    .from("v_day_off_list")
    .select("*")
    .eq("company_id", companyId)
    .gte("on_date", from)
    .order("on_date")
    .limit(200);
  if (error) throw error;
  return data ?? [];
}

/** ドライバー本人の予定（自分の配車。RLS が他人の行を隠す） */
export async function loadMyDispatch(supabase: ServerSupabase, companyId: string, driverId: string, from: string, to: string): Promise<DispatchListRow[]> {
  const { data, error } = await supabase
    .from("v_dispatch_list")
    .select("*")
    .eq("company_id", companyId)
    .eq("driver_id", driverId)
    .gte("on_date", from)
    .lte("on_date", to)
    .order("on_date");
  if (error) throw error;
  return data ?? [];
}

/**
 * ダッシュボード用：これからの配車の見通しと、決まっていない休み希望の数。
 *
 * 画面 1 枚あたり 2 往復に収める（配車表と同じ読み方をすると 8 往復になる）。
 * 日ごとの必要・割り当て・不足・予定の売上は DB のビューが出す（§6）。
 */
export async function loadDispatchOutlook(
  supabase: ServerSupabase,
  companyId: string,
): Promise<{ days: OutlookDay[]; pendingDayOffs: number }> {
  const [outlookRes, offsRes] = await Promise.all([
    supabase.from("v_dispatch_outlook").select("*").eq("company_id", companyId).order("on_date"),
    supabase.from("driver_day_offs").select("id", { count: "exact" }).eq("company_id", companyId).eq("status", "requested"),
  ]);
  if (outlookRes.error) throw outlookRes.error;
  if (offsRes.error) throw offsRes.error;
  return {
    days: (outlookRes.data ?? []).map(toOutlookDay),
    pendingDayOffs: offsRes.count ?? 0,
  };
}

function toOutlookDay(row: DispatchOutlookRow): OutlookDay {
  return {
    date: row.on_date ?? "",
    need: Number(row.need ?? 0),
    assigned: Number(row.assigned ?? 0),
    confirmed: Number(row.confirmed ?? 0),
    shortage: Number(row.shortage ?? 0),
    planBill: Number(row.plan_bill ?? 0),
    planPay: Number(row.plan_pay ?? 0),
    planMargin: Number(row.plan_margin ?? 0),
  };
}

/** 必要人数の一覧（設定タブ用） */
export async function loadDemands(supabase: ServerSupabase, companyId: string): Promise<{ patterns: ProjectDemand[]; days: ProjectDemandDay[] }> {
  const [p, d] = await Promise.all([
    supabase.from("project_demands").select("*").eq("company_id", companyId),
    supabase.from("project_demand_days").select("*").eq("company_id", companyId).gte("on_date", new Date().toISOString().slice(0, 10)).order("on_date"),
  ]);
  if (p.error) throw p.error;
  if (d.error) throw d.error;
  return { patterns: p.data ?? [], days: d.data ?? [] };
}

/** "YYYY-MM-DD" を n 日ずらす（ここだけで使う小さなもの） */
function addDaysISO(date: string, n: number): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}
