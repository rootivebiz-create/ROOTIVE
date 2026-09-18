import { describe, expect, it } from "vitest";
import { CSV_BOM } from "@/lib/exports/csv";
import { EXPENSES_CSV_HEADERS, expenseToCsvRow, toExpensesCsv, type ExpenseCsvSource } from "@/lib/exports/expenses-csv";
import {
  EXPENSE_TAX_MODE_LABELS,
  expenseInputSchema,
  isDateString,
  recurringExpenseRowSchema,
  saveExpenseCategoriesSchema,
  saveRecurringExpensesSchema,
  type ExpenseCategoryRowInput,
  type ExpenseFormInput,
  type RecurringExpenseRowInput,
} from "@/lib/schemas/expenses";
import { filterExpenses, matchesQuery, optionsWithSelected, shortDate, toCategoryTotal, toExpenseRow, totalsOf, type ExpenseRow } from "@/components/expenses/helpers";
import type { ExpenseListRow, ExpenseSummaryRow } from "@/lib/db/types";

const COMPANY = "66666666-6666-4666-8666-666666666666";
const CATEGORY = "11111111-1111-4111-8111-111111111111";
const CATEGORY2 = "22222222-2222-4222-8222-222222222222";
const DRIVER = "33333333-3333-4333-8333-333333333333";
const PROJECT = "44444444-4444-4444-8444-444444444444";
const EXPENSE_ID = "55555555-5555-4555-8555-555555555555";

// ---------------------------------------------------------------------------
// CSV
// ---------------------------------------------------------------------------

const csvSource: ExpenseCsvSource = {
  month: "2026-09-01",
  category_name: "事務所家賃",
  kind: "fixed",
  label: "9 月分家賃",
  amount: 120000,
  tax_mode: "taxable",
  incurred_on: "2026-09-25",
  driver_name: "相曽慧",
  project_name: "三郷Amazon",
  vendor: "〇〇不動産",
  memo: "備考, あり",
};

describe("経費 CSV", () => {
  it("列並びは 稼動月 / カテゴリ / 区分 / 内容 / 金額 / 課税区分 / 発生日 / ドライバー / 案件 / 支払先 / 備考", () => {
    expect([...EXPENSES_CSV_HEADERS]).toEqual(["稼動月", "カテゴリ", "区分", "内容", "金額", "課税区分", "発生日", "ドライバー", "案件", "支払先", "備考"]);
  });

  it("ヘッダー行付き・BOM・CRLF で出力し、カンマを含むセルは引用符で囲む", () => {
    const csv = toExpensesCsv([csvSource]);
    expect(csv.startsWith(CSV_BOM)).toBe(true);
    const lines = csv.slice(1).split("\r\n");
    expect(lines[0]).toBe(EXPENSES_CSV_HEADERS.join(","));
    expect(lines[1]).toBe("2026-09,事務所家賃,固定費,9 月分家賃,120000,課税,2026-09-25,相曽慧,三郷Amazon,〇〇不動産,\"備考, あり\"");
    expect(lines[2]).toBe("");
  });

  it("稼動月は YYYY-MM、区分・課税区分は日本語、金額は生の値（カンマ無し・マイナス可）", () => {
    const row = expenseToCsvRow({ ...csvSource, kind: "variable", tax_mode: "exempt", amount: -5500.5, memo: "" });
    expect(row[0]).toBe("2026-09");
    expect(row[2]).toBe("変動費");
    expect(row[4]).toBe("-5500.5");
    expect(row[5]).toBe("対象外");
    expect(row.length).toBe(EXPENSES_CSV_HEADERS.length);
  });

  it("null の列は空文字、金額 null は 0", () => {
    const row = expenseToCsvRow({
      ...csvSource,
      month: null,
      category_name: null,
      kind: null,
      label: null,
      amount: null,
      tax_mode: null,
      incurred_on: null,
      driver_name: null,
      project_name: null,
      vendor: null,
      memo: null,
    });
    expect(row).toEqual(["", "", "", "", "0", "", "", "", "", "", ""]);
  });

  it("経費が 0 件でもヘッダー行だけの CSV になる", () => {
    expect(toExpensesCsv([])).toBe(`${CSV_BOM}${EXPENSES_CSV_HEADERS.join(",")}\r\n`);
  });
});

// ---------------------------------------------------------------------------
// 経費の入力スキーマ
// ---------------------------------------------------------------------------

const baseInput: ExpenseFormInput = {
  id: null,
  month: "2026-09",
  category_id: CATEGORY,
  label: "  9 月分家賃  ",
  amount: "120,000",
  tax_mode: "taxable",
  incurred_on: "2026-09-25",
  driver_id: "",
  project_id: "",
  vendor: " 〇〇不動産 ",
  memo: "  メモ  ",
};

describe("expenseInputSchema", () => {
  it("文字列のフォーム値を正規化する（カンマ・全角・¥・前後の空白）", () => {
    const v = expenseInputSchema.parse({ ...baseInput, amount: "１２０，０００", vendor: "〇〇不動産" });
    expect(v.amount).toBe(120000);
    expect(v.label).toBe("9 月分家賃");
    expect(v.vendor).toBe("〇〇不動産");
    expect(v.memo).toBe("メモ");
    expect(expenseInputSchema.parse({ ...baseInput, amount: "¥30,000" }).amount).toBe(30000);
    expect(expenseInputSchema.parse({ ...baseInput, amount: "1234.56" }).amount).toBe(1234.56);
  });

  it("金額はマイナス可（返金）、0 も可", () => {
    expect(expenseInputSchema.parse({ ...baseInput, amount: "-5000" }).amount).toBe(-5000);
    expect(expenseInputSchema.parse({ ...baseInput, amount: "0" }).amount).toBe(0);
  });

  it("空欄の任意項目は null になる（発生日・ドライバー・案件・id）", () => {
    const v = expenseInputSchema.parse({ ...baseInput, id: "", incurred_on: "", driver_id: "", project_id: "   ", vendor: "", memo: "" });
    expect(v.id).toBeNull();
    expect(v.incurred_on).toBeNull();
    expect(v.driver_id).toBeNull();
    expect(v.project_id).toBeNull();
    expect(v.vendor).toBe("");
    expect(v.memo).toBe("");
  });

  it("id・ドライバー・案件は指定すればそのまま通る", () => {
    const v = expenseInputSchema.parse({ ...baseInput, id: EXPENSE_ID, driver_id: DRIVER, project_id: PROJECT });
    expect(v).toMatchObject({ id: EXPENSE_ID, driver_id: DRIVER, project_id: PROJECT });
  });

  it("必須項目（内容・カテゴリ）が空なら拒否する", () => {
    const noLabel = expenseInputSchema.safeParse({ ...baseInput, label: "   " });
    expect(noLabel.success).toBe(false);
    if (!noLabel.success) expect(noLabel.error.issues[0]?.path).toEqual(["label"]);
    expect(expenseInputSchema.safeParse({ ...baseInput, label: "あ".repeat(101) }).success).toBe(false);
    const noCategory = expenseInputSchema.safeParse({ ...baseInput, category_id: "" });
    expect(noCategory.success).toBe(false);
    if (!noCategory.success) expect(noCategory.error.issues[0]?.message).toBe("カテゴリを選択してください");
  });

  it("稼動月は YYYY-MM のみ許容する", () => {
    expect(expenseInputSchema.safeParse({ ...baseInput, month: "2026-9" }).success).toBe(false);
    expect(expenseInputSchema.safeParse({ ...baseInput, month: "2026-13" }).success).toBe(false);
    expect(expenseInputSchema.safeParse({ ...baseInput, month: "2026-09-01" }).success).toBe(false);
    expect(expenseInputSchema.safeParse({ ...baseInput, month: "" }).success).toBe(false);
  });

  it("発生日は実在する YYYY-MM-DD のみ許容する", () => {
    expect(expenseInputSchema.parse({ ...baseInput, incurred_on: "2026-02-28" }).incurred_on).toBe("2026-02-28");
    expect(expenseInputSchema.safeParse({ ...baseInput, incurred_on: "2026-09-31" }).success).toBe(false);
    expect(expenseInputSchema.safeParse({ ...baseInput, incurred_on: "2026/09/18" }).success).toBe(false);
    expect(isDateString("2026-09-18")).toBe(true);
    expect(isDateString("2026-13-01")).toBe(false);
    expect(isDateString(null)).toBe(false);
  });

  it("金額の不正値（文字・小数 3 桁・空欄）を拒否する", () => {
    expect(expenseInputSchema.safeParse({ ...baseInput, amount: "abc" }).success).toBe(false);
    expect(expenseInputSchema.safeParse({ ...baseInput, amount: "1.234" }).success).toBe(false);
    expect(expenseInputSchema.safeParse({ ...baseInput, amount: "" }).success).toBe(false);
    expect(expenseInputSchema.safeParse({ ...baseInput, tax_mode: "none" }).success).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// 設定（カテゴリ・毎月かかる経費）のスキーマ
// ---------------------------------------------------------------------------

const categoryRow: ExpenseCategoryRowInput = { id: null, name: " 燃料費 ", kind: "variable", memo: "", is_active: true };

describe("saveExpenseCategoriesSchema", () => {
  it("名前を trim し、区分・停止中を検証する", () => {
    const v = saveExpenseCategoriesSchema.parse({ rows: [categoryRow, { ...categoryRow, id: CATEGORY, name: "事務所家賃", kind: "fixed", is_active: false }] });
    expect(v.rows[0]).toMatchObject({ id: null, name: "燃料費", kind: "variable", is_active: true });
    expect(v.rows[1]).toMatchObject({ id: CATEGORY, name: "事務所家賃", kind: "fixed", is_active: false });
  });

  it("名前が空・区分が不正・同名の重複は拒否する", () => {
    expect(saveExpenseCategoriesSchema.safeParse({ rows: [{ ...categoryRow, name: "  " }] }).success).toBe(false);
    expect(saveExpenseCategoriesSchema.safeParse({ rows: [{ ...categoryRow, kind: "other" }] }).success).toBe(false);
    const dup = saveExpenseCategoriesSchema.safeParse({ rows: [categoryRow, { ...categoryRow, name: "燃料費" }] });
    expect(dup.success).toBe(false);
    if (!dup.success) {
      expect(dup.error.issues[0]?.message).toBe("同じ名前のカテゴリがあります");
      expect(dup.error.issues[0]?.path).toEqual(["rows", 1, "name"]);
    }
  });
});

const recurringRow: RecurringExpenseRowInput = {
  id: null,
  category_id: CATEGORY,
  label: "事務所家賃",
  amount: "１２０，０００",
  tax_mode: "taxable",
  driver_id: "",
  project_id: "",
  vendor: "",
  start_month: "2026-04",
  end_month: "",
  is_active: true,
};

describe("saveRecurringExpensesSchema", () => {
  it("金額を正規化し、空欄の開始月・終了月は null（制限なし）になる", () => {
    const v = saveRecurringExpensesSchema.parse({ rows: [recurringRow, { ...recurringRow, start_month: "", end_month: "" }] });
    expect(v.rows[0]).toMatchObject({ amount: 120000, start_month: "2026-04", end_month: null, driver_id: null, project_id: null });
    expect(v.rows[1]?.start_month).toBeNull();
  });

  it("終了月が開始月より前なら拒否する", () => {
    const r = recurringExpenseRowSchema.safeParse({ ...recurringRow, start_month: "2026-09", end_month: "2026-08" });
    expect(r.success).toBe(false);
    if (!r.success) {
      expect(r.error.issues[0]?.message).toBe("終了月は開始月と同じか後の月にしてください");
      expect(r.error.issues[0]?.path).toEqual(["end_month"]);
    }
    expect(recurringExpenseRowSchema.safeParse({ ...recurringRow, start_month: "2026-09", end_month: "2026-09" }).success).toBe(true);
  });

  it("月の形式・カテゴリ・内容の不正を拒否する", () => {
    expect(saveRecurringExpensesSchema.safeParse({ rows: [{ ...recurringRow, start_month: "2026/04" }] }).success).toBe(false);
    expect(saveRecurringExpensesSchema.safeParse({ rows: [{ ...recurringRow, category_id: "" }] }).success).toBe(false);
    expect(saveRecurringExpensesSchema.safeParse({ rows: [{ ...recurringRow, label: "" }] }).success).toBe(false);
    expect(saveRecurringExpensesSchema.safeParse({ rows: [{ ...recurringRow, amount: "" }] }).success).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// 画面ヘルパー
// ---------------------------------------------------------------------------

function listRow(over: Partial<ExpenseListRow> = {}): ExpenseListRow {
  return {
    id: "x1",
    company_id: COMPANY,
    month: "2026-09-01",
    category_id: CATEGORY,
    category_name: "事務所家賃",
    kind: "fixed",
    category_sort_order: 1,
    label: "9 月分家賃",
    amount: 120000,
    tax_mode: "taxable",
    incurred_on: "2026-09-25",
    driver_id: null,
    driver_name: null,
    project_id: null,
    project_name: null,
    vendor: "〇〇不動産",
    memo: "",
    recurring_id: null,
    created_at: "2026-09-01T00:00:00Z",
    updated_at: "2026-09-01T00:00:00Z",
    is_closed: false,
    ...over,
  };
}

function summaryRow(over: Partial<ExpenseSummaryRow> = {}): ExpenseSummaryRow {
  return {
    company_id: COMPANY,
    month: "2026-09-01",
    category_id: CATEGORY,
    category_name: "事務所家賃",
    kind: "fixed",
    category_sort_order: 1,
    expense_count: 1,
    amount: 120000,
    taxable_amount: 120000,
    ...over,
  };
}

describe("経費画面のヘルパー", () => {
  it("toExpenseRow はビューの null を正規化し、月を YYYY-MM にする", () => {
    const r = toExpenseRow(listRow({ amount: null, memo: null, vendor: null, kind: null, tax_mode: null, incurred_on: null, recurring_id: "r1", is_closed: true }));
    expect(r.month).toBe("2026-09");
    expect(r.amount).toBe(0);
    expect(r.memo).toBe("");
    expect(r.vendor).toBe("");
    expect(r.kind).toBe("variable");
    expect(r.taxMode).toBe("taxable");
    expect(r.incurredOn).toBe("");
    expect(r.fromRecurring).toBe(true);
    expect(r.closed).toBe(true);
  });

  it("totalsOf はカテゴリ別小計（ビュー）から固定費・変動費・合計・件数を出す", () => {
    const categories = [
      summaryRow(),
      summaryRow({ category_id: CATEGORY2, category_name: "燃料費", kind: "variable", expense_count: 3, amount: 45500.5 }),
      summaryRow({ category_id: "c3", category_name: "返金", kind: "variable", expense_count: 1, amount: -5500.5 }),
    ].map(toCategoryTotal);
    const t = totalsOf(categories);
    expect(t.fixed).toBe(120000);
    expect(t.variable).toBe(40000);
    expect(t.total).toBe(160000);
    expect(t.count).toBe(5);
    expect(totalsOf([])).toEqual({ fixed: 0, variable: 0, total: 0, count: 0 });
  });

  it("検索・カテゴリ絞り込み（内容・カテゴリ・支払先・備考・ドライバー名・案件名の部分一致）", () => {
    const rows: ExpenseRow[] = [
      toExpenseRow(listRow()),
      toExpenseRow(listRow({ id: "x2", category_id: CATEGORY2, category_name: "燃料費", kind: "variable", label: "軽油", vendor: "ENEOS", driver_name: "相曽慧", memo: "高速代込み" })),
    ];
    expect(filterExpenses(rows, CATEGORY2, "").map((r) => r.id)).toEqual(["x2"]);
    expect(filterExpenses(rows, "", "家賃").map((r) => r.id)).toEqual(["x1"]);
    expect(filterExpenses(rows, "", "eneos").map((r) => r.id)).toEqual(["x2"]);
    expect(filterExpenses(rows, "", "相曽").map((r) => r.id)).toEqual(["x2"]);
    expect(filterExpenses(rows, "", "高速").map((r) => r.id)).toEqual(["x2"]);
    expect(filterExpenses(rows, CATEGORY, "軽油")).toEqual([]);
    expect(matchesQuery(rows[0], "  ")).toBe(true);
  });

  it("発生日の表示は M/D、未入力は —", () => {
    expect(shortDate("2026-09-05")).toBe("9/5");
    expect(shortDate("")).toBe("—");
    expect(shortDate("2026-09")).toBe("2026-09");
  });

  it("選択肢は稼働中のみ。選択中の停止済み項目だけは残す", () => {
    const options = [
      { id: "a", name: "有効", is_active: true },
      { id: "b", name: "停止中", is_active: false },
    ];
    expect(optionsWithSelected(options, "").map((o) => o.id)).toEqual(["a"]);
    expect(optionsWithSelected(options, "b").map((o) => o.id)).toEqual(["a", "b"]);
    expect(optionsWithSelected(options, "zzz").map((o) => o.id)).toEqual(["a"]);
  });

  it("課税区分の表示は 課税／対象外", () => {
    expect(EXPENSE_TAX_MODE_LABELS.taxable).toBe("課税");
    expect(EXPENSE_TAX_MODE_LABELS.exempt).toBe("対象外");
  });
});
