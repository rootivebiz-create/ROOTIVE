import { z } from "zod";
import { memoSchema, moneySchema, uuidSchema } from "./common";
import { isDateString, optionalDateSchema, optionalIdSchema } from "./expenses";
import { parseNumberInput } from "@/lib/calc/parse";
import { isLocalDateTime, localInputToIso } from "@/lib/fleet/helpers";
import { DOCUMENT_KINDS, type DocumentKind, type IncidentKind, type VehicleOwnership } from "@/lib/db/types";

/**
 * 車両・書類・安全管理（安全管理者・指導監督・事故）の入力スキーマ（サーバー・クライアント共用）。
 * 数値・日付はクライアントから文字列で受け取り、zod で正規化する（全角・カンマ可、空欄は null）。
 * 日付は "YYYY-MM-DD"、事故の発生日時だけ datetime-local（"YYYY-MM-DDTHH:mm"、日本時間）で受け取る。
 */

// ---------------------------------------------------------------------------
// 共通の部品
// ---------------------------------------------------------------------------

/** 車両の所有区分 */
export const VEHICLE_OWNERSHIPS = ["owned", "lease", "driver"] as const satisfies readonly VehicleOwnership[];

/** 事故・違反・ヒヤリハットの種類 */
export const INCIDENT_KINDS = ["accident", "violation", "near_miss"] as const satisfies readonly IncidentKind[];

/** 指導・監督の種類（driver_instructions.kind の CHECK と同じ） */
export const INSTRUCTION_KINDS = ["initial", "regular", "accident", "elderly", "special"] as const;
export type InstructionKind = (typeof INSTRUCTION_KINDS)[number];

/** 必須の日付 "YYYY-MM-DD" */
export const requiredDateSchema = z.string().refine(isDateString, "日付は YYYY-MM-DD 形式で入力してください");

/** 短いテキスト（空欄可） */
const text = (max: number) =>
  z
    .string()
    .trim()
    .max(max, `${max} 文字以内で入力してください`);

/** 空欄は 0 として扱う金額（税抜・0 以上） */
export const moneyOrZeroSchema = z.preprocess((v) => (typeof v === "string" && v.trim() === "" ? 0 : v), moneySchema);

/** 整数（全角・カンマ可）。空欄は既定値 */
const intFromInput = (min: number, max: number, label: string, fallback: number) =>
  z.preprocess(
    (v) => (v == null || (typeof v === "string" && v.trim() === "") ? fallback : typeof v === "string" ? parseNumberInput(v) : v),
    z
      .number({ error: `${label}を入力してください` })
      .int(`${label}は整数で入力してください`)
      .min(min, `${label}は ${min} 以上で入力してください`)
      .max(max, `${label}は ${max} 以下で入力してください`),
  );

/** 小数 1 桁までの数値（空欄は null）。走行距離用 */
const optionalDecimalSchema = z.preprocess(
  (v) => (v == null || (typeof v === "string" && v.trim() === "") ? null : typeof v === "string" ? parseNumberInput(v) : v),
  z
    .number({ error: "数値を入力してください" })
    .min(0, "0 以上で入力してください")
    .max(9_999_999, "大きすぎます")
    .refine((n) => Math.abs(n * 10 - Math.round(n * 10)) < 1e-9, "小数は 1 桁までです")
    .nullable(),
);

// ---------------------------------------------------------------------------
// 車両
// ---------------------------------------------------------------------------

export interface VehicleFormInput {
  /** null = 新規 */
  id: string | null;
  /** 車両番号（会社内で重複不可） */
  plate: string;
  maker: string;
  model: string;
  ownership: VehicleOwnership;
  /** "" = 割当なし */
  driver_id: string;
  /** 月額リース料（税抜）。"" = 0 */
  lease_monthly: string;
  /** 走行距離（km）。"" = 未入力 */
  odometer: string;
  memo: string;
  is_active: boolean;
}

export const vehicleInputSchema = z.object({
  id: optionalIdSchema,
  plate: z.string().trim().min(1, "車両番号を入力してください").max(40, "40 文字以内で入力してください"),
  maker: text(50),
  model: text(50),
  ownership: z.enum(VEHICLE_OWNERSHIPS, { error: "所有区分を選択してください" }),
  driver_id: optionalIdSchema,
  lease_monthly: moneyOrZeroSchema,
  odometer: optionalDecimalSchema,
  memo: memoSchema,
  is_active: z.boolean(),
});

export type VehicleValues = z.output<typeof vehicleInputSchema>;

// ---------------------------------------------------------------------------
// 書類と期限
// ---------------------------------------------------------------------------

export interface DocumentFormInput {
  /** null = 新規 */
  id: string | null;
  kind: DocumentKind;
  /** ドライバーの書類なら ID（車両の書類なら ""） */
  driver_id: string;
  /** 車両の書類なら ID（ドライバーの書類なら ""） */
  vehicle_id: string;
  label: string;
  number: string;
  /** "" = 未設定 */
  issued_on: string;
  /** "" = 未設定 */
  expires_on: string;
  /** 何日前から知らせるか（既定 60） */
  reminder_days: string;
  memo: string;
  is_active: boolean;
}

export const documentInputSchema = z
  .object({
    id: optionalIdSchema,
    kind: z.enum(DOCUMENT_KINDS, { error: "書類の種類を選択してください" }),
    driver_id: optionalIdSchema,
    vehicle_id: optionalIdSchema,
    label: text(100),
    number: text(100),
    issued_on: optionalDateSchema,
    expires_on: optionalDateSchema,
    reminder_days: intFromInput(0, 365, "通知のタイミング", 60),
    memo: memoSchema,
    is_active: z.boolean(),
  })
  .superRefine((v, ctx) => {
    if (v.driver_id == null && v.vehicle_id == null) {
      ctx.addIssue({ code: "custom", message: "対象（ドライバーまたは車両）を選んでください", path: ["driver_id"] });
    }
    if (v.driver_id != null && v.vehicle_id != null) {
      ctx.addIssue({ code: "custom", message: "対象はドライバーか車両のどちらか一方にしてください", path: ["vehicle_id"] });
    }
    if (v.issued_on != null && v.expires_on != null && v.expires_on < v.issued_on) {
      ctx.addIssue({ code: "custom", message: "有効期限は取得日と同じか後の日にしてください", path: ["expires_on"] });
    }
  });

export type DocumentValues = z.output<typeof documentInputSchema>;

// ---------------------------------------------------------------------------
// 貨物軽自動車安全管理者
// ---------------------------------------------------------------------------

export interface SafetyManagerFormInput {
  /** null = 新規 */
  id: string | null;
  name: string;
  /** 営業所（空欄なら「本店」） */
  office: string;
  /** "" = 指定なし（ドライバー本人が管理者のとき） */
  driver_id: string;
  /** 選任日 */
  appointed_on: string;
  /** 講習の受講日 */
  training_on: string;
  /** 次回講習の期限（空欄なら受講日の 2 年後として扱う） */
  training_expires_on: string;
  /** 運輸支局への届出日 */
  notified_on: string;
  memo: string;
  is_active: boolean;
}

export const safetyManagerInputSchema = z
  .object({
    id: optionalIdSchema,
    name: z.string().trim().min(1, "氏名を入力してください").max(100, "100 文字以内で入力してください"),
    office: z
      .string()
      .trim()
      .max(100, "100 文字以内で入力してください")
      .transform((s) => (s === "" ? "本店" : s)),
    driver_id: optionalIdSchema,
    appointed_on: optionalDateSchema,
    training_on: optionalDateSchema,
    training_expires_on: optionalDateSchema,
    notified_on: optionalDateSchema,
    memo: memoSchema,
    is_active: z.boolean(),
  })
  .superRefine((v, ctx) => {
    if (v.training_on != null && v.training_expires_on != null && v.training_expires_on < v.training_on) {
      ctx.addIssue({ code: "custom", message: "次回講習の期限は受講日と同じか後の日にしてください", path: ["training_expires_on"] });
    }
  });

export type SafetyManagerValues = z.output<typeof safetyManagerInputSchema>;

// ---------------------------------------------------------------------------
// 指導・監督の記録
// ---------------------------------------------------------------------------

export interface InstructionFormInput {
  /** null = 新規 */
  id: string | null;
  driver_id: string;
  kind: InstructionKind;
  instructed_on: string;
  /** 実施時間（時間。小数 2 桁まで） */
  hours: string;
  topics: string;
  instructor: string;
  memo: string;
}

export const instructionInputSchema = z.object({
  id: optionalIdSchema,
  driver_id: uuidSchema,
  kind: z.enum(INSTRUCTION_KINDS, { error: "種類を選択してください" }),
  instructed_on: requiredDateSchema,
  hours: z.preprocess(
    (v) => (v == null || (typeof v === "string" && v.trim() === "") ? 0 : typeof v === "string" ? parseNumberInput(v) : v),
    z
      .number({ error: "実施時間を入力してください" })
      .min(0, "0 以上で入力してください")
      .max(999.99, "実施時間が大きすぎます")
      .refine((n) => Math.abs(n * 100 - Math.round(n * 100)) < 1e-9, "小数は 2 桁までです"),
  ),
  topics: text(1000),
  instructor: text(100),
  memo: memoSchema,
});

export type InstructionValues = z.output<typeof instructionInputSchema>;

// ---------------------------------------------------------------------------
// 適性診断（0024）
// ---------------------------------------------------------------------------

export const APTITUDE_KINDS = ["initial", "age", "specific", "general"] as const;
export type AptitudeKindInput = (typeof APTITUDE_KINDS)[number];

export interface AptitudeFormInput {
  id: string | null;
  driver_id: string;
  kind: AptitudeKindInput;
  /** "YYYY-MM-DD" */
  taken_on: string;
  institution: string;
  result: string;
  memo: string;
}

export const aptitudeInputSchema = z.object({
  id: optionalIdSchema,
  driver_id: uuidSchema,
  kind: z.enum(APTITUDE_KINDS, { error: "種類を選択してください" }),
  taken_on: requiredDateSchema,
  institution: text(100),
  result: text(200),
  memo: memoSchema,
});

export type AptitudeValues = z.output<typeof aptitudeInputSchema>;

// ---------------------------------------------------------------------------
// 事故・違反・ヒヤリハット
// ---------------------------------------------------------------------------

export interface IncidentFormInput {
  /** null = 新規 */
  id: string | null;
  /** "" = 指定なし */
  driver_id: string;
  /** "" = 指定なし */
  vehicle_id: string;
  /** 発生日時（日本時間の "YYYY-MM-DDTHH:mm"） */
  occurred_at: string;
  kind: IncidentKind;
  place: string;
  description: string;
  cause: string;
  prevention: string;
  reported: boolean;
  /** 費用（修理費・賠償など。税抜）。"" = 0 */
  cost: string;
  memo: string;
}

export const incidentInputSchema = z.object({
  id: optionalIdSchema,
  driver_id: optionalIdSchema,
  vehicle_id: optionalIdSchema,
  occurred_at: z
    .string()
    .refine(isLocalDateTime, "発生日時を入力してください")
    .transform((s) => localInputToIso(s) as string),
  kind: z.enum(INCIDENT_KINDS, { error: "種類を選択してください" }),
  place: text(200),
  description: text(2000),
  cause: text(2000),
  prevention: text(2000),
  reported: z.boolean(),
  cost: moneyOrZeroSchema,
  memo: memoSchema,
});

export type IncidentValues = z.output<typeof incidentInputSchema>;

// ---------------------------------------------------------------------------
// 画面のタブ・CSV の種類
// ---------------------------------------------------------------------------

export const FLEET_TABS = ["vehicles", "documents"] as const;
export type FleetTab = (typeof FLEET_TABS)[number];
export const fleetTabSchema = z.enum(FLEET_TABS);

/** ?tab=vehicles|documents（不正・未指定は vehicles） */
export function fleetTabFromParam(param: string | string[] | undefined): FleetTab {
  const raw = Array.isArray(param) ? param[0] : param;
  const parsed = fleetTabSchema.safeParse(raw);
  return parsed.success ? parsed.data : "vehicles";
}

/** CSV の種類（?kind=vehicle|document） */
export const FLEET_CSV_KINDS = ["vehicle", "document"] as const;
export type FleetCsvKind = (typeof FLEET_CSV_KINDS)[number];
export const fleetCsvKindSchema = z.enum(FLEET_CSV_KINDS, { error: "出力の種類は vehicle か document で指定してください" });
