import type { Database, Tables, Views, Enums } from "./database.types";

export type { Database, Tables, Views, Enums };

export type Role = Enums<"user_role">;
export type RoundingMode = Enums<"rounding_mode">;
export type Unit = Enums<"item_unit">;
export type MonthStatus = Enums<"month_status">;
export type ExpenseKind = Enums<"expense_kind">;
export type InvoiceStatus = Enums<"invoice_status">;
export type AlertStatus = Enums<"alert_status">;
export type AlertSeverity = Enums<"alert_severity">;
export type IntegrationKind = Enums<"integration_kind">;
export type BankTxnStatus = Enums<"bank_txn_status">;
export type DocumentKind = Enums<"document_kind">;
export type RollCallMethod = Enums<"roll_call_method">;
export type DayEntryStatus = Enums<"day_entry_status">;
export type EntrySource = Enums<"entry_source">;
export type VehicleOwnership = Enums<"vehicle_ownership">;
export type IncidentKind = Enums<"incident_kind">;
export type ApplicantStage = Enums<"applicant_stage">;
export type ContractStatus = Enums<"contract_status">;

export type Company = Tables<"companies">;
export type Profile = Tables<"profiles">;
export type Invitation = Tables<"invitations">;
export type Driver = Tables<"drivers">;
export type Project = Tables<"projects">;
export type ProjectItem = Tables<"project_items">;
export type DriverPayOverride = Tables<"driver_pay_overrides">;
export type DriverRecurringAdjustment = Tables<"driver_recurring_adjustments">;
export type WorkEntry = Tables<"work_entries">;
export type DriverMonth = Tables<"driver_months">;
export type Adjustment = Tables<"adjustments">;
export type MonthClosing = Tables<"month_closings">;
export type AuditLog = Tables<"audit_logs">;
export type AiInsight = Tables<"ai_insights">;
export type Client = Tables<"clients">;
export type ExpenseCategory = Tables<"expense_categories">;
export type RecurringExpense = Tables<"recurring_expenses">;
export type Expense = Tables<"expenses">;
export type Invoice = Tables<"invoices">;
export type InvoiceItem = Tables<"invoice_items">;
export type MonthTarget = Tables<"month_targets">;
export type CashSnapshot = Tables<"cash_snapshots">;
export type AiConversation = Tables<"ai_conversations">;
export type AiMessage = Tables<"ai_messages">;
export type ChatChannel = Tables<"chat_channels">;
export type ChatMessage = Tables<"chat_messages">;
export type Alert = Tables<"alerts">;
export type Integration = Tables<"integrations">;
export type IntegrationLog = Tables<"integration_logs">;
export type BankImport = Tables<"bank_imports">;
export type BankTransaction = Tables<"bank_transactions">;
export type Vehicle = Tables<"vehicles">;
export type DocumentRow = Tables<"documents">;
export type DailyReport = Tables<"daily_reports">;
export type WorkDayEntry = Tables<"work_day_entries">;
export type SafetyManager = Tables<"safety_managers">;
export type DriverInstruction = Tables<"driver_instructions">;
export type Incident = Tables<"incidents">;
export type ImportProfile = Tables<"import_profiles">;
export type ImportRun = Tables<"import_runs">;
export type Applicant = Tables<"applicants">;
export type ApplicantEvent = Tables<"applicant_events">;
export type Contract = Tables<"contracts">;

export type WorkEntryCalc = Views<"v_work_entry_calc">;
export type DriverMonthSummary = Views<"v_driver_month_summary">;
export type MonthSummary = Views<"v_month_summary">;
export type ProjectSummary = Views<"v_project_summary">;
export type MonthListRow = Views<"v_month_list">;
export type ExpenseListRow = Views<"v_expense_list">;
export type ExpenseSummaryRow = Views<"v_expense_summary">;
export type RecurringExpenseRow = Views<"v_recurring_expense_list">;
export type MonthPl = Views<"v_month_pl">;
export type ClientMonthSummary = Views<"v_client_month_summary">;
export type InvoiceListRow = Views<"v_invoice_list">;
export type ProjectPl = Views<"v_project_pl">;
export type StaffRow = Views<"v_staff">;
export type ChatChannelRow = Views<"v_chat_channel_list">;
export type ChatMessageRow = Views<"v_chat_message_list">;
export type AiConversationRow = Views<"v_ai_conversation_list">;
export type AlertSummaryRow = Views<"v_alert_summary">;
export type BankTransactionRow = Views<"v_bank_transaction_list">;
export type VehicleRow = Views<"v_vehicle_list">;
export type DocumentListRow = Views<"v_document_list">;
export type DailyReportRow = Views<"v_daily_report_list">;
export type WorkDayEntryRow = Views<"v_work_day_entry_list">;
export type DayStatusRow = Views<"v_day_status">;
export type ApplicantRow = Views<"v_applicant_list">;
export type ContractRow = Views<"v_contract_list">;
export type ImportProfileRow = Views<"v_import_profile_list">;

/** ドライバーの「今日の報告」で選べる案件内容（RPC driver_day_items の 1 行） */
export type DriverDayItem = Database["public"]["Functions"]["driver_day_items"]["Returns"][number];

/** 資金繰りの 1 件（RPC cash_forecast の 1 行） */
export type CashEvent = Database["public"]["Functions"]["cash_forecast"]["Returns"][number];

/** 資金繰りの種別 */
export const CASH_KIND_LABELS: Record<string, string> = {
  invoice: "入金",
  payout: "ドライバー支払",
  expense: "経費",
};

/** 資金繰りの状態 */
export const CASH_STATUS_LABELS: Record<string, string> = {
  planned: "予定",
  confirmed: "確定",
  done: "実績",
};

/** 稼働行のスナップショットと現在のマスタの差分（RPC rate_diffs の 1 行） */
export type RateDiff = Database["public"]["Functions"]["rate_diffs"]["Returns"][number];

export const ROLE_LABELS: Record<Role, string> = {
  owner: "オーナー",
  admin: "管理者",
  viewer: "閲覧者",
  driver: "ドライバー",
};

/** 経費カテゴリの区分 */
export const EXPENSE_KINDS: ExpenseKind[] = ["fixed", "variable"];
export const EXPENSE_KIND_LABELS: Record<ExpenseKind, string> = {
  fixed: "固定費",
  variable: "変動費",
};

/** 請求書の状態 */
export const INVOICE_STATUSES: InvoiceStatus[] = ["draft", "issued", "paid"];
export const INVOICE_STATUS_LABELS: Record<InvoiceStatus, string> = {
  draft: "下書き",
  issued: "発行済み",
  paid: "入金済み",
};

/** アラートの状態 */
export const ALERT_STATUSES: AlertStatus[] = ["open", "resolved", "ignored"];
export const ALERT_STATUS_LABELS: Record<AlertStatus, string> = {
  open: "未対応",
  resolved: "対応済み",
  ignored: "対象外",
};

/** アラートの重さ */
export const ALERT_SEVERITY_LABELS: Record<AlertSeverity, string> = {
  high: "重要",
  medium: "注意",
  low: "参考",
};

/** 外部連携の種類 */
export const INTEGRATION_KIND_LABELS: Record<IntegrationKind, string> = {
  line: "LINE 公式アカウント",
  google_drive: "Google ドライブ",
  bank: "銀行 CSV",
};

/** 銀行明細の消込状態 */
export const BANK_TXN_STATUS_LABELS: Record<BankTxnStatus, string> = {
  unmatched: "未消込",
  matched: "消込済み",
  ignored: "対象外",
};

/** 書類の種類 */
export const DOCUMENT_KINDS: DocumentKind[] = [
  "license",
  "vehicle_inspection",
  "compulsory_insurance",
  "voluntary_insurance",
  "health_check",
  "safety_training",
  "contract",
  "other",
];
export const DOCUMENT_KIND_LABELS: Record<DocumentKind, string> = {
  license: "運転免許証",
  vehicle_inspection: "車検証",
  compulsory_insurance: "自賠責保険",
  voluntary_insurance: "任意保険",
  health_check: "健康診断",
  safety_training: "安全管理者講習",
  contract: "契約書",
  other: "その他",
};

/** 書類の期限の状態（v_document_list.expiry_status） */
export const EXPIRY_STATUS_LABELS: Record<string, string> = {
  expired: "期限切れ",
  soon: "まもなく期限",
  valid: "有効",
  none: "期限なし",
};

/** 点呼の方法 */
export const ROLL_CALL_METHOD_LABELS: Record<RollCallMethod, string> = {
  face: "対面",
  phone: "電話",
  video: "ビデオ通話",
  app: "アプリ",
};

/** 日別の稼働の状態 */
export const DAY_ENTRY_STATUSES: DayEntryStatus[] = ["submitted", "approved", "rejected"];
export const DAY_ENTRY_STATUS_LABELS: Record<DayEntryStatus, string> = {
  submitted: "承認待ち",
  approved: "承認済み",
  rejected: "差戻し",
};

/** 稼働の入力元 */
export const ENTRY_SOURCE_LABELS: Record<EntrySource, string> = {
  staff: "スタッフ入力",
  driver: "ドライバー報告",
  import: "ファイル取り込み",
  line: "LINE",
};

/** 車両の所有区分 */
export const VEHICLE_OWNERSHIP_LABELS: Record<VehicleOwnership, string> = {
  owned: "自社所有",
  lease: "リース",
  driver: "ドライバー持ち込み",
};

/** 事故の種類 */
export const INCIDENT_KIND_LABELS: Record<IncidentKind, string> = {
  accident: "事故",
  violation: "違反",
  near_miss: "ヒヤリハット",
};

/** 指導・監督の種類 */
export const INSTRUCTION_KIND_LABELS: Record<string, string> = {
  initial: "初任運転者",
  regular: "定期",
  accident: "事故後",
  elderly: "高齢運転者",
  special: "特別",
};

/** 採用の段階 */
export const APPLICANT_STAGES: ApplicantStage[] = ["applied", "contacted", "interview", "docs", "contract", "started", "declined", "rejected"];
export const APPLICANT_STAGE_LABELS: Record<ApplicantStage, string> = {
  applied: "応募",
  contacted: "連絡済み",
  interview: "面談",
  docs: "書類",
  contract: "契約",
  started: "稼働開始",
  declined: "辞退",
  rejected: "見送り",
};

/** 契約の状態 */
export const CONTRACT_STATUS_LABELS: Record<ContractStatus, string> = {
  draft: "下書き",
  active: "有効",
  ended: "終了",
};

/** 契約の期間の状態（v_contract_list.period_status） */
export const CONTRACT_PERIOD_LABELS: Record<string, string> = {
  active: "期間内",
  renewal: "更新時期",
  expired: "期間切れ",
  open: "期限なし",
  ended: "終了",
};

/** 案件 ＋ 内容（マスタ読み込み用） */
export type ProjectWithItems = Project & { items: ProjectItem[] };

/** 稼働入力ダイアログなどで使うマスタ一式 */
export interface Masters {
  company: Company;
  drivers: Driver[];
  projects: ProjectWithItems[];
  overrides: DriverPayOverride[];
}
