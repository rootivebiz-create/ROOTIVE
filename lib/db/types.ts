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
export type BankAccountType = Enums<"bank_account_type">;
export type TaxTaskStatus = Enums<"tax_task_status">;
export type LoanStatus = Enums<"loan_status">;
export type NoticeStatus = Enums<"notice_status">;
export type DispatchStatus = Enums<"dispatch_status">;
export type DayOffStatus = Enums<"day_off_status">;

export type ProjectDemand = Tables<"project_demands">;
export type ProjectDemandDay = Tables<"project_demand_days">;
export type DriverDayOff = Tables<"driver_day_offs">;
export type DispatchAssignment = Tables<"dispatch_assignments">;
export type DispatchListRow = Views<"v_dispatch_list">;
export type DayOffListRow = Views<"v_day_off_list">;
export type DispatchOutlookRow = Views<"v_dispatch_outlook">;

/** 0024 法定帳票 */
export type AptitudeTest = Tables<"aptitude_tests">;
export type AptitudeKind = Enums<"aptitude_kind">;
export type DriverRosterRow = Views<"v_driver_roster">;
export type RecordRetentionRow = Views<"v_record_retention">;
export type ComplianceGapRow = Views<"v_compliance_gaps">;

/** 適性診断の種類 */
export const APTITUDE_KIND_LABELS: Record<AptitudeKind, string> = {
  initial: "初任診断",
  age: "適齢診断",
  specific: "特定診断",
  general: "一般診断",
};


/** 監査で足りないもの（v_compliance_gaps.kind） */
export const COMPLIANCE_GAP_LABELS: Record<string, string> = {
  roster_incomplete: "運転者台帳の記入漏れ",
  license_missing: "運転免許証の記録なし",
  initial_instruction_missing: "初任の指導なし",
  initial_aptitude_missing: "初任診断なし",
  instruction_overdue: "指導が 1 年以上なし",
  health_check_overdue: "健康診断が期限切れ",
  age_aptitude_missing: "適齢診断なし",
};
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
export type TaxTask = Tables<"tax_tasks">;
export type Loan = Tables<"loans">;
export type LoanPayment = Tables<"loan_payments">;
export type PaymentNotice = Tables<"payment_notices">;
export type PaymentNoticeItem = Tables<"payment_notice_items">;

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
export type MonthKpi = Views<"v_month_kpi">;
export type LoanRow = Views<"v_loan_list">;
export type LoanPaymentRow = Views<"v_loan_payment_list">;
export type TaxTaskRow = Views<"v_tax_task_list">;
export type DailyLaborRow = Views<"v_daily_labor">;
export type DriverMonthLaborRow = Views<"v_driver_month_labor">;
export type PaymentNoticeRow = Views<"v_payment_notice_list">;
export type PaymentNoticeDiffRow = Views<"v_payment_notice_diff">;

/** ドライバーの「今日の報告」で選べる案件内容（RPC driver_day_items の 1 行） */
export type DriverDayItem = Database["public"]["Functions"]["driver_day_items"]["Returns"][number];

/** 資金繰りの 1 件（RPC cash_forecast の 1 行） */
export type CashEvent = Database["public"]["Functions"]["cash_forecast"]["Returns"][number];

/** 資金繰りの種別 */
export const CASH_KIND_LABELS: Record<string, string> = {
  invoice: "入金",
  payout: "ドライバー支払",
  expense: "経費",
  loan: "借入の返済",
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
/** 配車の状態 */
export const DISPATCH_STATUS_LABELS: Record<DispatchStatus, string> = {
  planned: "予定",
  confirmed: "確定",
  cancelled: "取り消し",
};

/** 休み希望の状態 */
export const DAY_OFF_STATUS_LABELS: Record<DayOffStatus, string> = {
  requested: "申請中",
  approved: "承認",
  rejected: "見送り",
};

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

/** 口座の種別（全銀の区分：普通 1・当座 2・貯蓄 4） */
export const BANK_ACCOUNT_TYPES: BankAccountType[] = ["ordinary", "checking", "savings"];
export const BANK_ACCOUNT_TYPE_LABELS: Record<BankAccountType, string> = {
  ordinary: "普通",
  checking: "当座",
  savings: "貯蓄",
};
/** 全銀フォーマットの預金種目コード */
export const BANK_ACCOUNT_TYPE_CODES: Record<BankAccountType, string> = {
  ordinary: "1",
  checking: "2",
  savings: "4",
};

/** 税務・決算の期限の状態 */
export const TAX_TASK_STATUS_LABELS: Record<TaxTaskStatus, string> = {
  todo: "未対応",
  done: "対応済み",
  skipped: "対象外",
};

/** 期限の緊急度（v_tax_task_list.urgency） */
export const TAX_URGENCY_LABELS: Record<string, string> = {
  overdue: "期限切れ",
  soon: "まもなく",
  future: "先の予定",
  done: "済",
};

/** 借入の状態 */
export const LOAN_STATUS_LABELS: Record<LoanStatus, string> = {
  active: "返済中",
  paid: "完済",
  planned: "予定",
};

/** 支払通知書の状態 */
export const NOTICE_STATUS_LABELS: Record<NoticeStatus, string> = {
  received: "受領",
  checked: "確認済み",
  resolved: "解決済み",
};

/** 労務の判定（v_daily_labor の duty_status / rest_status / break_status） */
export const LABOR_DUTY_LABELS: Record<string, string> = {
  ok: "問題なし",
  over: "長い",
  severe: "かなり長い",
  unknown: "時刻の記録なし",
};
export const LABOR_REST_LABELS: Record<string, string> = {
  ok: "問題なし",
  short: "やや短い",
  severe: "不足",
  unknown: "前の稼働なし",
};
export const LABOR_BREAK_LABELS: Record<string, string> = {
  ok: "問題なし",
  short: "不足",
  unknown: "時刻の記録なし",
};

/** 支払通知と自社の売上の差（v_payment_notice_diff.diff_status） */
export const NOTICE_DIFF_LABELS: Record<string, string> = {
  ok: "一致",
  notice_more: "通知のほうが多い",
  notice_less: "通知のほうが少ない",
  unmatched: "案件内容が未紐づけ",
};

// =============================================================================
// 0019・0020 代表（Executive）
// =============================================================================
export type ApprovalKind = Enums<"approval_kind">;
export type ApprovalStatus = Enums<"approval_status">;
export type DecisionStatus = Enums<"decision_status">;
export type LoginEventKind = Enums<"login_event_kind">;

export type Approval = Tables<"approvals">;
export type ApprovalRule = Tables<"approval_rules">;
export type ApprovalDelegation = Tables<"approval_delegations">;
export type Decision = Tables<"decisions">;
export type CompanyProfile = Tables<"company_profile">;
export type Officer = Tables<"officers">;
export type Shareholder = Tables<"shareholders">;
export type InsurancePolicy = Tables<"insurance_policies">;
export type Advisor = Tables<"advisors">;
export type Guarantee = Tables<"guarantees">;
export type Plan = Tables<"plans">;
export type PlanYear = Tables<"plan_years">;
export type LoginEvent = Tables<"login_events">;
export type ExportLog = Tables<"export_logs">;
export type DriverBankAccount = Tables<"driver_bank_accounts">;

export type ApprovalRow = Views<"v_approval_list">;
export type PlanYearActual = Views<"v_plan_year_actual">;
export type ExecutiveTask = Views<"v_executive_tasks">;
export type ExecutiveSummary = Views<"v_executive_summary">;
export type DelegationRow = Views<"v_active_delegation">;
export type ExportLogRow = Views<"v_export_log_list">;
export type DriverBankRow = Views<"v_driver_bank">;

/** 決裁が要る操作の種別 */
export const APPROVAL_KIND_LABELS: Record<ApprovalKind, string> = {
  expense: "経費",
  rate_change: "単価の変更",
  project: "案件・取引先",
  contract: "契約",
  loan: "借入",
  month_reopen: "締めた月の解除",
  payout: "支払",
  purchase: "購入",
  hire: "採用",
  other: "その他",
};

/** 決裁の状態 */
export const APPROVAL_STATUS_LABELS: Record<ApprovalStatus, string> = {
  pending: "決裁待ち",
  approved: "承認",
  rejected: "却下",
  withdrawn: "取り下げ",
};

/** 決裁の急ぎぐあい（v_approval_list.urgency） */
export const APPROVAL_URGENCY_LABELS: Record<string, string> = {
  overdue: "期限切れ",
  stale: "滞留",
  waiting: "待ち",
  done: "決裁済み",
};

/** 意思決定ログの状態 */
export const DECISION_STATUS_LABELS: Record<DecisionStatus, string> = {
  open: "見直し前",
  reviewed: "振り返り済み",
  dropped: "取りやめ",
};

/** 代表がいま見るべきことの種別（v_executive_tasks.kind） */
export const EXECUTIVE_TASK_LABELS: Record<string, string> = {
  approval: "決裁",
  decision_review: "意思決定の見直し",
  insurance_expiry: "保険の満了",
  officer_term: "役員の任期",
  delegation_end: "委任の期限",
};

/** ログインの記録の種別 */
export const LOGIN_EVENT_LABELS: Record<LoginEventKind, string> = {
  login: "ログイン",
  logout: "ログアウト",
  invite: "招待の受諾",
};

/** 持ち出し（出力）の種別 */
export const EXPORT_KIND_LABELS: Record<string, string> = {
  entries: "稼働 CSV",
  payouts: "支払一覧",
  statement: "支払明細 PDF",
  statements: "支払明細の一括 PDF",
  transfer: "振込データ（全銀）",
  backup: "バックアップ JSON",
  drivers: "ドライバー一覧",
  expenses: "経費 CSV",
  invoices: "請求 CSV",
  rates: "単価表 CSV",
  records: "書類の索引簿",
  "month-pack": "月次パック ZIP",
  roster: "運転者台帳",
  compliance: "法定帳票（指導・事故・診断）",
  report: "月次レポート PDF",
  other: "その他",
};

/** 機密の見せ方（companies.confidential_scope の値） */
export type ConfidentialLevel = "owner" | "admin" | "staff";
export const CONFIDENTIAL_LEVEL_LABELS: Record<ConfidentialLevel, string> = {
  owner: "代表のみ",
  admin: "管理者まで",
  staff: "閲覧者まで",
};
export const CONFIDENTIAL_KEY_LABELS: Record<string, string> = {
  loans: "借入と納税",
  cash: "現金残高と資金繰り",
  bank_account: "ドライバーの振込口座",
};
export type ConfidentialScope = { loans: ConfidentialLevel; cash: ConfidentialLevel; bank_account: ConfidentialLevel };
export const DEFAULT_CONFIDENTIAL_SCOPE: ConfidentialScope = { loans: "admin", cash: "admin", bank_account: "admin" };

/** companies.confidential_scope（jsonb）を型のある形に直す */
export function toConfidentialScope(value: unknown): ConfidentialScope {
  const levels: ConfidentialLevel[] = ["owner", "admin", "staff"];
  const pick = (key: keyof ConfidentialScope): ConfidentialLevel => {
    const raw = value && typeof value === "object" ? (value as Record<string, unknown>)[key] : undefined;
    return typeof raw === "string" && (levels as string[]).includes(raw) ? (raw as ConfidentialLevel) : DEFAULT_CONFIDENTIAL_SCOPE[key];
  };
  return { loans: pick("loans"), cash: pick("cash"), bank_account: pick("bank_account") };
}

/** その機密をこのロールが見てよいか（DB の can_see_confidential と同じ判定） */
export function canSeeConfidential(role: Role, scope: ConfidentialScope, key: keyof ConfidentialScope): boolean {
  if (role === "owner") return true;
  if (role === "driver") return false;
  const level = scope[key];
  if (level === "staff") return true;
  if (level === "admin") return role === "admin";
  return false;
}
