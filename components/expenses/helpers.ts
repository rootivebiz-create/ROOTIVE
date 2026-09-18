/**
 * 経費画面の純関数ヘルパー（React に依存しない。テストからも使う）
 */
import type { ExpenseKind, ExpenseListRow, ExpenseSummaryRow } from "@/lib/db/types";
import type { TaxMode } from "@/lib/calc/types";
import { sumMoney } from "@/lib/calc";
import { dateToMonth } from "@/lib/month";

/** 画面で扱う経費の 1 行（ビューの null を正規化したもの） */
export interface ExpenseRow {
  id: string;
  month: string; // YYYY-MM
  categoryId: string;
  categoryName: string;
  kind: ExpenseKind;
  label: string;
  /** 税抜。マイナスは返金 */
  amount: number;
  taxMode: TaxMode;
  /** "" = 指定なし */
  incurredOn: string;
  driverId: string;
  driverName: string;
  projectId: string;
  projectName: string;
  vendor: string;
  memo: string;
  /** 「毎月かかる経費」から計上された行 */
  fromRecurring: boolean;
  closed: boolean;
  createdAt: string;
}

export function toExpenseRow(e: ExpenseListRow): ExpenseRow {
  return {
    id: e.id ?? "",
    month: e.month ? dateToMonth(e.month) : "",
    categoryId: e.category_id ?? "",
    categoryName: e.category_name ?? "",
    kind: (e.kind ?? "variable") as ExpenseKind,
    label: e.label ?? "",
    amount: Number(e.amount ?? 0),
    taxMode: (e.tax_mode ?? "taxable") as TaxMode,
    incurredOn: e.incurred_on ?? "",
    driverId: e.driver_id ?? "",
    driverName: e.driver_name ?? "",
    projectId: e.project_id ?? "",
    projectName: e.project_name ?? "",
    vendor: e.vendor ?? "",
    memo: e.memo ?? "",
    fromRecurring: e.recurring_id != null,
    closed: e.is_closed === true,
    createdAt: e.created_at ?? "",
  };
}

/** カテゴリ別の小計（DB ビュー v_expense_summary の 1 行） */
export interface CategoryTotal {
  categoryId: string;
  categoryName: string;
  kind: ExpenseKind;
  count: number;
  amount: number;
  /** 課税分の金額（税抜） */
  taxableAmount: number;
}

export function toCategoryTotal(r: ExpenseSummaryRow): CategoryTotal {
  return {
    categoryId: r.category_id ?? "",
    categoryName: r.category_name ?? "",
    kind: (r.kind ?? "variable") as ExpenseKind,
    count: Number(r.expense_count ?? 0),
    amount: Number(r.amount ?? 0),
    taxableAmount: Number(r.taxable_amount ?? 0),
  };
}

export interface ExpenseTotals {
  fixed: number;
  variable: number;
  total: number;
  count: number;
}

/** カテゴリ別小計（ビュー）から固定費・変動費・合計を求める */
export function totalsOf(categories: CategoryTotal[]): ExpenseTotals {
  return {
    fixed: sumMoney(categories.filter((c) => c.kind === "fixed").map((c) => c.amount)),
    variable: sumMoney(categories.filter((c) => c.kind === "variable").map((c) => c.amount)),
    total: sumMoney(categories.map((c) => c.amount)),
    count: categories.reduce((a, c) => a + c.count, 0),
  };
}

/** 検索（内容・カテゴリ・支払先・備考・ドライバー名・案件名の部分一致、大文字小文字を区別しない） */
export function matchesQuery(row: ExpenseRow, query: string): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  return [row.label, row.categoryName, row.vendor, row.memo, row.driverName, row.projectName].some((s) => s.toLowerCase().includes(q));
}

export function filterExpenses(rows: ExpenseRow[], categoryId: string, query: string): ExpenseRow[] {
  return rows.filter((r) => (!categoryId || r.categoryId === categoryId) && matchesQuery(r, query));
}

/** 発生日の表示（"2026-09-18" → "9/18"。未入力は "—"） */
export function shortDate(date: string): string {
  if (!date) return "—";
  const [, m, d] = date.split("-");
  if (!m || !d) return date;
  return `${Number(m)}/${Number(d)}`;
}

/** 選択肢（カテゴリ・ドライバー・案件） */
export interface ChoiceOption {
  id: string;
  name: string;
  is_active: boolean;
}

/** 選択肢は稼働中のみ。ただし選択中の項目が停止中ならそれだけ残す（編集時に値が消えないように） */
export function optionsWithSelected(options: ChoiceOption[], selectedId: string): ChoiceOption[] {
  const active = options.filter((o) => o.is_active);
  if (selectedId && !active.some((o) => o.id === selectedId)) {
    const selected = options.find((o) => o.id === selectedId);
    if (selected) return [...active, selected];
  }
  return active;
}
