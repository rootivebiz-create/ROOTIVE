import { z } from "zod";
import { memoSchema, nameSchema, uuidSchema } from "./common";
import { parseNumberInput } from "@/lib/calc/parse";
import { CHECKLIST_KEYS, isDateString, type ChecklistKey } from "@/lib/hr/helpers";
import type { ApplicantStage, ContractStatus } from "@/lib/db/types";

/**
 * 採用（応募者）と業務委託契約の入力スキーマ（サーバー・クライアント共用）
 *
 * - 日付はすべて "YYYY-MM-DD"。空欄は null（＝未定・期限なし）
 * - 数値（通知日数）は全角・カンマ可（`parseNumberInput`）
 * - 段階の変更は `moveApplicantStageSchema` だけで行う（DB のトリガーが履歴を残す）
 */

/** 空欄（"" / 空白のみ / null / undefined）は null にする */
// 空欄の扱い・任意の日付・任意の ID は common.ts が正（0025 でまとめた）
import { optionalDateSchema, optionalIdSchema } from "./common";
export { optionalDateSchema, optionalIdSchema };

/** 必須の日付 "YYYY-MM-DD" */
export const dateSchema = z.string().trim().refine(isDateString, "日付は YYYY-MM-DD 形式で入力してください");



/** 採用の段階（DB の enum applicant_stage と同じ並び） */
export const APPLICANT_STAGE_VALUES = [
  "applied",
  "contacted",
  "interview",
  "docs",
  "contract",
  "started",
  "declined",
  "rejected",
] as const satisfies readonly ApplicantStage[];

export const applicantStageSchema = z.enum(APPLICANT_STAGE_VALUES, { error: "段階を選択してください" });

/** 契約の状態（DB の enum contract_status と同じ並び） */
export const CONTRACT_STATUS_VALUES = ["draft", "active", "ended"] as const satisfies readonly ContractStatus[];

export const contractStatusSchema = z.enum(CONTRACT_STATUS_VALUES, { error: "状態を選択してください" });

/** 必要書類のチェック項目 */
export const checklistKeySchema = z.enum(CHECKLIST_KEYS as [ChecklistKey, ...ChecklistKey[]], { error: "書類の種類が不正です" });

const kanaSchema = z.string().trim().max(100, "100 文字以内で入力してください").default("");
const phoneSchema = z.string().trim().max(50, "50 文字以内で入力してください").default("");
const optionalEmailSchema = z
  .string()
  .trim()
  .max(200, "200 文字以内で入力してください")
  .refine((s) => s === "" || /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s), "メールアドレスの形式が正しくありません")
  .default("");
const sourceSchema = z.string().trim().max(100, "100 文字以内で入力してください").default("");
/** やりとりのメモ（1 件ぶん） */
const noteSchema = z.string().trim().max(500, "500 文字以内で入力してください").default("");

// ---------------------------------------------------------------------------
// 応募者
// ---------------------------------------------------------------------------

/** 応募者フォームの入力（クライアント → Server Action） */
export interface ApplicantFormInput {
  /** null = 新規 */
  id: string | null;
  name: string;
  kana: string;
  phone: string;
  email: string;
  /** 応募元（求人サイト・紹介など） */
  source: string;
  /** 新規のときだけ使う（既存の段階は moveApplicantStageAction で変える） */
  stage: ApplicantStage;
  /** "YYYY-MM-DD" */
  applied_on: string;
  /** "" = 未定 */
  interview_on: string;
  memo: string;
}

const applicantFields = {
  name: nameSchema,
  kana: kanaSchema,
  phone: phoneSchema,
  email: optionalEmailSchema,
  source: sourceSchema,
  applied_on: dateSchema,
  interview_on: optionalDateSchema,
  memo: memoSchema,
};

/** 新規登録（段階は既定で「応募」） */
export const createApplicantSchema = z.object({ ...applicantFields, stage: applicantStageSchema.default("applied") });

/** 連絡先などの更新（段階は変えない） */
export const updateApplicantSchema = z.object({ id: uuidSchema, ...applicantFields });

/** 段階を進める／戻す（note があればやりとりにも残す） */
export const moveApplicantStageSchema = z.object({
  id: uuidSchema,
  stage: applicantStageSchema,
  note: noteSchema,
});

/** やりとりの記録 */
export const addApplicantEventSchema = z.object({
  applicant_id: uuidSchema,
  happened_on: dateSchema,
  note: z.string().trim().min(1, "内容を入力してください").max(500, "500 文字以内で入力してください"),
});

/** 必要書類のチェック */
export const toggleChecklistSchema = z.object({
  id: uuidSchema,
  key: checklistKeySchema,
  value: z.boolean(),
});

/** 応募者 → ドライバー登録の入力（既定値は応募者の内容） */
export interface ConvertApplicantInput {
  name: string;
  kana: string;
  phone: string;
  email: string;
  /** 稼働開始日 "YYYY-MM-DD" */
  started_on: string;
}

export const convertApplicantSchema = z.object({
  id: uuidSchema,
  name: nameSchema,
  kana: kanaSchema,
  phone: phoneSchema,
  email: optionalEmailSchema,
  started_on: dateSchema,
});

// ---------------------------------------------------------------------------
// 業務委託契約
// ---------------------------------------------------------------------------

/** 通知日数（0〜365。全角・カンマ可） */
export const noticeDaysSchema = z.preprocess(
  (v) => (v == null || (typeof v === "string" && v.trim() === "") ? 30 : typeof v === "string" ? parseNumberInput(v) : v),
  z
    .number({ error: "通知日数を入力してください" })
    .int("通知日数は整数で入力してください")
    .min(0, "通知日数は 0 以上で入力してください")
    .max(365, "通知日数は 365 以下で入力してください"),
);

/** 契約フォームの入力（クライアント → Server Action） */
export interface ContractFormInput {
  /** null = 新規 */
  id: string | null;
  driver_id: string;
  title: string;
  status: ContractStatus;
  /** "YYYY-MM-DD" */
  start_on: string;
  /** "" = 期限なし */
  end_on: string;
  auto_renew: boolean;
  /** 更新の通知日数（既定 30） */
  notice_days: string;
  /** 契約書ファイルの場所（手入力） */
  file_path: string;
  /** 合意日 "YYYY-MM-DD"（"" = 未入力） */
  agreed_on: string;
  memo: string;
}

export const contractInputSchema = z
  .object({
    id: optionalIdSchema,
    driver_id: z.string().uuid("ドライバーを選択してください"),
    title: z.string().trim().min(1, "契約名を入力してください").max(100, "100 文字以内で入力してください"),
    status: contractStatusSchema,
    start_on: dateSchema,
    end_on: optionalDateSchema,
    auto_renew: z.boolean(),
    notice_days: noticeDaysSchema,
    file_path: z.string().trim().max(500, "500 文字以内で入力してください").default(""),
    agreed_on: optionalDateSchema,
    memo: memoSchema,
  })
  .refine((v) => v.end_on == null || v.end_on >= v.start_on, {
    message: "終了日は開始日と同じか後の日にしてください",
    path: ["end_on"],
  });

/** 契約を終了にする */
export const endContractSchema = z.object({ id: uuidSchema, end_on: dateSchema });

// ---------------------------------------------------------------------------
// 画面のタブ（?tab=）
// ---------------------------------------------------------------------------

export const HR_TABS = ["applicants", "contracts"] as const;
export type HrTab = (typeof HR_TABS)[number];
export const hrTabSchema = z.enum(HR_TABS);

/** URL の ?tab= からタブを取り出す（不正・未指定なら "applicants"） */
export function hrTabFromParam(param: string | string[] | undefined): HrTab {
  const v = Array.isArray(param) ? param[0] : param;
  const parsed = hrTabSchema.safeParse(v);
  return parsed.success ? parsed.data : "applicants";
}

/** CSV の種類（?kind=） */
export const HR_CSV_KINDS = ["applicant", "contract"] as const;
export type HrCsvKind = (typeof HR_CSV_KINDS)[number];
export const hrCsvKindSchema = z.enum(HR_CSV_KINDS);
