import type { ServerSupabase } from "@/lib/supabase/server";
import type {
  Masters,
  ProjectWithItems,
  MonthSummary,
  MonthListRow,
  RateDiff,
  MonthPl,
  ExpenseCategory,
  ExpenseListRow,
  ExpenseSummaryRow,
  Client,
  ProjectPl,
  CashEvent,
  CashSnapshot,
  StaffRow,
  ChatChannelRow,
  ChatMessageRow,
  AiConversationRow,
  AiMessage,
  Alert,
  AlertStatus,
  AlertSummaryRow,
  Integration,
  IntegrationLog,
  BankTransactionRow,
  BankTxnStatus,
  BankImport,
} from "@/lib/db/types";
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

/** 会社 × 月の損益（会社利益 − 経費 ＝ 営業利益。無ければ 0 埋め） */
export async function loadMonthPl(supabase: ServerSupabase, companyId: string, month: string): Promise<MonthPl> {
  const { data, error } = await supabase.from("v_month_pl").select("*").eq("company_id", companyId).eq("month", monthToDate(month)).maybeSingle();
  if (error) throw error;
  return data ?? emptyMonthPl(companyId, month);
}

/** 期間内（from 〜 to、いずれも "YYYY-MM"）の損益を月の昇順で返す */
export async function loadMonthPlRange(supabase: ServerSupabase, companyId: string, from: string, to: string): Promise<MonthPl[]> {
  const { data, error } = await supabase
    .from("v_month_pl")
    .select("*")
    .eq("company_id", companyId)
    .gte("month", monthToDate(from))
    .lte("month", monthToDate(to))
    .order("month");
  if (error) throw error;
  return data ?? [];
}

/** v_month_pl の 0 埋め行 */
export function emptyMonthPl(companyId: string, month: string): MonthPl {
  return {
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
    tax: 0,
    payout_incl: 0,
    profit: 0,
    expense_total: 0,
    expense_fixed: 0,
    expense_variable: 0,
    expense_count: 0,
    operating_profit: 0,
    operating_margin: 0,
    bill_target: 0,
    profit_target: 0,
    target_memo: "",
    status: "open",
  };
}

/** 経費カテゴリ（並び順） */
export async function loadExpenseCategories(supabase: ServerSupabase, companyId: string, opts: { activeOnly?: boolean } = {}): Promise<ExpenseCategory[]> {
  let q = supabase.from("expense_categories").select("*").eq("company_id", companyId).order("sort_order").order("name");
  if (opts.activeOnly) q = q.eq("is_active", true);
  const { data, error } = await q;
  if (error) throw error;
  return data ?? [];
}

/** その月の経費（カテゴリ名つき） */
export async function loadExpenses(supabase: ServerSupabase, companyId: string, month: string): Promise<ExpenseListRow[]> {
  const { data, error } = await supabase
    .from("v_expense_list")
    .select("*")
    .eq("company_id", companyId)
    .eq("month", monthToDate(month))
    .order("category_sort_order")
    .order("created_at");
  if (error) throw error;
  return data ?? [];
}

/** その月のカテゴリ別の経費合計 */
export async function loadExpenseSummary(supabase: ServerSupabase, companyId: string, month: string): Promise<ExpenseSummaryRow[]> {
  const { data, error } = await supabase
    .from("v_expense_summary")
    .select("*")
    .eq("company_id", companyId)
    .eq("month", monthToDate(month))
    .order("category_sort_order");
  if (error) throw error;
  return data ?? [];
}

/** 取引先（並び順） */
export async function loadClients(supabase: ServerSupabase, companyId: string, opts: { activeOnly?: boolean } = {}): Promise<Client[]> {
  let q = supabase.from("clients").select("*").eq("company_id", companyId).order("sort_order").order("name");
  if (opts.activeOnly) q = q.eq("is_active", true);
  const { data, error } = await q;
  if (error) throw error;
  return data ?? [];
}

/** 案件 × 月の損益（直課した経費を含む） */
export async function loadProjectPl(supabase: ServerSupabase, companyId: string, month: string): Promise<ProjectPl[]> {
  const { data, error } = await supabase
    .from("v_project_pl")
    .select("*")
    .eq("company_id", companyId)
    .eq("month", monthToDate(month))
    .order("project_sort_order")
    .order("project_name");
  if (error) throw error;
  return data ?? [];
}

/** 期間内（from 〜 to、いずれも "YYYY-MM"）の案件 × 月の損益 */
export async function loadProjectPlRange(supabase: ServerSupabase, companyId: string, from: string, to: string): Promise<ProjectPl[]> {
  const { data, error } = await supabase
    .from("v_project_pl")
    .select("*")
    .eq("company_id", companyId)
    .gte("month", monthToDate(from))
    .lte("month", monthToDate(to))
    .order("month")
    .order("project_sort_order");
  if (error) throw error;
  return data ?? [];
}

/** 資金繰り（入金予定・支払予定・経費）。日付は "YYYY-MM-DD" */
export async function loadCashForecast(supabase: ServerSupabase, from: string, to: string): Promise<CashEvent[]> {
  const { data, error } = await supabase.rpc("cash_forecast", { p_from: from, p_to: to });
  if (error) throw error;
  return data ?? [];
}

/** 現金残高のスナップショット（新しい順） */
export async function loadCashSnapshots(supabase: ServerSupabase, companyId: string, limit = 12): Promise<CashSnapshot[]> {
  const { data, error } = await supabase.from("cash_snapshots").select("*").eq("company_id", companyId).order("as_of", { ascending: false }).limit(limit);
  if (error) throw error;
  return data ?? [];
}

/** スタッフ一覧（チャットの宛先・メンション候補） */
export async function loadStaff(supabase: ServerSupabase, opts: { activeOnly?: boolean } = {}): Promise<StaffRow[]> {
  let q = supabase.from("v_staff").select("*").order("role").order("display_name");
  if (opts.activeOnly) q = q.eq("is_active", true);
  const { data, error } = await q;
  if (error) throw error;
  return data ?? [];
}

/** 社内チャットのルーム一覧（未読件数つき） */
export async function loadChatChannels(supabase: ServerSupabase, companyId: string): Promise<ChatChannelRow[]> {
  const { data, error } = await supabase
    .from("v_chat_channel_list")
    .select("*")
    .eq("company_id", companyId)
    .eq("is_active", true)
    .order("sort_order")
    .order("name");
  if (error) throw error;
  return data ?? [];
}

/** ルームの発言（古い順。limit 件の直近を返す） */
export async function loadChatMessages(supabase: ServerSupabase, channelId: string, limit = 100): Promise<ChatMessageRow[]> {
  const { data, error } = await supabase
    .from("v_chat_message_list")
    .select("*")
    .eq("channel_id", channelId)
    .order("created_at", { ascending: false })
    .limit(limit);
  if (error) throw error;
  return (data ?? []).slice().reverse();
}

/** 未読の合計（ナビのバッジ） */
export async function loadChatUnreadTotal(supabase: ServerSupabase): Promise<number> {
  const { data, error } = await supabase.rpc("chat_unread_total");
  if (error) return 0;
  return Number(data ?? 0);
}

/** AI チャットの会話一覧（新しい順） */
export async function loadAiConversations(supabase: ServerSupabase, companyId: string, limit = 30): Promise<AiConversationRow[]> {
  const { data, error } = await supabase
    .from("v_ai_conversation_list")
    .select("*")
    .eq("company_id", companyId)
    .order("last_message_at", { ascending: false })
    .limit(limit);
  if (error) throw error;
  return data ?? [];
}

/** AI チャットの発言（古い順） */
export async function loadAiMessages(supabase: ServerSupabase, conversationId: string): Promise<AiMessage[]> {
  const { data, error } = await supabase.from("ai_messages").select("*").eq("conversation_id", conversationId).order("created_at");
  if (error) throw error;
  return data ?? [];
}

/** アラート（既定は未対応のみ、重い順・新しい順） */
export async function loadAlerts(
  supabase: ServerSupabase,
  companyId: string,
  opts: { status?: AlertStatus | "all"; month?: string; limit?: number } = {},
): Promise<Alert[]> {
  let q = supabase.from("alerts").select("*").eq("company_id", companyId);
  if (opts.status !== "all") q = q.eq("status", opts.status ?? "open");
  if (opts.month) q = q.eq("month", monthToDate(opts.month));
  const { data, error } = await q.order("severity").order("detected_at", { ascending: false }).limit(opts.limit ?? 100);
  if (error) throw error;
  return data ?? [];
}

/** 未対応アラートの件数（会社 × 月） */
export async function loadAlertSummary(supabase: ServerSupabase, companyId: string, month: string): Promise<AlertSummaryRow | null> {
  const { data, error } = await supabase.from("v_alert_summary").select("*").eq("company_id", companyId).eq("month", monthToDate(month)).maybeSingle();
  if (error) return null;
  return data;
}

/** 外部連携の設定（機密は含まない） */
export async function loadIntegrations(supabase: ServerSupabase, companyId: string): Promise<Integration[]> {
  const { data, error } = await supabase.from("integrations").select("*").eq("company_id", companyId).order("kind");
  if (error) throw error;
  return data ?? [];
}

/** 外部連携の実行記録（新しい順） */
export async function loadIntegrationLogs(supabase: ServerSupabase, companyId: string, limit = 20): Promise<IntegrationLog[]> {
  const { data, error } = await supabase.from("integration_logs").select("*").eq("company_id", companyId).order("created_at", { ascending: false }).limit(limit);
  if (error) throw error;
  return data ?? [];
}

/** 銀行明細（消込先つき。既定は新しい順） */
export async function loadBankTransactions(
  supabase: ServerSupabase,
  companyId: string,
  opts: { status?: BankTxnStatus | "all"; limit?: number } = {},
): Promise<BankTransactionRow[]> {
  let q = supabase.from("v_bank_transaction_list").select("*").eq("company_id", companyId);
  if (opts.status && opts.status !== "all") q = q.eq("status", opts.status);
  const { data, error } = await q.order("txn_date", { ascending: false }).limit(opts.limit ?? 200);
  if (error) throw error;
  return data ?? [];
}

/** 銀行 CSV の取り込み履歴（新しい順） */
export async function loadBankImports(supabase: ServerSupabase, companyId: string, limit = 10): Promise<BankImport[]> {
  const { data, error } = await supabase.from("bank_imports").select("*").eq("company_id", companyId).order("created_at", { ascending: false }).limit(limit);
  if (error) throw error;
  return data ?? [];
}
