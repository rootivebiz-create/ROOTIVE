import { z } from "zod";
import { qtySchema, uuidSchema } from "./common";

/**
 * 配車・シフトの入力（サーバー・クライアント共用）
 */

/** "YYYY-MM-DD" */
export const dateSchema = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/, "日付は YYYY-MM-DD で指定してください");

/** 曜日（0 = 日曜） */
export const weekdaySchema = z.number().int().min(0, "曜日が不正です").max(6, "曜日が不正です");

/** 必要人数・割り当ての人数 */
export const needSchema = z.number().int().min(0, "0 以上で入力してください").max(200, "多すぎます");

/** 配車 1 件（qty_plan が 0 なら外す） */
export const dispatchRowSchema = z.object({
  on_date: dateSchema,
  driver_id: uuidSchema,
  project_item_id: uuidSchema,
  qty_plan: qtySchema,
});

export const setDispatchSchema = z.object({
  rows: z.array(dispatchRowSchema).min(1, "保存する配車がありません").max(500, "一度に保存できる件数を超えています"),
});

export const copyWeekSchema = z.object({ from_start: dateSchema, to_start: dateSchema });

export const dispatchRangeSchema = z
  .object({ from: dateSchema, to: dateSchema })
  .refine((v) => v.from <= v.to, { message: "期間の指定が逆になっています", path: ["to"] });

export const projectDemandSchema = z.object({
  project_item_id: uuidSchema,
  weekday: weekdaySchema,
  need: needSchema,
});

export const projectDemandDaySchema = z.object({
  project_item_id: uuidSchema,
  on_date: dateSchema,
  /** null なら「特定日の指定をやめる」（曜日のパターンに戻す） */
  need: needSchema.nullable(),
  note: z.string().max(200, "メモが長すぎます").default(""),
});

export const dayOffRequestSchema = z.object({
  on_date: dateSchema,
  reason: z.string().max(200, "理由が長すぎます").default(""),
});

export const dayOffDecisionSchema = z.object({
  id: uuidSchema,
  approve: z.boolean(),
  note: z.string().max(200, "メモが長すぎます").default(""),
});

export const weeklyOffSchema = z.object({
  driver_id: uuidSchema,
  weekdays: z.array(weekdaySchema).max(7, "曜日が多すぎます"),
});

export type DispatchRowInput = z.input<typeof dispatchRowSchema>;
export type ProjectDemandInput = z.input<typeof projectDemandSchema>;
export type ProjectDemandDayInput = z.input<typeof projectDemandDaySchema>;
export type DayOffRequestInput = z.input<typeof dayOffRequestSchema>;
export type DayOffDecisionInput = z.input<typeof dayOffDecisionSchema>;
export type WeeklyOffInput = z.input<typeof weeklyOffSchema>;

/** set_dispatch_bulk の戻り値 */
export interface SetDispatchResult {
  inserted: number;
  updated: number;
  deleted: number;
}
