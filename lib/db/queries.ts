import type { ServerSupabase } from "@/lib/supabase/server";
import type { Masters, ProjectWithItems, MonthSummary, MonthListRow, RateDiff } from "@/lib/db/types";
import { monthToDate } from "@/lib/month";

/** マスタ一式（稼働入力ダイアログ・一括入力・設定画面で共用） */
export async function loadMasters(supabase: ServerSupabase, companyId: string, opts: { activeOnly?: boolean } = {}): Promise<Masters> {
  const [companyRes, driversRes, projectsRes, itemsRes, overridesRes] = await Promise.all([
    supabase.from("companies").select("*").eq("id", companyId).single(),
    supabase.from("drivers").select("*").eq("company_id", companyId).order("sort_order").order("name"),
    supabase.from("projects").select("*").eq("company_id", companyId).order("sort_order").order("name"),
    supabase.from("project_items").select("*").eq("company_id", companyId).order("sort_order").order("name"),
    supabase.from("driver_pay_overrides").select("*").eq("company_id", companyId),
  ]);
  if (companyRes.error) throw companyRes.error;
  if (driversRes.error) throw driversRes.error;
  if (projectsRes.error) throw projectsRes.error;
  if (itemsRes.error) throw itemsRes.error;
  if (overridesRes.error) throw overridesRes.error;

  const items = itemsRes.data ?? [];
  let projects: ProjectWithItems[] = (projectsRes.data ?? []).map((p) => ({ ...p, items: items.filter((i) => i.project_id === p.id) }));
  let drivers = driversRes.data ?? [];
  if (opts.activeOnly) {
    drivers = drivers.filter((d) => d.is_active);
    projects = projects.filter((p) => p.is_active).map((p) => ({ ...p, items: p.items.filter((i) => i.is_active) })).filter((p) => p.items.length > 0);
  }
  return { company: companyRes.data, drivers, projects, overrides: overridesRes.data ?? [] };
}

/** 会社 × 月の集計（無ければ 0 埋め） */
export async function loadMonthSummary(supabase: ServerSupabase, companyId: string, month: string): Promise<MonthSummary> {
  const { data, error } = await supabase.from("v_month_summary").select("*").eq("company_id", companyId).eq("month", monthToDate(month)).maybeSingle();
  if (error) throw error;
  return (
    data ?? {
      company_id: companyId,
      month: monthToDate(month),
      driver_count: 0,
      active_driver_count: 0,
      entry_count: 0,
      bill: 0,
      pay: 0,
      margin: 0,
      royalty: 0,
      mgmt_fee: 0,
      adj_pay: 0,
      adj_profit: 0,
      payout: 0,
      profit: 0,
      profit_rate: 0,
      status: "open",
      closed_at: null,
      closed_by: null,
      reopened_at: null,
      backup_path: null,
      closing_note: null,
      tax: 0,
      payout_incl: 0,
    }
  );
}

/** データがある月の一覧（降順） */
export async function loadMonthList(supabase: ServerSupabase, companyId: string): Promise<MonthListRow[]> {
  const { data, error } = await supabase.from("v_month_list").select("*").eq("company_id", companyId).order("month", { ascending: false });
  if (error) throw error;
  return data ?? [];
}

/** 月の締め状態 */
export async function isMonthClosed(supabase: ServerSupabase, companyId: string, month: string): Promise<boolean> {
  const { data, error } = await supabase
    .from("month_closings")
    .select("status")
    .eq("company_id", companyId)
    .eq("month", monthToDate(month))
    .maybeSingle();
  if (error) throw error;
  return data?.status === "closed";
}

/** 稼働行のスナップショットと現在のマスタ（§2.5）の差分（RPC rate_diffs。締め済み月は空配列） */
export async function loadRateDiffs(supabase: ServerSupabase, month: string, opts: { closed?: boolean } = {}): Promise<RateDiff[]> {
  if (opts.closed) return [];
  const { data, error } = await supabase.rpc("rate_diffs", { p_month: monthToDate(month) });
  if (error) throw error;
  return data ?? [];
}
