import { z } from "zod";
import { uuidSchema } from "./common";

/**
 * 社内チャットの入力スキーマ（サーバー・クライアント共用）
 * 本文の長さは DB の check 制約（length(body) between 1 and 4000）と合わせる。
 * 宛先は profiles.id（v_staff の id）の配列で、RPC chat_post には uuid[] として渡す
 * （保存先の chat_messages.mentions は jsonb の文字列配列）。
 */

/** 発言の本文（前後の空白は落とす。1〜4000 文字） */
export const chatBodySchema = z
  .string()
  .trim()
  .min(1, "メッセージを入力してください")
  .max(4000, "メッセージは 4000 文字以内で入力してください");

/** 宛先（profiles.id の配列。重複は取り除く） */
export const chatMentionsSchema = z
  .array(uuidSchema)
  .max(100, "宛先が多すぎます")
  .transform((ids) => [...new Set(ids)])
  .default([]);

/** ルーム名（DB の check と同じ 1〜60 文字） */
export const channelNameSchema = z
  .string()
  .trim()
  .min(1, "ルーム名を入力してください")
  .max(60, "ルーム名は 60 文字以内で入力してください");

/** ルームの説明（未入力は空文字。更新では「渡されなかった項目」と区別するため既定値を付けない） */
const channelDescriptionBase = z.string().trim().max(200, "説明は 200 文字以内で入力してください");
export const channelDescriptionSchema = channelDescriptionBase.default("");

/** 発言する */
export const postChatMessageSchema = z.object({
  channel_id: uuidSchema,
  body: chatBodySchema,
  mentions: chatMentionsSchema,
});
export type PostChatMessageValues = z.output<typeof postChatMessageSchema>;

/** 発言を直す（本人のみ。RLS でも守られる） */
export const editChatMessageSchema = z.object({
  id: uuidSchema,
  body: chatBodySchema,
});
export type EditChatMessageValues = z.output<typeof editChatMessageSchema>;

/** 発言を消す（本人か owner） */
export const deleteChatMessageSchema = z.object({ id: uuidSchema });

/** ここまで読んだ */
export const markChatReadSchema = z.object({ channel_id: uuidSchema });

/** ルームを追加する（admin 以上） */
export const createChannelSchema = z.object({
  name: channelNameSchema,
  description: channelDescriptionSchema,
});
export type CreateChannelValues = z.output<typeof createChannelSchema>;

/** ルームを直す（admin 以上。渡した項目だけ更新する） */
export const updateChannelSchema = z
  .object({
    id: uuidSchema,
    name: channelNameSchema.optional(),
    description: channelDescriptionBase.optional(),
    is_active: z.boolean().optional(),
  })
  .refine((v) => v.name !== undefined || v.description !== undefined || v.is_active !== undefined, {
    message: "変更する内容がありません",
    path: ["name"],
  });
export type UpdateChannelValues = z.output<typeof updateChannelSchema>;

/** 画面から渡す更新内容（id 以外） */
export interface ChannelPatch {
  name?: string;
  description?: string;
  is_active?: boolean;
}
