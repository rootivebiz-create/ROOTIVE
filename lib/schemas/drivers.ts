import { z } from "zod";
import { memoSchema, moneySchema, nameSchema, percentToRateSchema, roundingModeSchema, signedMoneySchema, uuidSchema } from "./common";
import { parseNumberInput } from "@/lib/calc/parse";
import { TAX_MODES, type RoundingMode, type TaxMode } from "@/lib/calc/types";
import { BANK_ACCOUNT_TYPES, type BankAccountType } from "@/lib/db/types";

/**
 * ドライバー設定フォームの入力（クライアント → Server Action）。
 * 数値はすべて文字列で受け取り、zod で正規化する（全角・カンマ可）。
 */
export interface DriverFormInput {
  /** null = 新規 */
  id: string | null;
  name: string;
  kana: string;
  is_active: boolean;
  /** パーセント表記（"10", "12.5"）。null = 会社設定に従う */
  royalty_rate: string | null;
  /** 月額（円） */
  mgmt_fee: string;
  /** "" = 会社設定に従う */
  rounding_mode: RoundingMode | "";
  phone: string;
  email: string;
  bank_info: string;
  memo: string;
  /** 課税区分（taxable = 消費税を上乗せ／exempt = 上乗せしない） */
  tax_mode: TaxMode;
  /** ドライバーの適格請求書登録番号（任意。T ＋ 13 桁） */
  invoice_reg_no: string;
  /** 振込予定日：会社設定に従うなら null。個別なら "0"〜"3"（月）と "0"（末日）〜"31"（日） */
  payout_month_offset: string | null;
  payout_day: string | null;
  /** 振込先口座（総合振込データに使う）。省略・空欄は「未入力」として保存する */
  bank_code?: string;
  bank_name?: string;
  branch_code?: string;
  branch_name?: string;
  /** "" = 未選択 */
  account_type?: BankAccountType | "";
  account_number?: string;
  /** 口座名義（半角カナ。全角で入力しても保存時に半角へ寄せる） */
  account_holder_kana?: string;
  /** 案件内容ごとのドライバー別単価。受注・支払の両方が空欄なら標準（override 行を削除） */
  overrides: DriverOverrideFormInput[];
  /** 固定控除。id が null なら新規。送られてこなかった既存 id は削除 */
  recurring: DriverRecurringFormInput[];
}

export interface DriverOverrideFormInput {
  project_item_id: string;
  /** 個別の受注単価（空欄＝案件内容の標準） */
  bill_rate: string;
  /** 個別の支払単価（空欄＝案件内容の標準） */
  pay_rate: string;
}

export interface DriverRecurringFormInput {
  id: string | null;
  label: string;
  /** 符号付き。控除はマイナス */
  amount: string;
  count_as_profit: boolean;
  is_active: boolean;
}

/** 空欄は null（標準）、それ以外は金額として検証 */
export const optionalMoneySchema = z.preprocess(
  (v) => (v == null || (typeof v === "string" && v.trim() === "") ? null : v),
  moneySchema.nullable(),
);

/** "" / null は会社設定に従う（null） */
export const optionalRoundingModeSchema = z.preprocess((v) => (v === "" || v == null ? null : v), roundingModeSchema.nullable());

export const driverOverrideSchema = z.object({
  project_item_id: uuidSchema,
  bill_rate: optionalMoneySchema,
  pay_rate: optionalMoneySchema,
});

export const driverRecurringSchema = z.object({
  id: uuidSchema.nullable(),
  label: z.string().trim().min(1, "項目名を入力してください").max(100, "100 文字以内で入力してください"),
  amount: signedMoneySchema,
  count_as_profit: z.boolean(),
  is_active: z.boolean(),
});

/** null／空欄は「会社設定に従う」、それ以外は整数として検証 */
const optionalIntSchema = (min: number, max: number, label: string) =>
  z.preprocess(
    (v) => (v == null || (typeof v === "string" && v.trim() === "") ? null : typeof v === "string" ? parseNumberInput(v) : v),
    z
      .number({ error: `${label}を選択してください` })
      .int(`${label}は整数で指定してください`)
      .min(min, `${label}は ${min} 以上で指定してください`)
      .max(max, `${label}は ${max} 以下で指定してください`)
      .nullable(),
  );


// ---------------------------------------------------------------------------
// 振込先口座（ドライバー・会社の振込元で共用）
//
// 全銀の総合振込データは半角カナ・数字しか使えないため、入力は半角へ寄せてから検証する。
// 空欄は「未入力」として許可する（DB の check も '' を許している）。
// lib/exports の全銀ファイル生成には依存しない（表示・保存だけをここで完結させる）。
// ---------------------------------------------------------------------------

/** ひらがな → カタカナ（濁点は次の変換でまとめて半角にする） */
function hiraganaToKatakana(s: string): string {
  return s.replace(/[\u3041-\u3096]/g, (c) => String.fromCharCode(c.charCodeAt(0) + 0x60));
}

const FULL_DAKUTEN = "ガギグゲゴザジズゼゾダヂヅデドバビブベボヴパピプペポ";
const HALF_DAKUTEN = [
  "ｶﾞ", "ｷﾞ", "ｸﾞ", "ｹﾞ", "ｺﾞ",
  "ｻﾞ", "ｼﾞ", "ｽﾞ", "ｾﾞ", "ｿﾞ",
  "ﾀﾞ", "ﾁﾞ", "ﾂﾞ", "ﾃﾞ", "ﾄﾞ",
  "ﾊﾞ", "ﾋﾞ", "ﾌﾞ", "ﾍﾞ", "ﾎﾞ",
  "ｳﾞ",
  "ﾊﾟ", "ﾋﾟ", "ﾌﾟ", "ﾍﾟ", "ﾎﾟ",
];
const FULL_KANA = "アイウエオカキクケコサシスセソタチツテトナニヌネノハヒフヘホマミムメモヤユヨラリルレロワヲンァィゥェォッャュョー、。・「」゛゜";
const HALF_KANA = "ｱｲｳｴｵｶｷｸｹｺｻｼｽｾｿﾀﾁﾂﾃﾄﾅﾆﾇﾈﾉﾊﾋﾌﾍﾎﾏﾐﾑﾒﾓﾔﾕﾖﾗﾘﾙﾚﾛﾜｦﾝｧｨｩｪｫｯｬｭｮｰ､｡･｢｣ﾞﾟ";

/**
 * 口座名義を半角カナへ寄せる（全角カナ・ひらがな・全角英数字 → 半角、英字は大文字）。
 * 変換できない文字はそのまま残し、検証側で弾く。
 */
export function toHalfWidthKana(input: string): string {
  const src = hiraganaToKatakana(input);
  let out = "";
  for (const ch of src) {
    const daku = FULL_DAKUTEN.indexOf(ch);
    if (daku >= 0) {
      out += HALF_DAKUTEN[daku];
      continue;
    }
    const base = FULL_KANA.indexOf(ch);
    if (base >= 0) {
      out += HALF_KANA[base];
      continue;
    }
    const code = ch.charCodeAt(0);
    if (code >= 0xff01 && code <= 0xff5e) {
      out += String.fromCharCode(code - 0xfee0);
      continue;
    }
    if (ch === "\u3000") {
      out += " ";
      continue;
    }
    out += ch;
  }
  return out.toUpperCase();
}

/** 全角数字・記号を半角にして空白を除く（銀行コードなど） */
export function toHalfWidthDigits(input: string): string {
  return input
    .replace(/[０-９]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xfee0))
    .replace(/[\s\u3000ー－―−‐-]/g, "")
    .trim();
}

/** 口座名義に使える文字（半角カナ・英大文字・数字・空白と ( ) . - / ,） */
export const ACCOUNT_HOLDER_KANA_RE = /^[0-9A-Z\uFF61-\uFF9F ().\-/,]*$/;
/** 全銀のレコード長に合わせた上限 */
export const ACCOUNT_HOLDER_KANA_MAX = 48;

const textField = (max: number, label: string) => z.preprocess((v) => (typeof v === "string" ? v.trim() : ""), z.string().max(max, `${label}は ${max} 文字以内で入力してください`));

const digitsField = (re: RegExp, message: string) =>
  z.preprocess((v) => (typeof v === "string" ? toHalfWidthDigits(v) : ""), z.string().refine((s) => s === "" || re.test(s), message));

/** 銀行コード（4 桁。空欄は未入力） */
export const bankCodeSchema = digitsField(/^[0-9]{4}$/, "銀行コードは 4 桁の数字で入力してください");
/** 支店コード（3 桁。空欄は未入力） */
export const branchCodeSchema = digitsField(/^[0-9]{3}$/, "支店コードは 3 桁の数字で入力してください");
/** 口座番号（1〜7 桁。空欄は未入力） */
export const accountNumberSchema = digitsField(/^[0-9]{1,7}$/, "口座番号は 7 桁までの数字で入力してください");
export const bankNameSchema = textField(100, "銀行名");
export const branchNameSchema = textField(100, "支店名");

/** 預金種目（"" / null は未選択） */
export const accountTypeSchema = z.preprocess(
  (v) => (v == null || v === "" ? null : v),
  z.enum(BANK_ACCOUNT_TYPES as [BankAccountType, ...BankAccountType[]], { error: "預金種目を選択してください" }).nullable(),
);

/** 口座名義（半角カナへ寄せてから検証） */
export const accountHolderKanaSchema = z.preprocess(
  (v) => (typeof v === "string" ? toHalfWidthKana(v.trim()) : ""),
  z
    .string()
    .max(ACCOUNT_HOLDER_KANA_MAX, `口座名義は ${ACCOUNT_HOLDER_KANA_MAX} 文字以内で入力してください`)
    .refine((s) => ACCOUNT_HOLDER_KANA_RE.test(s), "口座名義は半角カナ・英数字で入力してください（漢字・記号は使えません）"),
);

/** 振込先口座の入力（ドライバー・会社の振込元で共通） */
export const bankAccountFields = {
  bank_code: bankCodeSchema,
  bank_name: bankNameSchema,
  branch_code: branchCodeSchema,
  branch_name: branchNameSchema,
  account_type: accountTypeSchema,
  account_number: accountNumberSchema,
  account_holder_kana: accountHolderKanaSchema,
};

/** 振込に必要な項目がそろっているか（総合振込データに出せるか） */
export function isBankAccountFilled(v: {
  bank_code?: string | null;
  branch_code?: string | null;
  account_number?: string | null;
  account_holder_kana?: string | null;
}): boolean {
  return Boolean(v.bank_code && v.branch_code && v.account_number && v.account_holder_kana);
}

export const driverInputSchema = z.object({
  id: uuidSchema.nullable(),
  name: nameSchema,
  kana: z.string().trim().max(100, "100 文字以内で入力してください"),
  is_active: z.boolean(),
  royalty_rate: percentToRateSchema.nullable(),
  mgmt_fee: moneySchema,
  rounding_mode: optionalRoundingModeSchema,
  phone: z.string().trim().max(50, "50 文字以内で入力してください"),
  email: z
    .string()
    .trim()
    .max(200, "200 文字以内で入力してください")
    .refine((s) => s === "" || /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s), "メールアドレスの形式が正しくありません"),
  bank_info: z.string().trim().max(500, "500 文字以内で入力してください"),
  memo: memoSchema,
  tax_mode: z.enum(TAX_MODES, { error: "課税区分を選択してください" }),
  invoice_reg_no: z
    .string()
    .trim()
    .max(30, "30 文字以内で入力してください")
    .refine((s) => s === "" || /^T?\d{13}$/.test(s.replace(/[-\s]/g, "")), "適格請求書登録番号は T ＋ 13 桁の数字で入力してください"),
  payout_month_offset: optionalIntSchema(0, 3, "振込予定日（月）"),
  payout_day: optionalIntSchema(0, 31, "振込予定日（日）"),
  ...bankAccountFields,
  overrides: z.array(driverOverrideSchema).max(500, "個別単価が多すぎます"),
  recurring: z.array(driverRecurringSchema).max(50, "固定控除が多すぎます"),
});

export type DriverInputParsed = z.output<typeof driverInputSchema>;

export const reorderDirectionSchema = z.enum(["up", "down"]);
export const reorderInputSchema = z.object({
  id: uuidSchema,
  direction: reorderDirectionSchema,
});
export type ReorderInput = z.input<typeof reorderInputSchema>;
