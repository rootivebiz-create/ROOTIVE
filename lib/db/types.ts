import type { Database, Tables, Views, Enums } from "./database.types";

export type { Database, Tables, Views, Enums };

export type Role = Enums<"user_role">;
export type RoundingMode = Enums<"rounding_mode">;
export type Unit = Enums<"item_unit">;
export type MonthStatus = Enums<"month_status">;
export type ExpenseKind = Enums<"expense_kind">;
export type InvoiceStatus = Enums<"invoice_status">;

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

/** 案件 ＋ 内容（マスタ読み込み用） */
export type ProjectWithItems = Project & { items: ProjectItem[] };

/** 稼働入力ダイアログなどで使うマスタ一式 */
export interface Masters {
  company: Company;
  drivers: Driver[];
  projects: ProjectWithItems[];
  overrides: DriverPayOverride[];
}
