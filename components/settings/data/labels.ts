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
] as const;

export function tableLabel(key: string): string {
  return BACKUP_TABLE_LABELS[key] ?? key;
}

/** { drivers: 10, projects: 7 } → "ドライバー 10 件、案件 7 件" */
export function countsText(counts: Record<string, number>): string {
  const keys = [...BACKUP_COUNT_ORDER.filter((k) => k in counts), ...Object.keys(counts).filter((k) => !(BACKUP_COUNT_ORDER as readonly string[]).includes(k))];
  return keys.map((k) => `${tableLabel(k)} ${counts[k]} 件`).join("、");
}
