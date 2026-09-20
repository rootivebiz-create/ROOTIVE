/**
 * 移行・バックアップの共通型（§8.4 / §8.5）
 * - BackupJson: 本システムのバックアップ形式（export_backup() の出力と同じ。import_backup() に渡せる）
 * - MigratePreview: 取り込み前に画面で検算するための集計
 */
import type { Tables } from "@/lib/db/database.types";

export type BackupCompany = Partial<Tables<"companies">>;
/**
 * 0020 でドライバーの振込先口座は `driver_bank_accounts` へ移ったので口座の列は無い。
 * 古いバックアップ（0020 より前）の drivers には口座列が入っているが、
 * normalizeBackup は行をそのまま持ち越すので DB の import_backup が拾う（ここで落とさない）。
 */
export type BackupDriver = Omit<Tables<"drivers">, "created_at" | "updated_at"> & Partial<Pick<Tables<"drivers">, "created_at" | "updated_at">>;
export type BackupProject = Omit<Tables<"projects">, "created_at" | "updated_at"> & Partial<Pick<Tables<"projects">, "created_at" | "updated_at">>;
export type BackupProjectItem = Omit<Tables<"project_items">, "created_at" | "updated_at"> & Partial<Pick<Tables<"project_items">, "created_at" | "updated_at">>;
export type BackupPayOverride = Omit<Tables<"driver_pay_overrides">, "created_at" | "updated_at"> & Partial<Pick<Tables<"driver_pay_overrides">, "created_at" | "updated_at">>;
export type BackupRecurring = Omit<Tables<"driver_recurring_adjustments">, "created_at" | "updated_at"> & Partial<Pick<Tables<"driver_recurring_adjustments">, "created_at" | "updated_at">>;
export type BackupWorkEntry = Omit<Tables<"work_entries">, "created_at" | "updated_at" | "created_by" | "updated_by"> &
  Partial<Pick<Tables<"work_entries">, "created_at" | "updated_at" | "created_by" | "updated_by">>;
export type BackupDriverMonth = Omit<Tables<"driver_months">, "created_at" | "updated_at"> & Partial<Pick<Tables<"driver_months">, "created_at" | "updated_at">>;
export type BackupAdjustment = Omit<Tables<"adjustments">, "created_at" | "updated_at"> & Partial<Pick<Tables<"adjustments">, "created_at" | "updated_at">>;
export type BackupMonthClosing = Omit<Tables<"month_closings">, "created_at" | "updated_at" | "snapshot"> & Partial<Pick<Tables<"month_closings">, "created_at" | "updated_at">>;

export type BackupClient = Omit<Tables<"clients">, "created_at" | "updated_at"> & Partial<Pick<Tables<"clients">, "created_at" | "updated_at">>;
export type BackupExpenseCategory = Omit<Tables<"expense_categories">, "created_at" | "updated_at"> & Partial<Pick<Tables<"expense_categories">, "created_at" | "updated_at">>;
export type BackupRecurringExpense = Omit<Tables<"recurring_expenses">, "created_at" | "updated_at"> & Partial<Pick<Tables<"recurring_expenses">, "created_at" | "updated_at">>;
export type BackupExpense = Omit<Tables<"expenses">, "created_at" | "updated_at"> & Partial<Pick<Tables<"expenses">, "created_at" | "updated_at">>;
export type BackupInvoice = Omit<Tables<"invoices">, "created_at" | "updated_at"> & Partial<Pick<Tables<"invoices">, "created_at" | "updated_at">>;
export type BackupInvoiceItem = Omit<Tables<"invoice_items">, "created_at" | "updated_at"> & Partial<Pick<Tables<"invoice_items">, "created_at" | "updated_at">>;
export type BackupMonthTarget = Omit<Tables<"month_targets">, "created_at" | "updated_at"> & Partial<Pick<Tables<"month_targets">, "created_at" | "updated_at">>;

/**
 * 0010 以降に増えたテーブル。アプリは中身を読まず、そのまま import_backup に渡す
 * （復元の判断は DB 側の import_backup が行う。ここで落とすと復元で消えてしまう）
 */
export const PASSTHROUGH_BACKUP_TABLES = [
  "cash_snapshots",
  // 0020：ドライバーの振込先口座（drivers から分離）
  "driver_bank_accounts",
  "vehicles",
  "safety_managers",
  "documents",
  "daily_reports",
  "work_day_entries",
  "driver_instructions",
  "incidents",
  "import_profiles",
  "applicants",
  "applicant_events",
  "contracts",
  "tax_tasks",
  "loans",
  "loan_payments",
  "payment_notices",
  "payment_notice_items",
] as const;
export type PassthroughBackupTable = (typeof PASSTHROUGH_BACKUP_TABLES)[number];

export type BackupJson = {
  /** 1 = 0006 まで、2 = 0009、3 = 0010、4 = 0015、5 = 0018、6 = 0020。読み取りは番号を問わない */
  version: number;
  app: string;
  exported_at: string;
  company: BackupCompany | null;
  drivers: BackupDriver[];
  projects: BackupProject[];
  project_items: BackupProjectItem[];
  driver_pay_overrides: BackupPayOverride[];
  driver_recurring_adjustments: BackupRecurring[];
  work_entries: BackupWorkEntry[];
  driver_months: BackupDriverMonth[];
  adjustments: BackupAdjustment[];
  month_closings: BackupMonthClosing[];
  /** 0009 で追加。古いバックアップには無い */
  clients?: BackupClient[];
  expense_categories?: BackupExpenseCategory[];
  recurring_expenses?: BackupRecurringExpense[];
  expenses?: BackupExpense[];
  invoices?: BackupInvoice[];
  invoice_items?: BackupInvoiceItem[];
  month_targets?: BackupMonthTarget[];
} & { [K in PassthroughBackupTable]?: Record<string, unknown>[] };

export interface MigratePreviewMonth {
  month: string; // YYYY-MM
  entryCount: number;
  driverCount: number;
  bill: number;
  profit: number;
  payout: number;
  status: "open" | "closed";
}

export interface MigratePreview {
  format: "prototype" | "backup";
  counts: Record<string, number> & {
    drivers: number;
    projects: number;
    project_items: number;
    driver_pay_overrides: number;
    driver_recurring_adjustments: number;
    work_entries: number;
    driver_months: number;
    adjustments: number;
    month_closings: number;
    clients: number;
    expense_categories: number;
    recurring_expenses: number;
    expenses: number;
    invoices: number;
    invoice_items: number;
    month_targets: number;
  };
  months: MigratePreviewMonth[];
  totals: { bill: number; profit: number; payout: number };
  warnings: string[];
  companyName: string | null;
}

export type SourceFormat = "prototype" | "backup" | "unknown";
