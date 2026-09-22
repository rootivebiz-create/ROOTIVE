import { z } from "zod";
import { moneySchema, nameSchema, percentToRateSchema, roundingModeSchema } from "./common";
// 振込先口座の検証はドライバーと共通（lib/schemas/drivers.ts に置いている）
import { accountNumberSchema, accountTypeSchema, bankCodeSchema, bankNameSchema, branchCodeSchema, branchNameSchema, toHalfWidthDigits, toHalfWidthKana } from "./drivers";
import type { BankAccountType } from "@/lib/db/types";
import { parseNumberInput } from "@/lib/calc/parse";
import type { RoundingMode } from "@/lib/calc/types";
import { DEFAULT_YAYOI_ACCOUNTS, type YayoiAccounts } from "@/lib/yayoi/accounts";
import { DEFAULT_LABOR_STANDARDS, minutesToHoursInput, type LaborStandards } from "@/lib/labor/helpers";

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
  /** 未締め月の暫定額（速報）をドライバーポータルに出すか */
  driver_portal_show_open_month: boolean;
  /** 消費税率（パーセント表記 "10"） */
  tax_rate: string;
  /** 消費税額の端数処理 */
  tax_rounding: RoundingMode;
  /** 決算月（"1"〜"12"） */
  fiscal_month: string;
  /** 全銀の委託者コード（銀行から指定される番号。空欄可） */
  fb_consignor_code: string;
  /** 委託者名（半角カナ） */
  fb_consignor_kana: string;
  /** 振込元の口座（総合振込データの引き落とし口座） */
  fb_bank_code: string;
  fb_bank_name: string;
  fb_branch_code: string;
  fb_branch_name: string;
  fb_account_type: BankAccountType | "";
  fb_account_number: string;
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


/** 決算月の選択肢（1〜12 月） */
export const FISCAL_MONTHS = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12] as const;

/** 委託者コード（銀行から指定される番号。空欄は未入力） */
export const consignorCodeSchema = z.preprocess(
  (v) => (typeof v === "string" ? toHalfWidthDigits(v) : ""),
  z.string().refine((s) => s === "" || /^[0-9]{1,10}$/.test(s), "委託者コードは 10 桁までの数字で入力してください"),
);

/** 委託者名（半角カナ。全銀の 40 桁に合わせる） */
export const consignorKanaSchema = z.preprocess(
  (v) => (typeof v === "string" ? toHalfWidthKana(v.trim()) : ""),
  z.string().max(40, "委託者名は 40 文字以内で入力してください").refine((s) => /^[0-9A-Z\uFF61-\uFF9F ().\-/,]*$/.test(s), "委託者名は半角カナ・英数字で入力してください"),
);

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
  driver_portal_show_open_month: z.boolean(),
  tax_rate: percentToRateSchema,
  tax_rounding: roundingModeSchema,
  fiscal_month: intFromInput(1, 12, "決算月"),
  fb_consignor_code: consignorCodeSchema,
  fb_consignor_kana: consignorKanaSchema,
  fb_bank_code: bankCodeSchema,
  fb_bank_name: bankNameSchema,
  fb_branch_code: branchCodeSchema,
  fb_branch_name: branchNameSchema,
  fb_account_type: accountTypeSchema,
  fb_account_number: accountNumberSchema,
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

// ---------------------------------------------------------------------------
// 労務の基準（0018）
//   画面は「時間」で入力し、DB には「分」で保存する（780 分 ↔ 13 時間）
// ---------------------------------------------------------------------------

/** 労務の基準フォームの入力（クライアント → Server Action）。時間・日数は文字列で受け取る */
export interface LaborSettingsFormInput {
  /** 1 日の拘束時間の目安（時間） */
  labor_duty_limit_hours: string;
  /** 1 日の拘束時間の上限（時間） */
  labor_duty_max_hours: string;
  /** 休息期間の目安（時間） */
  labor_rest_target_hours: string;
  /** 休息期間の下限（時間） */
  labor_rest_min_hours: string;
  /** 1 か月の拘束時間（時間） */
  labor_month_duty_hours: string;
  /** 連続勤務の日数 */
  labor_max_consecutive_days: string;
}

/** 時間で入力された値を分（整数）にする。1 分未満の端数は認めない */
const hoursToMinutesField = (label: string, minHours: number, maxHours: number) =>
  z.preprocess(
    (v) => (typeof v === "string" ? parseNumberInput(v) : v),
    z
      .number({ error: `${label}を入力してください` })
      .min(minHours, `${label}は ${minHours} 時間以上で入力してください`)
      .max(maxHours, `${label}は ${maxHours} 時間以下で入力してください`)
      .refine((n) => Math.abs(n * 60 - Math.round(n * 60)) < 1e-6, `${label}は 1 分単位（0.5 = 30 分）で入力してください`)
      .transform((n) => Math.round(n * 60)),
  );

export const laborSettingsSchema = z
  .object({
    labor_duty_limit_hours: hoursToMinutesField("1 日の拘束時間の目安", 1, 24),
    labor_duty_max_hours: hoursToMinutesField("1 日の拘束時間の上限", 1, 24),
    labor_rest_target_hours: hoursToMinutesField("休息期間の目安", 1, 24),
    labor_rest_min_hours: hoursToMinutesField("休息期間の下限", 1, 24),
    labor_month_duty_hours: hoursToMinutesField("1 か月の拘束時間", 1, 744),
    labor_max_consecutive_days: z.preprocess(
      (v) => (typeof v === "string" ? parseNumberInput(v) : v),
      z
        .number({ error: "連続勤務の日数を入力してください" })
        .int("連続勤務の日数は整数で入力してください")
        .min(1, "連続勤務の日数は 1 日以上で入力してください")
        .max(31, "連続勤務の日数は 31 日以下で入力してください"),
    ),
  })
  .superRefine((v, ctx) => {
    if (v.labor_duty_max_hours < v.labor_duty_limit_hours) {
      ctx.addIssue({
        code: "custom",
        path: ["labor_duty_max_hours"],
        message: `1 日の拘束時間の上限は、目安（${minutesToHoursInput(v.labor_duty_limit_hours)} 時間）以上で入力してください`,
      });
    }
    if (v.labor_rest_min_hours > v.labor_rest_target_hours) {
      ctx.addIssue({
        code: "custom",
        path: ["labor_rest_min_hours"],
        message: `休息期間の下限は、目安（${minutesToHoursInput(v.labor_rest_target_hours)} 時間）以下で入力してください`,
      });
    }
  });

/** 検証済みの入力（値はすべて分。連続勤務だけ日） */
export type LaborSettingsParsed = z.output<typeof laborSettingsSchema>;

/** 検証済みの入力を companies の列（分）へ */
export function laborSettingsToColumns(p: LaborSettingsParsed): LaborStandards {
  return {
    labor_duty_limit_minutes: p.labor_duty_limit_hours,
    labor_duty_max_minutes: p.labor_duty_max_hours,
    labor_rest_target_minutes: p.labor_rest_target_hours,
    labor_rest_min_minutes: p.labor_rest_min_hours,
    labor_month_duty_minutes: p.labor_month_duty_hours,
    labor_max_consecutive_days: p.labor_max_consecutive_days,
  };
}

/** 保存済みの分をフォーム初期値（時間）へ。未設定の項目は既定値を使う */
export function laborSettingsToForm(c: Partial<LaborStandards> | null | undefined): LaborSettingsFormInput {
  const v = { ...DEFAULT_LABOR_STANDARDS, ...(c ?? {}) };
  return {
    labor_duty_limit_hours: minutesToHoursInput(v.labor_duty_limit_minutes),
    labor_duty_max_hours: minutesToHoursInput(v.labor_duty_max_minutes),
    labor_rest_target_hours: minutesToHoursInput(v.labor_rest_target_minutes),
    labor_rest_min_hours: minutesToHoursInput(v.labor_rest_min_minutes),
    labor_month_duty_hours: minutesToHoursInput(v.labor_month_duty_minutes),
    labor_max_consecutive_days: String(v.labor_max_consecutive_days),
  };
}

/** 「既定に戻す」で入れるフォームの値（改善基準告示に合わせた既定） */
export const DEFAULT_LABOR_SETTINGS_FORM: LaborSettingsFormInput = laborSettingsToForm(DEFAULT_LABOR_STANDARDS);

// ---------------------------------------------------------------------------
// 法定帳票の保存期間と診断の間隔（0024）
// ---------------------------------------------------------------------------

/** companies の保存期間まわりの列 */
export interface RetentionSettings {
  retention_daily_years: number;
  retention_instruction_years: number;
  retention_incident_years: number;
  retention_roster_years: number;
  aptitude_age_from: number;
  aptitude_age_years: number;
  health_check_months: number;
}

/** 既定（法令の目安。0024 のマイグレーションの default と同じ） */
export const DEFAULT_RETENTION_SETTINGS: RetentionSettings = {
  retention_daily_years: 1,
  retention_instruction_years: 3,
  retention_incident_years: 3,
  retention_roster_years: 3,
  aptitude_age_from: 65,
  aptitude_age_years: 3,
  health_check_months: 12,
};

export type RetentionSettingsFormInput = Record<keyof RetentionSettings, string>;

function intField(label: string, min: number, max: number) {
  return z.preprocess(
    (v) => (typeof v === "string" ? parseNumberInput(v) : v),
    z
      .number({ error: `${label}を入力してください` })
      .int(`${label}は整数で入力してください`)
      .min(min, `${label}は ${min} 以上で入力してください`)
      .max(max, `${label}は ${max} 以下で入力してください`),
  );
}

export const retentionSettingsSchema = z.object({
  retention_daily_years: intField("運転日報の保存年数", 1, 20),
  retention_instruction_years: intField("指導の記録の保存年数", 1, 20),
  retention_incident_years: intField("事故の記録の保存年数", 1, 20),
  retention_roster_years: intField("運転者台帳の保存年数", 1, 20),
  aptitude_age_from: intField("適齢診断の対象年齢", 40, 100),
  aptitude_age_years: intField("適齢診断の間隔", 1, 10),
  health_check_months: intField("健康診断の間隔（か月）", 1, 60),
});

export type RetentionSettingsParsed = z.output<typeof retentionSettingsSchema>;

/** 保存済みの値をフォーム初期値へ。未設定の項目は既定値を使う */
export function retentionSettingsToForm(c: Partial<RetentionSettings> | null | undefined): RetentionSettingsFormInput {
  const v = { ...DEFAULT_RETENTION_SETTINGS, ...(c ?? {}) };
  return {
    retention_daily_years: String(v.retention_daily_years),
    retention_instruction_years: String(v.retention_instruction_years),
    retention_incident_years: String(v.retention_incident_years),
    retention_roster_years: String(v.retention_roster_years),
    aptitude_age_from: String(v.aptitude_age_from),
    aptitude_age_years: String(v.aptitude_age_years),
    health_check_months: String(v.health_check_months),
  };
}

/** 「既定に戻す」で入れるフォームの値 */
export const DEFAULT_RETENTION_SETTINGS_FORM: RetentionSettingsFormInput = retentionSettingsToForm(DEFAULT_RETENTION_SETTINGS);
