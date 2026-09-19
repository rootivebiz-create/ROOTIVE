import { z } from "zod";
import { memoSchema, monthSchema, qtySchema, uuidSchema } from "./common";
import { parseNumberInput } from "@/lib/calc/parse";
import { isWorkDate, jstLocalToIso } from "@/lib/daily/helpers";
import type { RollCallMethod } from "@/lib/db/types";

/**
 * 日報・点呼と日別の稼働報告の入力スキーマ（サーバー・クライアント共用）
 *
 * - 日付は "YYYY-MM-DD"、時刻は `datetime-local` 相当の "YYYY-MM-DDTHH:MM"（日本時間として解釈する）
 * - 数値（アルコール検知・走行距離・数量）は全角・カンマ可。空欄は null（＝未入力）
 * - 点呼・業務記録は「渡された項目だけ」を更新する。渡さなかった項目（undefined）は既存の値が残る
 */

/** 点呼の方法（DB の enum roll_call_method と同じ並び） */
export const ROLL_CALL_METHODS = ["face", "phone", "video", "app"] as const satisfies readonly RollCallMethod[];

export const rollCallMethodSchema = z.enum(ROLL_CALL_METHODS, { error: "点呼の方法を選択してください" });

/** 空欄（"" / 空白のみ / null）は null にする */
const emptyToNull = (v: unknown) => (v == null || (typeof v === "string" && v.trim() === "") ? null : v);

/** 数値入力（空欄は null、数値にならない文字はそのまま渡してエラーにする） */
const toNumberOrKeep = (v: unknown) => {
  const e = emptyToNull(v);
  if (e == null) return null;
  if (typeof e !== "string") return e;
  const n = parseNumberInput(e);
  return n == null ? e : n;
};

function decimals(n: number): number {
  const s = n.toString();
  if (s.includes("e-")) return 10;
  const i = s.indexOf(".");
  return i < 0 ? 0 : s.length - i - 1;
}

/** 稼働日 "YYYY-MM-DD" */
export const workDateSchema = z.string().refine(isWorkDate, "日付は YYYY-MM-DD 形式で入力してください");

/** 任意の ID（"" は null＝指定なし） */
export const optionalIdSchema = z.preprocess(emptyToNull, uuidSchema.nullable());

/** `datetime-local` の値（"" は「今の時刻」として扱う） */
export const localDateTimeSchema = z
  .string()
  .trim()
  .refine((s) => s === "" || jstLocalToIso(s) != null, "時刻は YYYY-MM-DD HH:MM の形式で入力してください");

/** アルコール検知の数値（0.000〜9.000、小数 3 桁まで）。空欄は null（未測定） */
export const alcoholSchema = z.preprocess(
  toNumberOrKeep,
  z
    .number({ error: "アルコール検知の数値を入力してください" })
    .min(0, "0.000 以上で入力してください")
    .max(9, "9.000 以下で入力してください")
    .refine((n) => decimals(n) <= 3, "小数は 3 桁までです")
    .nullable(),
);

/** 走行距離・走行メーター（0 以上、小数 1 桁まで）。空欄は null */
export const distanceSchema = z.preprocess(
  toNumberOrKeep,
  z
    .number({ error: "数値を入力してください" })
    .min(0, "0 以上で入力してください")
    .max(999_999, "大きすぎます")
    .refine((n) => decimals(n) <= 1, "小数は 1 桁までです")
    .nullable(),
);

/** 休憩（分）。0〜1440 の整数 */
export const breakMinutesSchema = z.preprocess(
  toNumberOrKeep,
  z
    .number({ error: "休憩時間は数値で入力してください" })
    .int("休憩時間は分単位の整数で入力してください")
    .min(0, "0 分以上で入力してください")
    .max(1440, "1440 分（24 時間）以下で入力してください"),
);

/** 指示事項・事故報告などの短い自由記述 */
export const noteSchema = z.string().trim().max(2000, "2000 文字以内で入力してください");

// ---------------------------------------------------------------------------
// 日報（点呼・業務記録）
// ---------------------------------------------------------------------------

/** 業務前点呼（渡した項目だけ更新する） */
export interface PreRollCallInput {
  /** "" = 今の時刻。"YYYY-MM-DDTHH:MM"（日本時間） */
  at?: string;
  method?: RollCallMethod;
  /** 数値・文字列・null（未測定） */
  alcohol?: string | number | null;
  /** 省略すると alcohol から判定する */
  alcohol_ok?: boolean;
  health_ok?: boolean;
  inspection_ok?: boolean;
  instruction?: string;
}

/** 業務後点呼（渡した項目だけ更新する） */
export interface PostRollCallInput {
  at?: string;
  method?: RollCallMethod;
  alcohol?: string | number | null;
  alcohol_ok?: boolean;
  condition_ok?: boolean;
  /** 事故・違反の報告（空欄＝無し） */
  incident?: string;
}

/** 業務記録（渡した項目だけ更新する） */
export interface WorkRecordInput {
  /** "YYYY-MM-DDTHH:MM"（日本時間）。"" は「今の時刻」 */
  start?: string;
  end?: string;
  break_minutes?: string | number;
  distance_km?: string | number | null;
  odo_start?: string | number | null;
  odo_end?: string | number | null;
  memo?: string;
}

/** 日報の保存（部分更新） */
export interface DailyReportFormInput {
  work_date: string;
  /** スタッフが代理入力するときのドライバー。ドライバー本人は省略（無視される） */
  driver_id?: string | null;
  /** "" = 車両の指定を外す。省略＝変更しない */
  vehicle_id?: string | null;
  pre?: PreRollCallInput;
  post?: PostRollCallInput;
  work?: WorkRecordInput;
}

export const preRollCallSchema = z.object({
  at: localDateTimeSchema.optional(),
  method: rollCallMethodSchema.optional(),
  alcohol: alcoholSchema.optional(),
  alcohol_ok: z.boolean().optional(),
  health_ok: z.boolean().optional(),
  inspection_ok: z.boolean().optional(),
  instruction: noteSchema.optional(),
});

export const postRollCallSchema = z.object({
  at: localDateTimeSchema.optional(),
  method: rollCallMethodSchema.optional(),
  alcohol: alcoholSchema.optional(),
  alcohol_ok: z.boolean().optional(),
  condition_ok: z.boolean().optional(),
  incident: noteSchema.optional(),
});

export const workRecordSchema = z.object({
  start: localDateTimeSchema.optional(),
  end: localDateTimeSchema.optional(),
  break_minutes: breakMinutesSchema.optional(),
  distance_km: distanceSchema.optional(),
  odo_start: distanceSchema.optional(),
  odo_end: distanceSchema.optional(),
  memo: noteSchema.optional(),
});

export const dailyReportInputSchema = z
  .object({
    work_date: workDateSchema,
    driver_id: optionalIdSchema.optional(),
    vehicle_id: optionalIdSchema.optional(),
    pre: preRollCallSchema.optional(),
    post: postRollCallSchema.optional(),
    work: workRecordSchema.optional(),
  })
  .refine((v) => v.pre != null || v.post != null || v.work != null || v.vehicle_id !== undefined, {
    message: "保存する内容がありません",
    path: ["work_date"],
  });

export type DailyReportValues = z.output<typeof dailyReportInputSchema>;

// ---------------------------------------------------------------------------
// 日別の稼働報告
// ---------------------------------------------------------------------------

/** 1 件の稼働報告（数量 0 は削除される） */
export interface DayEntryRowInput {
  project_item_id: string;
  qty: string | number;
}

export const dayEntryRowSchema = z.object({
  project_item_id: uuidSchema,
  qty: qtySchema,
});

export interface SubmitDayEntriesInput {
  work_date: string;
  rows: DayEntryRowInput[];
  /** スタッフが代理入力するときのドライバー。ドライバー本人は省略 */
  driver_id?: string | null;
  memo?: string;
}

export const submitDayEntriesSchema = z
  .object({
    work_date: workDateSchema,
    rows: z.array(dayEntryRowSchema).min(1, "報告する内容を 1 件以上入力してください").max(200, "一度に送れるのは 200 件までです"),
    driver_id: optionalIdSchema.optional(),
    memo: memoSchema,
  })
  .superRefine((v, ctx) => {
    const seen = new Set<string>();
    v.rows.forEach((r, i) => {
      if (seen.has(r.project_item_id)) ctx.addIssue({ code: "custom", message: "同じ案件内容が重複しています", path: ["rows", i, "project_item_id"] });
      seen.add(r.project_item_id);
    });
  });

export type SubmitDayEntriesValues = z.output<typeof submitDayEntriesSchema>;

/** 承認・差戻し（差戻しは理由が必須） */
export const approveDayEntriesSchema = z
  .object({
    ids: z.array(uuidSchema).min(1, "対象を選択してください").max(500, "一度に処理できるのは 500 件までです"),
    approve: z.boolean(),
    reason: z.string().trim().max(500, "500 文字以内で入力してください").default(""),
  })
  .refine((v) => v.approve || v.reason !== "", { message: "差戻しの理由を入力してください", path: ["reason"] });

/** 月次への再反映（RPC apply_day_entries） */
export const applyDayEntriesSchema = z.object({ month: monthSchema });

// ---------------------------------------------------------------------------
// 画面のタブ（?tab=）
// ---------------------------------------------------------------------------

export const DAY_TABS = ["reports", "entries"] as const;
export type DayTab = (typeof DAY_TABS)[number];
export const dayTabSchema = z.enum(DAY_TABS);

/** URL の ?tab= からタブを取り出す（不正・未指定なら "reports"） */
export function dayTabFromParam(param: string | string[] | undefined): DayTab {
  const v = Array.isArray(param) ? param[0] : param;
  const parsed = dayTabSchema.safeParse(v);
  return parsed.success ? parsed.data : "reports";
}
