import type { ServerSupabase } from "@/lib/supabase/server";
import type {
  Advisor,
  Approval,
  ApprovalDelegation,
  ApprovalRow,
  ApprovalRule,
  ApprovalStatus,
  CompanyProfile,
  Decision,
  DelegationRow,
  DriverBankRow,
  ExecutiveSummary,
  ExecutiveTask,
  ExportLogRow,
  Guarantee,
  InsurancePolicy,
  LoginEvent,
  Officer,
  Plan,
  PlanYear,
  PlanYearActual,
  Shareholder,
} from "@/lib/db/types";

/**
 * 代表（owner）の領域の読み取り。
 * 代表専用のテーブルは RLS で閉じているので、代表以外が呼ぶと空の配列が返る
 * （画面側でも requirePageRole(["owner"]) で入口を閉じること。CLAUDE.md §2 の二重の確認）。
 */

// ---------- 決裁 ----------

/** 決裁の一覧。既定は決裁待ちを急ぎの順に */
export async function loadApprovals(
  supabase: ServerSupabase,
  companyId: string,
  opts: { status?: ApprovalStatus; limit?: number } = {},
): Promise<ApprovalRow[]> {
  let q = supabase.from("v_approval_list").select("*").eq("company_id", companyId);
  if (opts.status) q = q.eq("status", opts.status);
  const { data, error } = await q
    .order("requested_at", { ascending: false })
    .limit(opts.limit ?? 200);
  if (error) throw error;
  return sortApprovals(data ?? []);
}

/** 決裁 1 件 */
export async function loadApproval(supabase: ServerSupabase, companyId: string, id: string): Promise<ApprovalRow | null> {
  const { data, error } = await supabase.from("v_approval_list").select("*").eq("company_id", companyId).eq("id", id).maybeSingle();
  if (error) throw error;
  return data ?? null;
}

/** 決裁待ちの件数（ナビのバッジ用） */
export async function loadPendingApprovalCount(supabase: ServerSupabase, companyId: string): Promise<number> {
  const { count, error } = await supabase
    .from("approvals")
    .select("id", { count: "exact", head: true })
    .eq("company_id", companyId)
    .eq("status", "pending");
  if (error) throw error;
  return count ?? 0;
}

/** 期限切れ → 滞留 → 待ち → 決裁済み の順に並べる（DB の urgency と同じ意味） */
const URGENCY_ORDER: Record<string, number> = { overdue: 0, stale: 1, waiting: 2, done: 3 };
export function sortApprovals(rows: ApprovalRow[]): ApprovalRow[] {
  return [...rows].sort((a, b) => {
    const ua = URGENCY_ORDER[a.urgency ?? "done"] ?? 9;
    const ub = URGENCY_ORDER[b.urgency ?? "done"] ?? 9;
    if (ua !== ub) return ua - ub;
    return (b.requested_at ?? "").localeCompare(a.requested_at ?? "");
  });
}

/** 決裁のルール */
export async function loadApprovalRules(supabase: ServerSupabase, companyId: string): Promise<ApprovalRule[]> {
  const { data, error } = await supabase.from("approval_rules").select("*").eq("company_id", companyId).order("sort_order");
  if (error) throw error;
  return data ?? [];
}

/** 決裁の委任 */
export async function loadDelegations(supabase: ServerSupabase, companyId: string): Promise<DelegationRow[]> {
  const { data, error } = await supabase
    .from("v_active_delegation")
    .select("*")
    .eq("company_id", companyId)
    .order("to_on", { ascending: false });
  if (error) throw error;
  return data ?? [];
}

/** いま有効な委任だけ */
export async function loadActiveDelegations(supabase: ServerSupabase, companyId: string): Promise<DelegationRow[]> {
  const rows = await loadDelegations(supabase, companyId);
  return rows.filter((r) => r.is_current);
}

// ---------- 代表ホーム ----------

/** 代表ダッシュボードの一行サマリー */
export async function loadExecutiveSummary(supabase: ServerSupabase, companyId: string): Promise<ExecutiveSummary | null> {
  const { data, error } = await supabase.from("v_executive_summary").select("*").eq("company_id", companyId).maybeSingle();
  if (error) throw error;
  return data ?? null;
}

/** 代表がいま見るべきこと（重いものから） */
export async function loadExecutiveTasks(supabase: ServerSupabase, companyId: string, limit = 20): Promise<ExecutiveTask[]> {
  const { data, error } = await supabase.from("v_executive_tasks").select("*").eq("company_id", companyId).limit(limit * 3);
  if (error) throw error;
  return sortExecutiveTasks(data ?? []).slice(0, limit);
}

const SEVERITY_ORDER: Record<string, number> = { high: 0, medium: 1, low: 2 };
export function sortExecutiveTasks(rows: ExecutiveTask[]): ExecutiveTask[] {
  return [...rows].sort((a, b) => {
    const sa = SEVERITY_ORDER[a.severity ?? "low"] ?? 9;
    const sb = SEVERITY_ORDER[b.severity ?? "low"] ?? 9;
    if (sa !== sb) return sa - sb;
    return (a.due_on ?? "9999-12-31").localeCompare(b.due_on ?? "9999-12-31");
  });
}

// ---------- 意思決定ログ ----------

export async function loadDecisions(supabase: ServerSupabase, companyId: string, limit = 200): Promise<Decision[]> {
  const { data, error } = await supabase
    .from("decisions")
    .select("*")
    .eq("company_id", companyId)
    .order("decided_on", { ascending: false })
    .limit(limit);
  if (error) throw error;
  return data ?? [];
}

export async function loadDecision(supabase: ServerSupabase, companyId: string, id: string): Promise<Decision | null> {
  const { data, error } = await supabase.from("decisions").select("*").eq("company_id", companyId).eq("id", id).maybeSingle();
  if (error) throw error;
  return data ?? null;
}

// ---------- 会社の台帳 ----------

export async function loadCompanyProfile(supabase: ServerSupabase, companyId: string): Promise<CompanyProfile | null> {
  const { data, error } = await supabase.from("company_profile").select("*").eq("company_id", companyId).maybeSingle();
  if (error) throw error;
  return data ?? null;
}

export async function loadOfficers(supabase: ServerSupabase, companyId: string): Promise<Officer[]> {
  const { data, error } = await supabase.from("officers").select("*").eq("company_id", companyId).order("sort_order").order("name");
  if (error) throw error;
  return data ?? [];
}

export async function loadShareholders(supabase: ServerSupabase, companyId: string): Promise<Shareholder[]> {
  const { data, error } = await supabase.from("shareholders").select("*").eq("company_id", companyId).order("sort_order").order("name");
  if (error) throw error;
  return data ?? [];
}

export async function loadInsurancePolicies(supabase: ServerSupabase, companyId: string): Promise<InsurancePolicy[]> {
  const { data, error } = await supabase
    .from("insurance_policies")
    .select("*")
    .eq("company_id", companyId)
    .order("expires_on", { nullsFirst: false });
  if (error) throw error;
  return data ?? [];
}

export async function loadAdvisors(supabase: ServerSupabase, companyId: string): Promise<Advisor[]> {
  const { data, error } = await supabase.from("advisors").select("*").eq("company_id", companyId).order("sort_order").order("name");
  if (error) throw error;
  return data ?? [];
}

export async function loadGuarantees(supabase: ServerSupabase, companyId: string): Promise<Guarantee[]> {
  const { data, error } = await supabase
    .from("guarantees")
    .select("*")
    .eq("company_id", companyId)
    .order("starts_on", { nullsFirst: false });
  if (error) throw error;
  return data ?? [];
}

// ---------- 中期計画 ----------

export async function loadPlans(supabase: ServerSupabase, companyId: string): Promise<Plan[]> {
  const { data, error } = await supabase.from("plans").select("*").eq("company_id", companyId).order("from_year", { ascending: false });
  if (error) throw error;
  return data ?? [];
}

export async function loadPlan(supabase: ServerSupabase, companyId: string, id: string): Promise<Plan | null> {
  const { data, error } = await supabase.from("plans").select("*").eq("company_id", companyId).eq("id", id).maybeSingle();
  if (error) throw error;
  return data ?? null;
}

export async function loadPlanYears(supabase: ServerSupabase, companyId: string, planId: string): Promise<PlanYear[]> {
  const { data, error } = await supabase.from("plan_years").select("*").eq("company_id", companyId).eq("plan_id", planId).order("year");
  if (error) throw error;
  return data ?? [];
}

/** 年ごとの目標と実績 */
export async function loadPlanYearActuals(supabase: ServerSupabase, companyId: string, planId?: string): Promise<PlanYearActual[]> {
  let q = supabase.from("v_plan_year_actual").select("*").eq("company_id", companyId);
  if (planId) q = q.eq("plan_id", planId);
  const { data, error } = await q.order("year");
  if (error) throw error;
  return data ?? [];
}

// ---------- 守り（ログインと持ち出し） ----------

export async function loadLoginEvents(supabase: ServerSupabase, companyId: string, limit = 100): Promise<LoginEvent[]> {
  const { data, error } = await supabase
    .from("login_events")
    .select("*")
    .eq("company_id", companyId)
    .order("at", { ascending: false })
    .limit(limit);
  if (error) throw error;
  return data ?? [];
}

export async function loadExportLogs(
  supabase: ServerSupabase,
  companyId: string,
  opts: { sensitiveOnly?: boolean; limit?: number } = {},
): Promise<ExportLogRow[]> {
  let q = supabase.from("v_export_log_list").select("*").eq("company_id", companyId);
  if (opts.sensitiveOnly) q = q.eq("is_sensitive", true);
  const { data, error } = await q.order("at", { ascending: false }).limit(opts.limit ?? 200);
  if (error) throw error;
  return data ?? [];
}

// ---------- ドライバーの振込口座（見てよい人にだけ返る） ----------

export async function loadDriverBankAccounts(supabase: ServerSupabase, companyId: string): Promise<DriverBankRow[]> {
  const { data, error } = await supabase.from("v_driver_bank").select("*").eq("company_id", companyId).order("sort_order").order("driver_name");
  if (error) throw error;
  return data ?? [];
}

// ---------- 申請（管理者から代表へ） ----------

/** その操作に代表の決裁が要るか（しきい値は DB の approval_rules） */
export async function checkApprovalRequired(
  supabase: ServerSupabase,
  kind: Approval["kind"],
  amount: number | null,
): Promise<{ required: boolean; due_on: string | null; label: string }> {
  const { data, error } = await supabase.rpc("approval_required", { p_kind: kind, p_amount: amount ?? undefined });
  if (error) throw error;
  const row = (data ?? {}) as { required?: boolean; due_on?: string | null; label?: string };
  return { required: Boolean(row.required), due_on: row.due_on ?? null, label: row.label ?? "" };
}

/** 同じ対象について、すでに決裁待ちの申請があるか（二重に申請させない） */
export async function loadPendingApprovalFor(
  supabase: ServerSupabase,
  companyId: string,
  refTable: string,
  refId: string,
): Promise<ApprovalRow | null> {
  const { data, error } = await supabase
    .from("v_approval_list")
    .select("*")
    .eq("company_id", companyId)
    .eq("ref_table", refTable)
    .eq("ref_id", refId)
    .eq("status", "pending")
    .limit(1);
  if (error) throw error;
  return data?.[0] ?? null;
}
