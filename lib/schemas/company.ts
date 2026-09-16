import { z } from "zod";
import { moneySchema, nameSchema, percentToRateSchema, roundingModeSchema } from "./common";
import { parseNumberInput } from "@/lib/calc/parse";
import type { RoundingMode } from "@/lib/calc/types";
import { DEFAULT_YAYOI_ACCOUNTS, type YayoiAccounts } from "@/lib/yayoi/accounts";

/** 振込予定日：稼動月からのずれ（0=当月／1=翌月／2=翌々月／3=3 か月後） */
export const PAYOUT_MONTH_OFFSETS = [0, 1, 2, 3] as const;
export const PAYOUT_MONTH_OFFSET_LABELS: Record<(typeof PAYOUT_MONTH_OFFSETS)[number], string> = {
  0: "当月",
  1: "翌月",
  2: "翌々月",
  3: "3 か月後",
};

export const YAYOI_DATE_BASIS = ["month_end", "payout_date"] as const;
export const YAYOI_DATE_BASIS_LABELS: Record<YayoiAccounts["date_basis"], string> = {
  month_end: "稼動月の末日",
  payout_date: "振込予定日",
};

/** 弥生の勘定科目マッピングのうち、文字列で入力する項目 */
export type YayoiTextKey = Exclude<keyof YayoiAccounts, "split_by_driver" | "date_basis">;
export const YAYOI_TEXT_KEYS = (Object.keys(DEFAULT_YAYOI_ACCOUNTS) as (keyof YayoiAccounts)[]).filter(
  (k): k is YayoiTextKey => k !== "split_by_driver" && k !== "date_basis",
);

/** 会社設定フォームの入力（クライアント → Server Action）。数値は文字列で受け取り zod で正規化する */
export interface CompanyFormInput {
  name: string;
  rounding_mode: RoundingMode;
  /** パーセント表記（"10", "12.5"） */
  default_royalty_rate: string;
  /** 月額（円） */
  default_mgmt_fee: string;
  /** "0"〜"3" */
  payout_month_offset: string;
  /** "0"（末日）〜"31" */
  payout_day: string;
  statement_note: string;
  address: string;
  tel: string;
  invoice_reg_no: string;
  driver_portal_show_royalty: boolean;
  yayoi_accounts: YayoiAccountsFormInput;
}

export type YayoiAccountsFormInput = Record<YayoiTextKey, string> & {
  split_by_driver: boolean;
  date_basis: YayoiAccounts["date_basis"];
};

const intFromInput = (min: number, max: number, label: string) =>
  z.preprocess(
    (v) => (typeof v === "string" ? parseNumberInput(v) : v),
    z
      .number({ error: `${label}を選択してください` })
      .int(`${label}は整数で指定してください`)
      .min(min, `${label}は ${min} 以上で指定してください`)
      .max(max, `${label}は ${max} 以下で指定してください`),
  );

const accountText = (label: string) => z.string().trim().max(50, `${label}は 50 文字以内で入力してください`);

export const yayoiAccountsSchema = z.object({
  sales_debit: accountText("売上：借方科目"),
  sales_credit: accountText("売上：貸方科目"),
  outsourcing_debit: accountText("外注費：借方科目"),
  outsourcing_credit: accountText("外注費：貸方科目"),
  royalty_credit: accountText("ロイヤリティ：貸方科目"),
  royalty_sub: accountText("ロイヤリティ：補助科目"),
  mgmt_credit: accountText("管理費：貸方科目"),
  mgmt_sub: accountText("管理費：補助科目"),
  adj_profit_credit: accountText("調整（利益計上）：貸方科目"),
  adj_profit_sub: accountText("調整（利益計上）：補助科目"),
  adj_nonprofit_account: accountText("調整（利益計上なし）：相手科目"),
  tax_class_sales: accountText("税区分（売上）"),
  tax_class_purchase: accountText("税区分（仕入）"),
  tax_class_none: accountText("税区分（対象外）"),
  split_by_driver: z.boolean(),
  date_basis: z.enum(YAYOI_DATE_BASIS, { error: "伝票日付の基準を選択してください" }),
});

export const companyInputSchema = z.object({
  name: nameSchema,
  rounding_mode: roundingModeSchema,
  default_royalty_rate: percentToRateSchema,
  default_mgmt_fee: moneySchema,
  payout_month_offset: intFromInput(0, 3, "振込予定日（月）"),
  payout_day: intFromInput(0, 31, "振込予定日（日）"),
  statement_note: z.string().trim().max(2000, "2000 文字以内で入力してください"),
  address: z.string().trim().max(200, "200 文字以内で入力してください"),
  tel: z.string().trim().max(50, "50 文字以内で入力してください"),
  invoice_reg_no: z
    .string()
    .trim()
    .max(30, "30 文字以内で入力してください")
    .refine((s) => s === "" || /^T?\d{13}$/.test(s.replace(/[-\s]/g, "")), "適格請求書登録番号は T ＋ 13 桁の数字で入力してください"),
  driver_portal_show_royalty: z.boolean(),
  yayoi_accounts: yayoiAccountsSchema,
});

export type CompanyInputParsed = z.output<typeof companyInputSchema>;

/** 保存済みの yayoi_accounts をフォーム初期値へ */
export function yayoiAccountsToForm(accounts: YayoiAccounts): YayoiAccountsFormInput {
  const out = {} as YayoiAccountsFormInput;
  for (const k of YAYOI_TEXT_KEYS) out[k] = accounts[k];
  out.split_by_driver = accounts.split_by_driver;
  out.date_basis = accounts.date_basis;
  return out;
}
