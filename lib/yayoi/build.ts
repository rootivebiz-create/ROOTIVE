/**
 * 弥生会計 仕訳インポート CSV（§8.2）の組み立て（純関数）
 * - 25 列・ヘッダー無し・Shift_JIS（cp932）・CRLF。識別フラグは "2000"（単一仕訳）のみ
 * - 金額は整数へ四捨五入（roundDisplay）。0 円の行は出さない
 * - 結果として 未払金の残高（貸方 − 借方）＝ 支払額合計 になる
 *
 * 列: 1 識別フラグ, 2 伝票No, 3 決算, 4 取引日付, 5 借方勘定科目, 6 借方補助科目, 7 借方部門, 8 借方税区分, 9 借方金額, 10 借方税金額,
 *     11 貸方勘定科目, 12 貸方補助科目, 13 貸方部門, 14 貸方税区分, 15 貸方金額, 16 貸方税金額, 17 摘要, 18 番号, 19 期日, 20 タイプ,
 *     21 生成元, 22 仕訳メモ, 23 付箋1, 24 付箋2, 25 調整
 */
import iconv from "iconv-lite";
import { roundDisplay } from "@/lib/calc/money";
import { daysInMonth, formatMonthJa } from "@/lib/month";
import type { YayoiAccounts } from "./accounts";

export const YAYOI_COLUMN_COUNT = 25;

/** 摘要の最大文字数（弥生会計は全角 32 文字まで） */
export const YAYOI_SUMMARY_MAX = 32;

export interface YayoiAdjustmentInput {
  label: string;
  /** 符号付き。控除はマイナス */
  amount: number;
  countAsProfit: boolean;
}

export interface YayoiDriverInput {
  driverId: string;
  driverName: string;
  /** 会社売上 */
  bill: number;
  /** ドライバー売上 */
  pay: number;
  royalty: number;
  /** 実際に計上した管理費（数量 > 0 の行が無い月は 0） */
  mgmtFee: number;
  adjustments: YayoiAdjustmentInput[];
}

export interface YayoiBuildInput {
  /** 稼動月 YYYY-MM */
  month: string;
  accounts: YayoiAccounts;
  /** 振込予定日 YYYY-MM-DD（date_basis = payout_date のとき使用） */
  payoutDate: string;
  drivers: YayoiDriverInput[];
}

interface Journal {
  date: string;
  debitAccount: string;
  debitSub: string;
  debitTax: string;
  creditAccount: string;
  creditSub: string;
  creditTax: string;
  amount: number;
  summary: string;
}

/** 取引日付 "YYYY/MM/DD"（month_end＝稼動月末日、payout_date＝振込予定日） */
export function yayoiJournalDate(month: string, accounts: Pick<YayoiAccounts, "date_basis">, payoutDate: string): string {
  const ymd = accounts.date_basis === "payout_date" ? payoutDate : `${month}-${String(daysInMonth(month)).padStart(2, "0")}`;
  return ymd.replace(/-/g, "/");
}

function truncateSummary(s: string): string {
  const chars = Array.from(s.replace(/[\r\n]+/g, " ").trim());
  return chars.length > YAYOI_SUMMARY_MAX ? chars.slice(0, YAYOI_SUMMARY_MAX).join("") : chars.join("");
}

function journalToRow(j: Journal): string[] {
  const amount = String(j.amount);
  const row = [
    "2000", // 1 識別フラグ（単一仕訳）
    "", // 2 伝票No
    "", // 3 決算
    j.date, // 4 取引日付
    j.debitAccount, // 5 借方勘定科目
    j.debitSub, // 6 借方補助科目
    "", // 7 借方部門
    j.debitTax, // 8 借方税区分
    amount, // 9 借方金額
    "", // 10 借方税金額
    j.creditAccount, // 11 貸方勘定科目
    j.creditSub, // 12 貸方補助科目
    "", // 13 貸方部門
    j.creditTax, // 14 貸方税区分
    amount, // 15 貸方金額
    "", // 16 貸方税金額
    truncateSummary(j.summary), // 17 摘要
    "", // 18 番号
    "", // 19 期日
    "0", // 20 タイプ
    "", // 21 生成元
    "", // 22 仕訳メモ
    "0", // 23 付箋1
    "0", // 24 付箋2
    "no", // 25 調整
  ];
  if (row.length !== YAYOI_COLUMN_COUNT) throw new Error("弥生 CSV の列数が不正です");
  return row;
}

/** ドライバー（または月合計）1 単位分の仕訳 */
function buildJournalsFor(unit: YayoiDriverInput | null, input: YayoiBuildInput, date: string, prefix: string): Journal[] {
  const a = input.accounts;
  const out: Journal[] = [];
  const push = (j: Omit<Journal, "date">) => {
    const amount = roundDisplay(j.amount);
    if (amount === 0) return;
    out.push({ ...j, amount: Math.abs(amount), date });
  };

  const totals = unit ?? aggregate(input.drivers);

  // (a) 売上：借方 売掛金／貸方 売上高（会社売上）
  push({
    debitAccount: a.sales_debit,
    debitSub: "",
    debitTax: a.tax_class_none,
    creditAccount: a.sales_credit,
    creditSub: "",
    creditTax: a.tax_class_sales,
    amount: totals.bill,
    summary: `${prefix} 稼働分 売上`,
  });
  // (b) 外注費：借方 外注費／貸方 未払金（ドライバー売上）
  push({
    debitAccount: a.outsourcing_debit,
    debitSub: "",
    debitTax: a.tax_class_purchase,
    creditAccount: a.outsourcing_credit,
    creditSub: "",
    creditTax: a.tax_class_none,
    amount: totals.pay,
    summary: `${prefix} 稼働分 外注費`,
  });
  // (c) ロイヤリティ：借方 未払金／貸方 雑収入（補助 ロイヤリティ）
  push({
    debitAccount: a.outsourcing_credit,
    debitSub: "",
    debitTax: a.tax_class_none,
    creditAccount: a.royalty_credit,
    creditSub: a.royalty_sub,
    creditTax: a.tax_class_sales,
    amount: totals.royalty,
    summary: `${prefix} ロイヤリティ`,
  });
  // (d) 管理費：借方 未払金／貸方 雑収入（補助 管理費）
  push({
    debitAccount: a.outsourcing_credit,
    debitSub: "",
    debitTax: a.tax_class_none,
    creditAccount: a.mgmt_credit,
    creditSub: a.mgmt_sub,
    creditTax: a.tax_class_sales,
    amount: totals.mgmtFee,
    summary: `${prefix} 管理費`,
  });
  // (e)(f) 調整
  for (const adj of totals.adjustments) {
    const amount = roundDisplay(adj.amount);
    if (amount === 0) continue;
    const deduction = amount < 0; // 控除（支払額を減らす）→ 未払金が借方
    const summary = `${prefix} 調整 ${adj.label}`;
    if (adj.countAsProfit) {
      // (e) 利益計上：控除なら 借方 未払金／貸方 雑収入（補助 調整）、加算なら逆仕訳
      push(
        deduction
          ? {
              debitAccount: a.outsourcing_credit,
              debitSub: "",
              debitTax: a.tax_class_none,
              creditAccount: a.adj_profit_credit,
              creditSub: a.adj_profit_sub,
              creditTax: a.tax_class_sales,
              amount,
              summary,
            }
          : {
              debitAccount: a.adj_profit_credit,
              debitSub: a.adj_profit_sub,
              debitTax: a.tax_class_sales,
              creditAccount: a.outsourcing_credit,
              creditSub: "",
              creditTax: a.tax_class_none,
              amount,
              summary,
            },
      );
    } else {
      // (f) 利益計上なし（立替精算など）：控除なら 借方 未払金／貸方 立替金、加算なら 借方 立替金／貸方 未払金
      push(
        deduction
          ? {
              debitAccount: a.outsourcing_credit,
              debitSub: "",
              debitTax: a.tax_class_none,
              creditAccount: a.adj_nonprofit_account,
              creditSub: "",
              creditTax: a.tax_class_none,
              amount,
              summary,
            }
          : {
              debitAccount: a.adj_nonprofit_account,
              debitSub: "",
              debitTax: a.tax_class_none,
              creditAccount: a.outsourcing_credit,
              creditSub: "",
              creditTax: a.tax_class_none,
              amount,
              summary,
            },
      );
    }
  }
  return out;
}

/** 月合計（split_by_driver = false）：金額を合算し、調整は「利益計上あり／なし」でまとめる */
function aggregate(drivers: YayoiDriverInput[]): YayoiDriverInput {
  const sum = (f: (d: YayoiDriverInput) => number) => drivers.reduce((acc, d) => acc + f(d), 0);
  const adjProfit = drivers.reduce((acc, d) => acc + d.adjustments.filter((x) => x.countAsProfit).reduce((s, x) => s + x.amount, 0), 0);
  const adjNonProfit = drivers.reduce((acc, d) => acc + d.adjustments.filter((x) => !x.countAsProfit).reduce((s, x) => s + x.amount, 0), 0);
  return {
    driverId: "",
    driverName: "",
    bill: sum((d) => d.bill),
    pay: sum((d) => d.pay),
    royalty: sum((d) => d.royalty),
    mgmtFee: sum((d) => d.mgmtFee),
    adjustments: [
      { label: "（利益計上）", amount: adjProfit, countAsProfit: true },
      { label: "（立替等）", amount: adjNonProfit, countAsProfit: false },
    ],
  };
}

/** 仕訳行（25 列の文字列配列）を組み立てる */
export function buildYayoiRows(input: YayoiBuildInput): string[][] {
  const date = yayoiJournalDate(input.month, input.accounts, input.payoutDate);
  const monthLabel = formatMonthJa(input.month);
  const journals: Journal[] = [];
  if (input.accounts.split_by_driver) {
    for (const d of input.drivers) journals.push(...buildJournalsFor(d, input, date, `${monthLabel} ${d.driverName}`));
  } else if (input.drivers.length > 0) {
    journals.push(...buildJournalsFor(null, input, date, monthLabel));
  }
  return journals.map(journalToRow);
}

/** 未払金（outsourcing_credit）の残高：貸方 − 借方（＝ 支払額合計になるはず。検算用） */
export function yayoiPayableBalance(rows: string[][], accounts: Pick<YayoiAccounts, "outsourcing_credit">): number {
  let balance = 0;
  for (const r of rows) {
    if (r[10] === accounts.outsourcing_credit) balance += Number(r[14]);
    if (r[4] === accounts.outsourcing_credit) balance -= Number(r[8]);
  }
  return balance;
}

/** cp932 に無い JIS 系の記号を Windows 系の対応文字へ寄せる（〜 → ～ など。変換できない文字は "?" になる） */
export function normalizeForCp932(s: string): string {
  return s
    .replace(/〜/g, "～") // 〜 WAVE DASH → ～ FULLWIDTH TILDE
    .replace(/‖/g, "∥") // ‖ → ∥
    .replace(/−/g, "－") // − MINUS SIGN → －
    .replace(/¢/g, "￠") // ¢ → ￠
    .replace(/£/g, "￡") // £ → ￡
    .replace(/¬/g, "￢") // ¬ → ￢
    .replace(/—/g, "―"); // — EM DASH → ―
}

function yayoiCell(v: string): string {
  return /[",\r\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v;
}

/** 行 → CSV テキスト（CRLF、BOM 無し、ヘッダー無し） */
export function toYayoiCsvText(rows: string[][]): string {
  return rows.map((r) => r.map(yayoiCell).join(",")).join("\r\n") + (rows.length ? "\r\n" : "");
}

/** 行 → Shift_JIS（cp932）の Buffer */
export function toYayoiCsvBuffer(rows: string[][]): Buffer {
  return iconv.encode(normalizeForCp932(toYayoiCsvText(rows)), "cp932");
}
