import { z } from "zod";
import { memoSchema, monthSchema, uuidSchema } from "./common";
import { ALERT_STATUSES, type AlertStatus } from "@/lib/db/types";

/**
 * 異常の検知とアラートの入力スキーマ（サーバー・クライアント共用）
 * 月は "YYYY-MM"（DB へ渡すときに monthToDate で月初日にする）。
 */

/** 状態（未対応・対応済み・対象外） */
export const alertStatusSchema = z.enum(ALERT_STATUSES as [AlertStatus, ...AlertStatus[]], { error: "状態を選択してください" });

/** 一覧の絞り込み（?status=）。"all" はすべて */
export const ALERT_FILTERS = [...ALERT_STATUSES, "all"] as const;
export type AlertFilter = (typeof ALERT_FILTERS)[number];

export const alertFilterSchema = z.enum(ALERT_FILTERS);

/** URL の ?status= から絞り込みを取り出す（不正・未指定なら "open"） */
export function alertFilterFromParam(param: string | string[] | undefined): AlertFilter {
  const v = Array.isArray(param) ? param[0] : param;
  const parsed = alertFilterSchema.safeParse(v);
  return parsed.success ? parsed.data : "open";
}

/** 検査の実行（RPC detect_anomalies） */
export const detectAnomaliesSchema = z.object({ month: monthSchema });

/** 状態の変更（RPC set_alert_status） */
export interface SetAlertStatusInput {
  id: string;
  status: AlertStatus;
  /** 空欄なら今のメモを残す */
  note?: string;
}

export const setAlertStatusSchema = z.object({
  id: uuidSchema,
  status: alertStatusSchema,
  note: memoSchema,
});

export type SetAlertStatusValues = z.output<typeof setAlertStatusSchema>;
