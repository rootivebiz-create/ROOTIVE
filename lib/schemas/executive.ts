import { z } from "zod";
import { memoSchema, nameSchema, uuidSchema } from "./common";
import { dateSchema, optionalDateSchema, optionalIdSchema, optionalMoneySchema, targetMoneySchema } from "./finance";
import { APPROVAL_KIND_LABELS, CONFIDENTIAL_KEY_LABELS, type ApprovalKind } from "@/lib/db/types";

/** 決裁の種別（DB の approval_kind と同じ並び） */
export const APPROVAL_KINDS = Object.keys(APPROVAL_KIND_LABELS) as ApprovalKind[];
export const approvalKindSchema = z.enum(APPROVAL_KINDS as [ApprovalKind, ...ApprovalKind[]]);

const titleSchema = z.string().trim().min(1, "件名を入力してください").max(200, "200 文字以内で入力してください");
const textSchema = z.string().trim().max(4000, "4000 文字以内で入力してください").default("");
const shortTextSchema = z.string().trim().max(200, "200 文字以内で入力してください").default("");

// ---------- 決裁 ----------

/** 代表への申請（admin 以上） */
export const requestApprovalSchema = z.object({
  kind: approvalKindSchema,
  title: titleSchema,
  detail: textSchema,
  amount: optionalMoneySchema,
  ref_table: shortTextSchema,
  ref_id: shortTextSchema,
  href: shortTextSchema,
  due_on: optionalDateSchema,
});
export type RequestApprovalInput = z.input<typeof requestApprovalSchema>;

/** 決裁（代表、または委任された管理者） */
export const decideApprovalSchema = z
  .object({
    id: uuidSchema,
    approve: z.boolean(),
    note: textSchema,
    /** 承認と同時に意思決定ログの下書きを作るか */
    as_decision: z.boolean().default(false),
  })
  .refine((v) => v.approve || v.note.trim().length > 0, {
    message: "却下するときは理由を入れてください",
    path: ["note"],
  });

export const withdrawApprovalSchema = z.object({ id: uuidSchema, note: textSchema });

/** 決裁のルール（代表のみ） */
export const approvalRuleSchema = z.object({
  id: uuidSchema,
  threshold_amount: optionalMoneySchema,
  is_enabled: z.boolean().default(true),
  due_days: z.coerce.number().int().min(0, "0 日以上で入力してください").max(60, "60 日以内で入力してください"),
  label: shortTextSchema,
  note: shortTextSchema,
});

/** 決裁の委任（代表のみ） */
export const delegationSchema = z
  .object({
    id: optionalIdSchema,
    to_profile_id: uuidSchema,
    from_on: dateSchema,
    to_on: dateSchema,
    max_amount: optionalMoneySchema,
    kinds: z.array(approvalKindSchema).default([]),
    is_active: z.boolean().default(true),
    memo: memoSchema,
  })
  .refine((v) => v.to_on >= v.from_on, { message: "終わりの日は始まりの日より後にしてください", path: ["to_on"] });

// ---------- 意思決定ログ ----------

export const decisionSchema = z.object({
  id: optionalIdSchema,
  title: titleSchema,
  context: textSchema,
  decision: textSchema,
  reason: textSchema,
  expected_effect: textSchema,
  amount: optionalMoneySchema,
  decided_on: dateSchema,
  review_on: optionalDateSchema,
  approval_id: optionalIdSchema,
});

/** 振り返り（結果を書くと「振り返り済み」になる） */
export const decisionReviewSchema = z.object({
  id: uuidSchema,
  outcome: textSchema,
  outcome_on: optionalDateSchema,
  status: z.enum(["open", "reviewed", "dropped"]),
});

// ---------- 会社の台帳 ----------

export const companyProfileSchema = z.object({
  corporate_number: z
    .string()
    .trim()
    .refine((v) => v === "" || /^[0-9]{13}$/.test(v), "法人番号は 13 桁の数字です")
    .default(""),
  established_on: optionalDateSchema,
  capital: optionalMoneySchema,
  registered_address: shortTextSchema,
  representative_name: shortTextSchema,
  business_purpose: textSchema,
  transport_office: shortTextSchema,
  transport_number: shortTextSchema,
  transport_notified_on: optionalDateSchema,
  labor_insurance_number: shortTextSchema,
  social_insurance_number: shortTextSchema,
  memo: memoSchema,
});

export const officerSchema = z.object({
  id: optionalIdSchema,
  name: nameSchema,
  title: shortTextSchema,
  appointed_on: optionalDateSchema,
  term_end_on: optionalDateSchema,
  is_active: z.boolean().default(true),
  memo: memoSchema,
  sort_order: z.coerce.number().int().min(0).max(9999).default(0),
});

export const shareholderSchema = z.object({
  id: optionalIdSchema,
  name: nameSchema,
  shares: targetMoneySchema,
  memo: memoSchema,
  sort_order: z.coerce.number().int().min(0).max(9999).default(0),
});

export const insurancePolicySchema = z.object({
  id: optionalIdSchema,
  kind: shortTextSchema,
  insurer: shortTextSchema,
  policy_no: shortTextSchema,
  starts_on: optionalDateSchema,
  expires_on: optionalDateSchema,
  premium: targetMoneySchema,
  covers: textSchema,
  memo: memoSchema,
  is_active: z.boolean().default(true),
});

export const advisorSchema = z.object({
  id: optionalIdSchema,
  kind: shortTextSchema,
  name: nameSchema,
  contact: shortTextSchema,
  fee: targetMoneySchema,
  memo: memoSchema,
  is_active: z.boolean().default(true),
  sort_order: z.coerce.number().int().min(0).max(9999).default(0),
});

export const guaranteeSchema = z.object({
  id: optionalIdSchema,
  lender: shortTextSchema,
  kind: shortTextSchema,
  amount: targetMoneySchema,
  loan_id: optionalIdSchema,
  starts_on: optionalDateSchema,
  ends_on: optionalDateSchema,
  is_active: z.boolean().default(true),
  memo: memoSchema,
});

// ---------- 中期計画 ----------
// 年（from_year / to_year / plan_years.year）は期の決算の年（0031。12 月決算なら暦年と同じ）

const yearSchema = z.coerce.number().int().min(2000, "2000 年以降で入力してください").max(2100, "2100 年までで入力してください");

export const planSchema = z
  .object({
    id: optionalIdSchema,
    name: nameSchema,
    from_year: yearSchema,
    to_year: yearSchema,
    vision: textSchema,
    memo: memoSchema,
    is_active: z.boolean().default(true),
  })
  .refine((v) => v.to_year >= v.from_year, { message: "終わりの期は始まりの期以降にしてください", path: ["to_year"] });

export const planYearSchema = z.object({
  id: uuidSchema,
  bill_target: targetMoneySchema,
  profit_target: targetMoneySchema,
  driver_target: z.coerce.number().int().min(0, "0 以上で入力してください").max(9999, "9999 以内で入力してください"),
  memo: memoSchema,
});

export const spreadPlanYearSchema = z.object({
  plan_id: uuidSchema,
  year: yearSchema,
  weight: z.enum(["even", "actual"]).default("even"),
});

// ---------- 機密の見せ方 ----------

export const CONFIDENTIAL_KEYS = Object.keys(CONFIDENTIAL_KEY_LABELS) as ("loans" | "cash" | "bank_account")[];
// 段階：代表のみ → 管理者まで → 事務員まで（0028）→ 閲覧者まで
const confidentialLevelSchema = z.enum(["owner", "admin", "clerk", "staff"]);
export const confidentialScopeSchema = z.object({
  loans: confidentialLevelSchema,
  cash: confidentialLevelSchema,
  bank_account: confidentialLevelSchema,
});
export type ConfidentialScopeInput = z.infer<typeof confidentialScopeSchema>;
