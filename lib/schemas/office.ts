import { z } from "zod";
import { monthSchema, uuidSchema } from "./common";
import { isManualCloseKey } from "@/lib/office/desk";

/** 事務（/office）の入力（サーバー・クライアント共用） */

/** 今日の報告の催促（一度に送れるのは 100 人まで） */
export const remindReportsSchema = z.object({
  driverIds: z.array(uuidSchema).min(1, "催促する人を選んでください").max(100, "一度に催促できるのは 100 人までです"),
});
export type RemindReportsInput = z.input<typeof remindReportsSchema>;

/** 月締めの手作業の手順にチェックを付ける／外す（アプリが判定できる手順は付けられない） */
export const closeCheckSchema = z.object({
  month: monthSchema,
  key: z.string().refine(isManualCloseKey, "手順の指定が正しくありません"),
  done: z.boolean(),
});
export type CloseCheckInput = z.input<typeof closeCheckSchema>;

/** 最初に開く画面 */
export const START_PAGES = ["dashboard", "office"] as const;
export type StartPage = (typeof START_PAGES)[number];
export const START_PAGE_LABELS: Record<StartPage, string> = {
  dashboard: "ホーム",
  office: "事務",
};
export const startPageSchema = z.enum(START_PAGES, { message: "最初に開く画面の指定が正しくありません" });

/** プロフィールの値から最初に開く画面を決める（知らない値・無い値はホーム） */
export function startPageOf(value: unknown): StartPage {
  return value === "office" ? "office" : "dashboard";
}

/** その画面の URL */
export function startPageHref(page: StartPage): string {
  return page === "office" ? "/office" : "/dashboard";
}
