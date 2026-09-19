import { z } from "zod";
import { monthSchema, uuidSchema } from "./common";
import { LINE_LINK_CODE_RE } from "@/lib/integrations/types";

/**
 * 外部連携の入力スキーマ（サーバー・クライアント共用）。
 * 機密の入力欄は「空文字＝保存済みの値をそのまま使う」ため、必須にしない。
 */

const secret = (label: string, max: number) =>
  z
    .string()
    .trim()
    .max(max, `${label}は ${max} 文字以内で入力してください`)
    .default("");

/** LINE の設定フォーム（クライアント → Server Action） */
export interface LineSettingsFormInput {
  /** 空文字なら保存済みのトークンを保持する */
  channelAccessToken: string;
  channelSecret: string;
  notifyStatement: boolean;
  notifyAlerts: boolean;
}

export const lineSettingsSchema = z.object({
  channelAccessToken: secret("チャネルアクセストークン", 500),
  channelSecret: secret("チャネルシークレット", 200),
  notifyStatement: z.boolean(),
  notifyAlerts: z.boolean(),
});

/** Google ドライブの設定フォーム（クライアント → Server Action） */
export interface DriveSettingsFormInput {
  /** いずれも空文字なら保存済みの値を保持する */
  clientId: string;
  clientSecret: string;
  refreshToken: string;
  folderId: string;
  autoBackup: boolean;
}

export const driveSettingsSchema = z.object({
  clientId: secret("クライアント ID", 300),
  clientSecret: secret("クライアントシークレット", 300),
  refreshToken: secret("リフレッシュトークン", 500),
  folderId: secret("フォルダ ID", 200),
  autoBackup: z.boolean(),
});

/** 連携の合言葉（6 桁の数字） */
export const lineLinkCodeSchema = z
  .string()
  .trim()
  .regex(LINE_LINK_CODE_RE, "合言葉は 6 桁の数字です");

/** LINE の連携解除（driverId を省略すると自分自身） */
export const unlinkLineSchema = z.object({
  driverId: uuidSchema.nullish(),
});

/** 支払明細の通知（稼動月） */
export const notifyStatementsSchema = z.object({
  month: monthSchema,
});
