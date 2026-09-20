import { z } from "zod";

/**
 * 設定 › データ／監査ログ 用のスキーマ（§4.5-6、§4.5-7、§8.4、§8.5、§8.6）
 */

/** 取り込み JSON の上限（文字数）。Server Action の bodySizeLimit（20mb）内に収める */
export const MAX_IMPORT_JSON_CHARS = 15_000_000;
/** ファイル選択時の上限（バイト）。上と同じ目安 */
export const MAX_IMPORT_FILE_BYTES = 15 * 1024 * 1024;

export const importJsonTextSchema = z
  .string({ error: "JSON ファイルを選択してください" })
  .min(2, "ファイルが空です")
  .max(MAX_IMPORT_JSON_CHARS, "ファイルが大きすぎます（15MB 以内にしてください）");

export const seedInitialDataSchema = z.object({
  withEntries: z.boolean({ error: "指定が不正です" }),
});

export const resetCompanyDataSchema = z.object({
  companyName: z.string({ error: "会社名を入力してください" }).trim().min(1, "会社名を入力してください").max(100, "会社名が長すぎます"),
});

/** 監査ログのフィルタ対象テーブル（`company` は RPC の取り込み・全削除が記録するテーブル名） */
export const AUDIT_TABLES = [
  "drivers",
  "projects",
  "project_items",
  "driver_pay_overrides",
  "driver_recurring_adjustments",
  "work_entries",
  "driver_months",
  "adjustments",
  "month_closings",
  "companies",
  "profiles",
  "invitations",
  "company",
  "clients",
  "expenses",
  "recurring_expenses",
  "invoices",
  "invoice_items",
  "month_targets",
  "cash_snapshots",
  "vehicles",
  "documents",
  "daily_reports",
  "work_day_entries",
  "safety_managers",
  "driver_instructions",
  "incidents",
  "applicants",
  "contracts",
  "import_profiles",
  "tax_tasks",
  "loans",
  "loan_payments",
  "payment_notices",
  "payment_notice_items",
] as const;
export type AuditTable = (typeof AUDIT_TABLES)[number];

export const AUDIT_ACTIONS = ["INSERT", "UPDATE", "DELETE", "close_month", "reopen_month", "import_backup", "reset_company_data"] as const;
export type AuditAction = (typeof AUDIT_ACTIONS)[number];

export const AUDIT_PAGE_SIZE = 50;

/** URL クエリ（配列や空文字は未指定扱い） */
const first = (v: unknown) => (Array.isArray(v) ? v[0] : v);
const optionalEnum = <T extends readonly [string, ...string[]]>(values: T) =>
  z.preprocess((v) => {
    const s = first(v);
    return s === "" || s == null ? undefined : s;
  }, z.enum(values).optional().catch(undefined));

export const auditQuerySchema = z.object({
  table: optionalEnum(AUDIT_TABLES),
  action: optionalEnum(AUDIT_ACTIONS),
  page: z.preprocess(first, z.coerce.number().int().min(1).max(100_000).catch(1)),
});

export interface AuditQuery {
  table?: AuditTable;
  action?: AuditAction;
  page: number;
}

/** searchParams（?table=&action=&page=）を安全に解釈する。不正値は既定に戻す */
export function parseAuditQuery(sp: Record<string, string | string[] | undefined>): AuditQuery {
  const r = auditQuerySchema.safeParse({ table: sp.table, action: sp.action, page: sp.page });
  if (r.success) return { table: r.data.table, action: r.data.action, page: r.data.page };
  return { page: 1 };
}
