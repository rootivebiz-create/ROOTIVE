/** バックアップ JSON／RPC の件数キー → 日本語名（データ画面・監査ログで共用） */
export const BACKUP_TABLE_LABELS: Record<string, string> = {
  company: "会社",
  drivers: "ドライバー",
  projects: "案件",
  project_items: "案件内容",
  driver_pay_overrides: "ドライバー別単価",
  driver_recurring_adjustments: "固定控除",
  work_entries: "稼働行",
  entries: "稼働行",
  driver_months: "ドライバー月",
  adjustments: "調整",
  month_closings: "月締め",
  ai_insights: "AI 分析",
  clients: "取引先",
  expense_categories: "経費カテゴリ",
  recurring_expenses: "毎月かかる経費",
  expenses: "経費",
  invoices: "請求書",
  invoice_items: "請求明細",
  month_targets: "月次目標",
  cash_snapshots: "現金残高",
  vehicles: "車両",
  safety_managers: "安全管理者",
  documents: "書類と期限",
  daily_reports: "日報・点呼",
  work_day_entries: "日別の稼働",
  driver_instructions: "指導・監督",
  incidents: "事故・ヒヤリハット",
  import_profiles: "取り込みの定義",
  applicants: "応募者",
  applicant_events: "応募者のやりとり",
  contracts: "業務委託契約",
  tax_tasks: "決算・税務の期限",
  loans: "借入金",
  loan_payments: "返済予定",
  payment_notices: "元請の支払通知",
  payment_notice_items: "支払通知の明細",
};

/** 件数表の表示順 */
export const BACKUP_COUNT_ORDER = [
  "drivers",
  "projects",
  "project_items",
  "driver_pay_overrides",
  "driver_recurring_adjustments",
  "work_entries",
  "driver_months",
  "adjustments",
  "month_closings",
  "clients",
  "expense_categories",
  "recurring_expenses",
  "expenses",
  "invoices",
  "invoice_items",
  "month_targets",
  "cash_snapshots",
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

export function tableLabel(key: string): string {
  return BACKUP_TABLE_LABELS[key] ?? key;
}

/** { drivers: 10, projects: 7 } → "ドライバー 10 件、案件 7 件" */
export function countsText(counts: Record<string, number>): string {
  const keys = [...BACKUP_COUNT_ORDER.filter((k) => k in counts), ...Object.keys(counts).filter((k) => !(BACKUP_COUNT_ORDER as readonly string[]).includes(k))];
  return keys.map((k) => `${tableLabel(k)} ${counts[k]} 件`).join("、");
}
