/**
 * AI に渡すデータパック（会社の実データから作るコンパクトな JSON）。
 *
 * - 集計はすべて DB ビュー（v_month_pl / v_driver_month_summary / v_project_pl / v_expense_summary /
 *   v_invoice_list）と RPC（cash_forecast）から取り、ここでは計算し直さない。
 * - 着地見込みだけは純関数 lib/calc/forecast.ts（画面と同じ計算）を使う。
 * - 金額は小数 2 桁に丸め、件数の上限（AI_CONTEXT_LIMITS）を守って JSON を小さく保つ。
 * - 機密（メールアドレス・API キー・住所など）は入れない。
 */
import type { ServerSupabase } from "@/lib/supabase/server";
import type { Alert, DriverMonthLaborRow, DriverMonthSummary, ExecutiveSummary, ExpenseSummaryRow, InvoiceListRow, LoanRow, MonthKpi, MonthPl, ProjectPl, TaxTaskRow } from "@/lib/db/types";
import { emptyMonthPl, loadAlerts, loadCashForecast, loadCashSnapshots, loadDriverMonthLabor, loadLoans, loadMonthKpi, loadTaxTasks } from "@/lib/db/queries";
import { loadExecutiveSummary } from "@/lib/executive/queries";
import { forecastMonth, type ForecastResult } from "@/lib/calc/forecast";
import { sumMoney } from "@/lib/calc/money";
import { addMonths, dateToMonth, formatMonthJa, monthToDate } from "@/lib/month";

/** JSON が大きくなりすぎないための件数上限 */
export const AI_CONTEXT_LIMITS = {
  /** 直近何か月分の推移を渡すか */
  months: 12,
  drivers: 50,
  projects: 50,
  expenses: 30,
  invoices: 30,
  alerts: 20,
  loans: 10,
  taxTasks: 10,
  /** 資金繰りを何日先まで集計するか */
  cashDays: 60,
} as const;

/** 小数 2 桁に丸めた数値（insights.ts の n() と同じ方針） */
export function round2(v: number | null | undefined): number {
  const n = Number(v ?? 0);
  return Number.isFinite(n) ? Math.round(n * 100) / 100 : 0;
}

/** 率は小数 4 桁（0.1234 = 12.34%） */
export function round4(v: number | null | undefined): number {
  const n = Number(v ?? 0);
  return Number.isFinite(n) ? Math.round(n * 10_000) / 10_000 : 0;
}

/** 件数上限を守って配列を切り詰める */
export function limitRows<T>(rows: readonly T[] | null | undefined, limit: number): T[] {
  if (!Array.isArray(rows)) return [];
  return limit > 0 ? rows.slice(0, limit) : [];
}

/** 日本時間の今日 "YYYY-MM-DD" */
export function todayJst(now: Date = new Date()): string {
  return new Date(now.getTime() + 9 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

/** "YYYY-MM-DD" に日数を足す */
export function addDays(date: string, days: number): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/* ---------------------------------------------------------------- 型 */

export interface AiCompanyInfo {
  name: string;
  /** 消費税率（0.1 = 10%） */
  tax_rate: number;
  default_royalty_rate: number;
  default_mgmt_fee: number;
}

/** 会社 × 月の損益（v_month_pl） */
export interface AiMonthRow {
  month: string;
  status: "open" | "closed";
  entry_count: number;
  bill: number;
  pay: number;
  margin: number;
  royalty: number;
  mgmt_fee: number;
  profit: number;
  expense_total: number;
  expense_fixed: number;
  expense_variable: number;
  operating_profit: number;
  operating_margin: number;
  bill_target: number;
  profit_target: number;
}

/** 当月の着地見込み（lib/calc/forecast.ts の結果を丸めたもの） */
export interface AiForecast {
  basis: ForecastResult["basis"];
  reliability: ForecastResult["reliability"];
  as_of_date: string | null;
  /** 月の経過率 0〜1 */
  progress: number;
  bill_forecast: number;
  payout_forecast: number;
  profit_forecast: number;
  expense_forecast: number;
  operating_profit_forecast: number;
  /** 見込みベースの達成率（目標が未設定なら null） */
  bill_target_rate: number | null;
  profit_target_rate: number | null;
}

export interface AiDriverRow {
  name: string;
  is_active: boolean;
  entry_count: number;
  bill: number;
  pay: number;
  margin: number;
  royalty: number;
  mgmt_fee: number;
  payout: number;
  driver_profit: number;
  profit_rate: number;
}

export interface AiProjectRow {
  project: string;
  client: string;
  entry_count: number;
  driver_count: number;
  qty_total: number;
  bill: number;
  pay: number;
  entry_profit: number;
  expense_direct: number;
  project_profit: number;
  project_margin: number;
  target_margin: number;
  below_target: boolean;
}

export interface AiExpenseRow {
  category: string;
  kind: "fixed" | "variable";
  count: number;
  amount: number;
}

export interface AiInvoiceRow {
  invoice_no: string;
  client: string;
  month: string;
  status: string;
  total: number;
  issue_date: string | null;
  due_date: string | null;
}

export interface AiCashSummary {
  /** 起点の残高（cash_snapshots の最新。未登録なら null） */
  balance: number | null;
  balance_as_of: string | null;
  from: string;
  to: string;
  /** 期間内の入金合計・支払合計（支払は正の数） */
  inflow: number;
  outflow: number;
  /** 起点残高 ＋ 入金 − 支払（起点が未登録なら null） */
  ending_balance: number | null;
  event_count: number;
}

/** 会社 × 月の経営指標（v_month_kpi）。限界利益と損益分岐点 */
export interface AiKpiRow {
  contribution: number;
  contribution_rate: number;
  net_fixed_cost: number;
  break_even_bill: number;
  payout_rate: number;
  bill_per_driver: number;
  profit_per_driver: number;
  bill_per_work_day: number;
  work_day_count: number;
  bill_target: number;
  profit_target: number;
  expense_target: number;
  bill_achievement: number | null;
  profit_achievement: number | null;
  expense_achievement: number | null;
}

/** 借入と返済（v_loan_list）。金融機関名までで、口座などは渡さない */
export interface AiLoanRow {
  name: string;
  lender: string;
  annual_rate: number;
  remaining_principal: number;
  next_due_on: string | null;
  next_total: number;
  status: string;
}

/** その月の労務（v_driver_month_labor を会社単位でまとめたもの） */
export interface AiLaborSummary {
  driver_count: number;
  report_days: number;
  duty_minutes_total: number;
  duty_minutes_avg: number;
  over_duty_days: number;
  severe_duty_days: number;
  short_rest_days: number;
  severe_rest_days: number;
  max_consecutive_days: number;
  drivers_over_month_limit: number;
}

/** 近づいている決算・税務の期限（v_tax_task_list） */
export interface AiTaxRow {
  title: string;
  due_on: string;
  days_left: number;
  urgency: string;
}

export interface AiAlertRow {
  title: string;
  detail: string;
  severity: string;
}

/** Claude に渡すデータパック */
export interface AiContext {
  generated_at: string;
  month: string;
  month_label: string;
  is_closed: boolean;
  company: AiCompanyInfo;
  current: AiMonthRow;
  months: AiMonthRow[];
  forecast: AiForecast | null;
  drivers: AiDriverRow[];
  projects: AiProjectRow[];
  expenses: AiExpenseRow[];
  invoices: AiInvoiceRow[];
  cash: AiCashSummary | null;
  alerts: AiAlertRow[];
  kpi: AiKpiRow | null;
  loans: AiLoanRow[];
  tax_tasks: AiTaxRow[];
  labor: AiLaborSummary | null;
  governance: AiGovernanceSummary | null;
}

/**
 * 代表の領域の「件数だけ」。件名・金額・人の名前は渡さない
 * （代表専用の内容が外に出ないように、集計した数だけにする）。
 */
export interface AiGovernanceSummary {
  pending_approvals: number;
  overdue_approvals: number;
  due_reviews: number;
  expiring_insurance: number;
  expiring_officers: number;
  active_delegations: number;
  sensitive_exports_30d: number;
}

export interface LoadAiContextOptions {
  /** 判定の基準時刻（日本時間で解釈する。既定は現在時刻） */
  now?: Date;
  /** 推移の月数（既定 12） */
  months?: number;
  /** 資金繰りの日数（既定 60） */
  cashDays?: number;
}

/* ------------------------------------------------------------ 変換 */

function toMonthRow(row: MonthPl, month: string): AiMonthRow {
  return {
    month,
    status: row.status === "closed" ? "closed" : "open",
    entry_count: Number(row.entry_count ?? 0),
    bill: round2(row.bill),
    pay: round2(row.pay),
    margin: round2(row.margin),
    royalty: round2(row.royalty),
    mgmt_fee: round2(row.mgmt_fee),
    profit: round2(row.profit),
    expense_total: round2(row.expense_total),
    expense_fixed: round2(row.expense_fixed),
    expense_variable: round2(row.expense_variable),
    operating_profit: round2(row.operating_profit),
    operating_margin: round4(row.operating_margin),
    bill_target: round2(row.bill_target),
    profit_target: round2(row.profit_target),
  };
}

function toDriverRow(row: DriverMonthSummary): AiDriverRow {
  const bill = Number(row.bill ?? 0);
  const profit = Number(row.driver_profit ?? 0);
  return {
    name: row.driver_name ?? "",
    is_active: Boolean(row.driver_is_active),
    entry_count: Number(row.entry_count ?? 0),
    bill: round2(bill),
    pay: round2(row.pay),
    margin: round2(row.margin),
    royalty: round2(row.royalty),
    mgmt_fee: round2(row.mgmt_fee),
    payout: round2(row.payout),
    driver_profit: round2(profit),
    profit_rate: bill !== 0 ? round4(profit / bill) : 0,
  };
}

function toProjectRow(row: ProjectPl): AiProjectRow {
  return {
    project: row.project_name ?? "",
    client: row.client_name ?? "",
    entry_count: Number(row.entry_count ?? 0),
    driver_count: Number(row.driver_count ?? 0),
    qty_total: round2(row.qty_total),
    bill: round2(row.bill),
    pay: round2(row.pay),
    entry_profit: round2(row.entry_profit),
    expense_direct: round2(row.expense_direct),
    project_profit: round2(row.project_profit),
    project_margin: round4(row.project_margin),
    target_margin: round4(row.target_margin),
    below_target: Boolean(row.below_target),
  };
}

function toExpenseRow(row: ExpenseSummaryRow): AiExpenseRow {
  return {
    category: row.category_name ?? "",
    kind: row.kind === "fixed" ? "fixed" : "variable",
    count: Number(row.expense_count ?? 0),
    amount: round2(row.amount),
  };
}

function toInvoiceRow(row: InvoiceListRow): AiInvoiceRow {
  return {
    invoice_no: row.invoice_no ?? "",
    client: row.client_name ?? "",
    month: row.month ? dateToMonth(row.month) : "",
    status: row.status ?? "draft",
    total: round2(row.total),
    issue_date: row.issue_date,
    due_date: row.due_date,
  };
}

function toAlertRow(row: Alert): AiAlertRow {
  return { title: row.title, detail: row.detail, severity: row.severity };
}

/** 当月が未締めのときだけ着地見込みを作る（過去月・締め済みの月は実績が正） */
export function buildForecast(pl: MonthPl, month: string, isClosed: boolean, now: Date): AiForecast | null {
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
  if (f.basis !== "prorated") return null;
  return {
    basis: f.basis,
    reliability: f.reliability,
    as_of_date: f.asOfDate,
    progress: round4(f.progress),
    bill_forecast: round2(f.billForecast),
    payout_forecast: round2(f.payoutForecast),
    profit_forecast: round2(f.profitForecast),
    expense_forecast: round2(f.expenseForecast),
    operating_profit_forecast: round2(f.operatingProfitForecast),
    bill_target_rate: f.billTargetRate == null ? null : round4(f.billTargetRate),
    profit_target_rate: f.profitTargetRate == null ? null : round4(f.profitTargetRate),
  };
}

/** 資金繰りの集計（入金は ＋、支払は −。起点の残高は最新のスナップショット） */
export function summarizeCash(
  events: { amount: number | null }[],
  snapshot: { as_of: string; balance: number } | null,
  from: string,
  to: string,
): AiCashSummary {
  const amounts = events.map((e) => Number(e.amount ?? 0));
  const inflow = sumMoney(amounts.filter((a) => a > 0));
  const outflow = sumMoney(amounts.filter((a) => a < 0).map((a) => -a));
  const balance = snapshot ? Number(snapshot.balance ?? 0) : null;
  return {
    balance: balance == null ? null : round2(balance),
    balance_as_of: snapshot?.as_of ?? null,
    from,
    to,
    inflow: round2(inflow),
    outflow: round2(outflow),
    ending_balance: balance == null ? null : round2(sumMoney([balance, inflow, -outflow])),
    event_count: events.length,
  };
}

/* ------------------------------------------------------------ 読み込み */

/**
 * 会社の実データから AI に渡すデータパックを作る。
 * 失敗しても会話・分析を止めないよう、資金繰り・アラートなど付随する情報は取れなければ省略する。
 */
function toKpiRow(r: MonthKpi): AiKpiRow {
  return {
    contribution: round2(r.contribution),
    contribution_rate: round4(r.contribution_rate),
    net_fixed_cost: round2(r.net_fixed_cost),
    break_even_bill: round2(r.break_even_bill),
    payout_rate: round4(r.payout_rate),
    bill_per_driver: round2(r.bill_per_driver),
    profit_per_driver: round2(r.profit_per_driver),
    bill_per_work_day: round2(r.bill_per_work_day),
    work_day_count: Number(r.work_day_count ?? 0),
    bill_target: round2(r.bill_target),
    profit_target: round2(r.profit_target),
    expense_target: round2(r.expense_target),
    bill_achievement: r.bill_achievement == null ? null : round4(r.bill_achievement),
    profit_achievement: r.profit_achievement == null ? null : round4(r.profit_achievement),
    expense_achievement: r.expense_achievement == null ? null : round4(r.expense_achievement),
  };
}

function toLoanRow(r: LoanRow): AiLoanRow {
  return {
    name: r.name ?? "",
    lender: r.lender ?? "",
    annual_rate: round4(r.annual_rate),
    remaining_principal: round2(r.remaining_principal),
    next_due_on: r.next_due_on ?? null,
    next_total: round2(r.next_total),
    status: r.status ?? "",
  };
}

/** ドライバーごとの労務を会社単位にまとめる（個人名は渡さない） */
function toLaborSummary(rows: DriverMonthLaborRow[]): AiLaborSummary | null {
  if (rows.length === 0) return null;
  const sum = (pick: (r: DriverMonthLaborRow) => number) => rows.reduce((a, r) => a + (Number(pick(r)) || 0), 0);
  const reportDays = sum((r) => Number(r.report_days ?? 0));
  const dutyTotal = sum((r) => Number(r.duty_minutes_total ?? 0));
  return {
    driver_count: rows.length,
    report_days: reportDays,
    duty_minutes_total: dutyTotal,
    duty_minutes_avg: reportDays > 0 ? Math.round(dutyTotal / reportDays) : 0,
    over_duty_days: sum((r) => Number(r.over_duty_days ?? 0)),
    severe_duty_days: sum((r) => Number(r.severe_duty_days ?? 0)),
    short_rest_days: sum((r) => Number(r.short_rest_days ?? 0)),
    severe_rest_days: sum((r) => Number(r.severe_rest_days ?? 0)),
    max_consecutive_days: rows.reduce((a, r) => Math.max(a, Number(r.max_consecutive_days ?? 0)), 0),
    drivers_over_month_limit: rows.filter((r) => r.month_duty_over === true).length,
  };
}

function toTaxRow(r: TaxTaskRow): AiTaxRow {
  return {
    title: r.title ?? "",
    due_on: r.due_on ?? "",
    days_left: Number(r.days_left ?? 0),
    urgency: r.urgency ?? "",
  };
}

export async function loadAiContext(
  supabase: ServerSupabase,
  companyId: string,
  month: string,
  opts: LoadAiContextOptions = {},
): Promise<AiContext> {
  const now = opts.now ?? new Date();
  const monthCount = opts.months ?? AI_CONTEXT_LIMITS.months;
  const cashDays = opts.cashDays ?? AI_CONTEXT_LIMITS.cashDays;
  const monthDate = monthToDate(month);
  const fromMonth = addMonths(month, -(monthCount - 1));
  const cashFrom = todayJst(now);
  const cashTo = addDays(cashFrom, cashDays);

  const [companyRes, monthsRes, driversRes, projectsRes, expensesRes, invoicesRes] = await Promise.all([
    supabase.from("companies").select("name, tax_rate, default_royalty_rate, default_mgmt_fee").eq("id", companyId).maybeSingle(),
    supabase.from("v_month_pl").select("*").eq("company_id", companyId).gte("month", monthToDate(fromMonth)).lte("month", monthDate).order("month"),
    supabase.from("v_driver_month_summary").select("*").eq("company_id", companyId).eq("month", monthDate).order("driver_sort_order").order("driver_name"),
    supabase.from("v_project_pl").select("*").eq("company_id", companyId).eq("month", monthDate).order("project_sort_order").order("project_name"),
    supabase.from("v_expense_summary").select("*").eq("company_id", companyId).eq("month", monthDate).order("category_sort_order"),
    supabase.from("v_invoice_list").select("*").eq("company_id", companyId).neq("status", "paid").order("due_date").limit(AI_CONTEXT_LIMITS.invoices),
  ]);
  if (companyRes.error) throw companyRes.error;
  if (monthsRes.error) throw monthsRes.error;
  if (driversRes.error) throw driversRes.error;
  if (projectsRes.error) throw projectsRes.error;
  if (expensesRes.error) throw expensesRes.error;
  if (invoicesRes.error) throw invoicesRes.error;

  // 資金繰りとアラートは補助情報なので、取得に失敗しても分析は続ける
  const [cashEvents, snapshots, alerts, kpi, loans, taxTasks, labor, governance] = await Promise.all([
    loadCashForecast(supabase, cashFrom, cashTo).catch(() => null),
    loadCashSnapshots(supabase, companyId, 1).catch(() => []),
    loadAlerts(supabase, companyId, { status: "open", limit: AI_CONTEXT_LIMITS.alerts }).catch(() => []),
    loadMonthKpi(supabase, companyId, monthDate).catch(() => null),
    loadLoans(supabase, companyId).catch(() => []),
    loadTaxTasks(supabase, companyId, { from: cashFrom, to: addDays(cashFrom, 90), status: "todo" }).catch(() => []),
    loadDriverMonthLabor(supabase, companyId, monthDate).catch(() => []),
    // 代表以外が呼ぶと RLS で 0 になる（そのときは渡さない）
    loadExecutiveSummary(supabase, companyId).catch(() => null),
  ]);

  const monthRows = monthsRes.data ?? [];
  const currentRow = monthRows.find((r) => r.month === monthDate) ?? emptyMonthPl(companyId, month);
  const isClosed = currentRow.status === "closed";
  const snapshot = snapshots[0] ? { as_of: snapshots[0].as_of, balance: Number(snapshots[0].balance ?? 0) } : null;

  return {
    generated_at: todayJst(now),
    month,
    month_label: formatMonthJa(month),
    is_closed: isClosed,
    company: {
      name: companyRes.data?.name ?? "",
      tax_rate: round4(companyRes.data?.tax_rate),
      default_royalty_rate: round4(companyRes.data?.default_royalty_rate),
      default_mgmt_fee: round2(companyRes.data?.default_mgmt_fee),
    },
    current: toMonthRow(currentRow, month),
    months: limitRows(monthRows, monthCount).map((r) => toMonthRow(r, dateToMonth(r.month ?? monthDate))),
    forecast: buildForecast(currentRow, month, isClosed, now),
    drivers: limitRows(driversRes.data, AI_CONTEXT_LIMITS.drivers).map(toDriverRow),
    projects: limitRows(projectsRes.data, AI_CONTEXT_LIMITS.projects).map(toProjectRow),
    expenses: limitRows(expensesRes.data, AI_CONTEXT_LIMITS.expenses).map(toExpenseRow),
    invoices: limitRows(invoicesRes.data, AI_CONTEXT_LIMITS.invoices).map(toInvoiceRow),
    cash: cashEvents ? summarizeCash(cashEvents, snapshot, cashFrom, cashTo) : null,
    alerts: limitRows(alerts, AI_CONTEXT_LIMITS.alerts).map(toAlertRow),
    kpi: kpi ? toKpiRow(kpi) : null,
    loans: limitRows(loans.filter((l) => l.status !== "paid"), AI_CONTEXT_LIMITS.loans).map(toLoanRow),
    tax_tasks: limitRows(taxTasks, AI_CONTEXT_LIMITS.taxTasks).map(toTaxRow),
    labor: toLaborSummary(labor),
    governance: toGovernance(governance),
  };
}

/** 代表のサマリーを件数だけに落とす（すべて 0 なら渡さない） */
function toGovernance(row: ExecutiveSummary | null): AiGovernanceSummary | null {
  if (!row) return null;
  const g: AiGovernanceSummary = {
    pending_approvals: Number(row.pending_approvals ?? 0),
    overdue_approvals: Number(row.overdue_approvals ?? 0),
    due_reviews: Number(row.due_reviews ?? 0),
    expiring_insurance: Number(row.expiring_insurance ?? 0),
    expiring_officers: Number(row.expiring_officers ?? 0),
    active_delegations: Number(row.active_delegations ?? 0),
    sensitive_exports_30d: Number(row.sensitive_exports_30d ?? 0),
  };
  return Object.values(g).some((n) => n > 0) ? g : null;
}

/** 「何月のデータを何件渡したか」を日本語 1 行で（画面の表示用） */
export function describeAiContext(ctx: AiContext): string {
  const parts = [
    `直近 ${ctx.months.length} か月の損益`,
    `ドライバー ${ctx.drivers.length} 名`,
    `案件 ${ctx.projects.length} 件`,
    `経費 ${ctx.expenses.length} 区分`,
    `未入金の請求書 ${ctx.invoices.length} 件`,
  ];
  if (ctx.cash) parts.push(`資金繰り ${ctx.cash.event_count} 件`);
  if (ctx.kpi) parts.push("経営指標（限界利益・損益分岐点）");
  if (ctx.labor) parts.push(`労務（対象 ${ctx.labor.driver_count} 名）`);
  if ((ctx.loans?.length ?? 0) > 0) parts.push(`借入 ${ctx.loans.length} 件`);
  if ((ctx.tax_tasks?.length ?? 0) > 0) parts.push(`近い税務の期限 ${ctx.tax_tasks.length} 件`);
  if (ctx.alerts.length > 0) parts.push(`未対応のアラート ${ctx.alerts.length} 件`);
  if ((ctx.governance?.pending_approvals ?? 0) > 0) parts.push(`決裁待ち ${ctx.governance?.pending_approvals} 件`);
  return `${ctx.month_label}（${ctx.is_closed ? "締め済み" : "未締め"}）のデータを渡しました：${parts.join("・")}。`;
}

/* ------------------------------------------------------------ 会話の履歴 */

/** AI チャットの 1 発言 */
export interface AiChatTurn {
  role: "user" | "assistant";
  content: string;
}

/** 履歴として渡す往復の上限（1 往復 ＝ 質問 ＋ 回答） */
export const MAX_CHAT_TURNS = 10;

/**
 * 履歴を直近 maxTurns 往復に切り詰める。
 * 空の発言を捨て、role が user → assistant → user … と交互になるように整え、
 * 先頭は user、末尾は assistant にする（このあとに新しい質問を足すため）。
 */
export function trimHistory(history: readonly { role: string; content: string }[] | null | undefined, maxTurns = MAX_CHAT_TURNS): AiChatTurn[] {
  if (!Array.isArray(history)) return [];
  const alternating: AiChatTurn[] = [];
  for (const m of history) {
    const content = (m?.content ?? "").trim();
    if (!content) continue;
    const role: AiChatTurn["role"] = m.role === "assistant" ? "assistant" : "user";
    const last = alternating[alternating.length - 1];
    if (!last && role === "assistant") continue; // 先頭の assistant は捨てる
    if (last && last.role === role) continue; // 同じ role が続く場合は先の発言を採用する
    alternating.push({ role, content });
  }
  // 末尾が user（回答が保存されていない）の場合はその質問を落とす
  if (alternating[alternating.length - 1]?.role === "user") alternating.pop();
  const max = Math.max(0, Math.floor(maxTurns)) * 2;
  if (max === 0) return [];
  const trimmed = alternating.slice(-max);
  // 切り詰めで先頭が assistant になったら 1 件落として user から始める
  if (trimmed[0]?.role === "assistant") trimmed.shift();
  return trimmed;
}
