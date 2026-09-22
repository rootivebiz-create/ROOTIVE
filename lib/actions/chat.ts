"use server";

import { revalidatePath } from "next/cache";
import { after } from "next/server";
import { requireAdminAction, requireStaffAction } from "@/lib/auth/session";
import { ensureNoError, runAction, unwrap, type ActionResult } from "@/lib/actions/result";
import {
  createChannelSchema,
  deleteChatMessageSchema,
  editChatMessageSchema,
  markChatReadSchema,
  postChatMessageSchema,
  updateChannelSchema,
  type ChannelPatch,
} from "@/lib/schemas/chat";

/**
 * 社内チャットの Server Actions
 *
 * 規約どおり requireXxxAction() → zod → DB（RPC か supabase-js／RLS 適用）→ revalidatePath → ActionResult。
 * - 発言の閲覧・作成はスタッフ全員（閲覧者も発言できる）。編集は本人、削除は本人か owner（RLS が守る）
 * - ルームの作成・編集は admin 以上
 */

/** チャットの変更が影響する画面（ナビの未読バッジのために一覧も更新する） */
function revalidateChat(channelId?: string): void {
  revalidatePath("/chat");
  if (channelId) revalidatePath(`/chat/${channelId}`);
}

/** 発言する（staff。閲覧者も可）。宛先は profiles.id の配列（RPC へは uuid[] で渡す） */
export async function postChatMessageAction(channelId: string, body: string, mentions: string[] = []): Promise<ActionResult<{ id: string }>> {
  return runAction(async () => {
    const { supabase, company, profile } = await requireStaffAction();
    const v = postChatMessageSchema.parse({ channel_id: channelId, body, mentions });
    const { data, error } = await supabase.rpc("chat_post", {
      p_channel_id: v.channel_id,
      p_body: v.body,
      p_mentions: v.mentions,
    });
    if (error) throw error;
    revalidateChat(v.channel_id);

    // 通知は返事を返したあとに送る（after）。送信に失敗しても発言は保存されている
    after(async () => {
      const { notifyChatMessage } = await import("@/lib/push/notify-chat");
      await notifyChatMessage({
        companyId: company.id,
        channelId: v.channel_id,
        authorId: profile.id,
        body: v.body,
        mentions: v.mentions,
      }).catch(() => undefined);
    });

    return { id: String(data ?? "") };
  });
}

/** 発言を直す（本人のみ。他人の発言は RLS が弾く） */
export async function editChatMessageAction(messageId: string, body: string): Promise<ActionResult<{ id: string }>> {
  return runAction(async () => {
    const { supabase, company, profile } = await requireStaffAction();
    const v = editChatMessageSchema.parse({ id: messageId, body });
    const row = unwrap<{ id: string; channel_id: string }>(
      await supabase
        .from("chat_messages")
        .update({ body: v.body, edited_at: new Date().toISOString() })
        .eq("id", v.id)
        .eq("company_id", company.id)
        .eq("author_id", profile.id)
        .select("id, channel_id")
        .maybeSingle(),
      "対象の発言が見つかりません（自分の発言だけ編集できます）。",
    );
    revalidateChat(row.channel_id);
    return { id: row.id };
  }, "発言を編集しました");
}

/** 発言を消す（本人か owner。権限は RLS が判定する） */
export async function deleteChatMessageAction(messageId: string): Promise<ActionResult<{ id: string }>> {
  return runAction(async () => {
    const { supabase, company } = await requireStaffAction();
    const v = deleteChatMessageSchema.parse({ id: messageId });
    const row = unwrap<{ id: string; channel_id: string }>(
      await supabase.from("chat_messages").delete().eq("id", v.id).eq("company_id", company.id).select("id, channel_id").maybeSingle(),
      "対象の発言が見つかりません（自分の発言かオーナーだけ削除できます）。",
    );
    revalidateChat(row.channel_id);
    return { id: row.id };
  }, "発言を削除しました");
}

/** ここまで読んだ（staff）。画面を開いたときに 1 回だけ呼ぶ */
export async function markChatReadAction(channelId: string): Promise<ActionResult<{ channel_id: string }>> {
  return runAction(async () => {
    const { supabase } = await requireStaffAction();
    const v = markChatReadSchema.parse({ channel_id: channelId });
    const { error } = await supabase.rpc("chat_mark_read", { p_channel_id: v.channel_id });
    if (error) throw error;
    revalidateChat(v.channel_id);
    return { channel_id: v.channel_id };
  });
}

/** ルームを追加する（admin+）。並び順は末尾 */
export async function createChannelAction(name: string, description = ""): Promise<ActionResult<{ id: string }>> {
  return runAction(async () => {
    const { supabase, company, profile } = await requireAdminAction();
    const v = createChannelSchema.parse({ name, description });

    const lastRes = await supabase
      .from("chat_channels")
      .select("sort_order")
      .eq("company_id", company.id)
      .order("sort_order", { ascending: false })
      .limit(1)
      .maybeSingle();
    ensureNoError(lastRes);
    const sortOrder = Number(lastRes.data?.sort_order ?? 0) + 1;

    const row = unwrap<{ id: string }>(
      await supabase
        .from("chat_channels")
        .insert({ company_id: company.id, name: v.name, description: v.description, sort_order: sortOrder, created_by: profile.id })
        .select("id")
        .maybeSingle(),
      "ルームを作成できませんでした。",
    );
    revalidateChat(row.id);
    return { id: row.id };
  }, "ルームを追加しました");
}

/** ルームを直す（admin+）。渡した項目だけ更新する */
export async function updateChannelAction(id: string, patch: ChannelPatch): Promise<ActionResult<{ id: string }>> {
  return runAction(async () => {
    const { supabase, company } = await requireAdminAction();
    const v = updateChannelSchema.parse({ id, ...patch });
    const values: { name?: string; description?: string; is_active?: boolean } = {};
    if (v.name !== undefined) values.name = v.name;
    if (v.description !== undefined) values.description = v.description;
    if (v.is_active !== undefined) values.is_active = v.is_active;

    const row = unwrap<{ id: string }>(
      await supabase.from("chat_channels").update(values).eq("id", v.id).eq("company_id", company.id).select("id").maybeSingle(),
      "対象のルームが見つかりません。",
    );
    revalidateChat(row.id);
    return { id: row.id };
  }, "ルームを更新しました");
}
