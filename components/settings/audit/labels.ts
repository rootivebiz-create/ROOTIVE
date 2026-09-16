import { ROLE_LABELS } from "@/lib/db/types";
import { AUDIT_ACTIONS, AUDIT_TABLES, type AuditAction, type AuditTable } from "@/lib/schemas/data";
import { BACKUP_TABLE_LABELS } from "@/components/settings/data/labels";

/** テーブル名 → 日本語名 */
export const TABLE_LABELS: Record<string, string> = {
  ...BACKUP_TABLE_LABELS,
  companies: "会社設定",
  company: "会社データ",
  profiles: "ユーザー",
  invitations: "招待",
};

/** 操作 → 日本語名 */
export const ACTION_LABELS: Record<string, string> = {
  INSERT: "追加",
  UPDATE: "更新",
  DELETE: "削除",
  close_month: "月締め",
  reopen_month: "締め解除",
  import_backup: "取り込み・復元",
  reset_company_data: "データ全削除",
};

/** 列名（キー）→ 日本語名。主要なものだけ。未定義はキー名のまま表示する */
export const KEY_LABELS: Record<string, string> = {
  id: "ID",
  company_id: "会社 ID",
  name: "名前",
  kana: "かな",
  label: "項目名",
  qty: "数量",
  bill_rate: "受注単価",
  pay_rate: "支払単価",
  royalty_rate: "ロイヤリティ率",
  mgmt_fee: "管理費",
  amount: "金額",
  count_as_profit: "利益計上",
  is_active: "状態",
  rounding_mode: "端数処理",
  memo: "メモ",
  month: "稼動月",
  driver_id: "ドライバー",
  project_id: "案件",
  project_item_id: "案件内容",
  driver_month_id: "ドライバー月",
  recurring_id: "固定控除",
  unit: "区分",
  client_name: "荷主・元請",
  sort_order: "並び順",
  phone: "電話",
  email: "メール",
  bank_info: "振込先メモ",
  status: "状態",
  note: "備考",
  closed_at: "締め日時",
  closed_by: "締め実行者",
  reopened_at: "解除日時",
  reopened_by: "解除実行者",
  backup_path: "バックアップ",
  display_name: "表示名",
  role: "ロール",
  default_royalty_rate: "標準ロイヤリティ率",
  default_mgmt_fee: "標準管理費",
  payout_month_offset: "振込月（＋か月）",
  payout_day: "振込日（0＝末日）",
  statement_note: "明細の備考定型文",
  invoice_reg_no: "登録番号",
  address: "住所",
  tel: "電話",
  driver_portal_show_royalty: "ポータルでロイヤリティ率を表示",
  yayoi_accounts: "弥生の勘定科目",
  expires_at: "有効期限",
  accepted_at: "受諾日時",
  cancelled_at: "取消日時",
  link_used_at: "リンク使用日時",
  invited_by: "招待者",
  created_by: "作成者",
  updated_by: "更新者",
  created_at: "作成日時",
  updated_at: "更新日時",
  // 月締めスナップショットの集計（v_month_summary）
  entry_count: "件数",
  driver_count: "ドライバー数",
  active_driver_count: "稼働ドライバー数",
  bill: "会社売上",
  pay: "ドライバー売上",
  margin: "単価差額利益",
  royalty: "ロイヤリティ",
  adj_pay: "調整（支払）",
  adj_profit: "調整（利益）",
  payout: "支払合計",
  profit: "会社利益",
  profit_rate: "利益率",
  summary: "集計",
  entries: "稼働行",
};

export const ROUNDING_LABELS: Record<string, string> = { none: "丸めない", floor: "切り捨て", round: "四捨五入", ceil: "切り上げ" };
export const UNIT_LABELS: Record<string, string> = { day: "日給", piece: "個数" };
export const STATUS_LABELS: Record<string, string> = { open: "未締め", closed: "締め済み" };
export { ROLE_LABELS };

/** INSERT／DELETE の要約に出す主要項目（テーブル別） */
export const MAIN_KEYS: Record<string, string[]> = {
  drivers: ["name", "royalty_rate", "mgmt_fee", "rounding_mode", "is_active"],
  projects: ["name", "client_name", "is_active"],
  project_items: ["project_id", "name", "unit", "bill_rate", "pay_rate", "is_active"],
  driver_pay_overrides: ["driver_id", "project_item_id", "bill_rate", "pay_rate"],
  driver_recurring_adjustments: ["driver_id", "label", "amount", "count_as_profit", "is_active"],
  work_entries: ["month", "driver_id", "project_item_id", "qty", "bill_rate", "pay_rate", "royalty_rate", "memo"],
  driver_months: ["month", "driver_id", "mgmt_fee", "memo"],
  adjustments: ["label", "amount", "count_as_profit"],
  month_closings: ["month", "status", "closed_at", "note"],
  companies: ["name", "rounding_mode", "default_royalty_rate", "default_mgmt_fee"],
  profiles: ["email", "display_name", "role", "driver_id", "is_active"],
  invitations: ["email", "role", "display_name", "driver_id", "expires_at"],
};

/** 差分から除外する列（変更に意味が無いもの） */
export const HIDDEN_KEYS = new Set(["updated_at", "created_at", "id", "company_id"]);

export const MONEY_KEYS = new Set(["bill_rate", "pay_rate", "mgmt_fee", "amount", "default_mgmt_fee", "bill", "pay", "margin", "royalty", "adj_pay", "adj_profit", "payout", "profit"]);
export const RATE_KEYS = new Set(["royalty_rate", "default_royalty_rate", "profit_rate"]);
export const QTY_KEYS = new Set(["qty"]);
export const USER_KEYS = new Set(["created_by", "updated_by", "closed_by", "reopened_by", "invited_by"]);

/** フィルタ用の選択肢 */
export const TABLE_OPTIONS: { value: AuditTable; label: string }[] = AUDIT_TABLES.map((t) => ({ value: t, label: TABLE_LABELS[t] ?? t }));
export const ACTION_OPTIONS: { value: AuditAction; label: string }[] = AUDIT_ACTIONS.map((a) => ({ value: a, label: ACTION_LABELS[a] ?? a }));

export function keyLabel(key: string): string {
  return KEY_LABELS[key] ?? key;
}
export function tableLabel(table: string): string {
  return TABLE_LABELS[table] ?? table;
}
export function actionLabel(action: string): string {
  return ACTION_LABELS[action] ?? action;
}
