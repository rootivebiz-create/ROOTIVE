/**
 * 移行・バックアップの共通型（§8.4 / §8.5）
 * - BackupJson: 本システムのバックアップ形式（export_backup() の出力と同じ。import_backup() に渡せる）
 * - MigratePreview: 取り込み前に画面で検算するための集計
 */
import type { Tables } from "@/lib/db/database.types";

export type BackupCompany = Partial<Tables<"companies">>;
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

export interface BackupJson {
  version: 1;
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
}

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
  counts: {
    drivers: number;
    projects: number;
    project_items: number;
    driver_pay_overrides: number;
    driver_recurring_adjustments: number;
    work_entries: number;
    driver_months: number;
    adjustments: number;
    month_closings: number;
  };
  months: MigratePreviewMonth[];
  totals: { bill: number; profit: number; payout: number };
  warnings: string[];
  companyName: string | null;
}

export type SourceFormat = "prototype" | "backup" | "unknown";
