"use server";

import { revalidatePath } from "next/cache";
import { requireOwnerAction } from "@/lib/auth/session";
import { ActionError, ensureNoError, runAction, unwrap, type ActionResult } from "@/lib/actions/result";
import { createAdminClient } from "@/lib/supabase/admin";
import { appUrl } from "@/lib/env";
import { ROLE_LABELS, toConfidentialScope, type Role } from "@/lib/db/types";
import type { ServerSupabase } from "@/lib/supabase/server";
import { buildAccessOverrides, canCustomizeAccess } from "@/lib/auth/access";
import {
  cancelInvitationSchema,
  inviteUserSchema,
  resendInvitationSchema,
  setUserAccessSchema,
  setUserActiveSchema,
  transferOwnershipSchema,
  updateUserBasicsSchema,
  updateUserRoleSchema,
  type InviteUserInput,
  type SetUserAccessInput,
  type TransferOwnershipInput,
} from "@/lib/schemas/users";

/** 招待リンク `/invite/<token>` の絶対 URL */
function inviteLinkFor(token: string): string {
  return `${appUrl()}/invite/${token}`;
}

export interface InvitationResult {
  invitationId: string;
  /** 招待リンク（メールが届かない人には LINE 等で直接送る） */
  link: string;
  /** Supabase の招待メールを送信できたか */
  emailSent: boolean;
  /** メール送信できなかった理由など（リンクは有効） */
  warning: string | null;
  expiresAt: string;
}

const EXISTING_USER_GUIDE =
  "既にユーザー登録済みのため招待メールは送信していません。ログイン画面から「メールでログイン」するよう案内するか、招待リンクを直接送ってください。";

function revalidateUsers() {
  revalidatePath("/settings/users");
  revalidatePath("/settings/users/[id]", "page");
}

/** 会社内に同じメールのユーザーが既にいるか（RLS：owner は自社の profiles を参照できる） */
async function profileExists(supabase: ServerSupabase, companyId: string, email: string): Promise<boolean> {
  const res = await supabase.from("profiles").select("id").eq("company_id", companyId).ilike("email", email).limit(1);
  ensureNoError(res);
  return (res.data ?? []).length > 0;
}

/**
 * Supabase の招待メールを送る（サービスロール）。auth ユーザーが作成され、DB トリガーが招待を適用する。
 * 既存ユーザー・キー未設定・送信失敗は警告として返す（招待リンクは有効）。
 */
async function sendInviteEmail(supabase: ServerSupabase, companyId: string, email: string, displayName: string): Promise<{ sent: boolean; warning: string | null }> {
  if (await profileExists(supabase, companyId, email)) return { sent: false, warning: EXISTING_USER_GUIDE };
  let admin: ReturnType<typeof createAdminClient>;
  try {
    admin = createAdminClient();
  } catch {
    return { sent: false, warning: "サーバーの設定（SUPABASE_SERVICE_ROLE_KEY）が無いため招待メールを送信できません。招待リンクを直接送ってください。" };
  }
  const { error } = await admin.auth.admin.inviteUserByEmail(email, {
    redirectTo: `${appUrl()}/`,
    data: displayName ? { display_name: displayName } : undefined,
  });
  if (!error) return { sent: true, warning: null };
  if (/already|registered|exists/i.test(error.message)) return { sent: false, warning: EXISTING_USER_GUIDE };
  if (/rate limit|too many/i.test(error.message)) {
    return { sent: false, warning: "メール送信回数が上限に達したため招待メールを送信できませんでした。しばらく待ってから再送するか、招待リンクを直接送ってください。" };
  }
  return { sent: false, warning: `招待メールを送信できませんでした（${error.message}）。招待リンクを直接送ってください。` };
}

function withWarningMessage<T extends { warning: string | null; emailSent: boolean }>(res: ActionResult<T>, base: string): ActionResult<T> {
  if (!res.ok) return res;
  const parts = [base];
  if (res.data.emailSent) parts.push("招待メールを送信しました。");
  if (res.data.warning) parts.push(res.data.warning);
  return { ...res, message: parts.join(" ") };
}

/** ユーザーを招待（owner）：invitations に行を作成し、招待リンクを返す。sendEmail なら Supabase の招待メールも送る */
export async function inviteUserAction(input: InviteUserInput): Promise<ActionResult<InvitationResult>> {
  const res = await runAction(async () => {
    const { supabase, company } = await requireOwnerAction();
    const parsed = inviteUserSchema.parse(input);
    if (parsed.driverId) await assertDriverInCompany(supabase, company.id, parsed.driverId);

    const inv = unwrap(
      await supabase.rpc("create_invitation", {
        p_email: parsed.email,
        p_role: parsed.role,
        p_driver_id: parsed.driverId ?? undefined,
        p_display_name: parsed.displayName,
      }),
      "招待を作成できませんでした。",
    );

    const mail = parsed.sendEmail ? await sendInviteEmail(supabase, company.id, parsed.email, parsed.displayName) : { sent: false, warning: null };
    revalidateUsers();
    return { invitationId: inv.id, link: inviteLinkFor(inv.token), emailSent: mail.sent, warning: mail.warning, expiresAt: inv.expires_at };
  });
  return withWarningMessage(res, "招待を作成しました。");
}

/** 招待の再送（owner）：同じメール・ロール・ドライバーで招待を作り直し（古い招待は取り消される）、新しいリンクを返す */
export async function resendInvitationAction(invitationId: string, sendEmail = false): Promise<ActionResult<InvitationResult>> {
  const res = await runAction(async () => {
    const { supabase, company } = await requireOwnerAction();
    const parsed = resendInvitationSchema.parse({ invitationId, sendEmail });

    const oldRes = await supabase.from("invitations").select("*").eq("id", parsed.invitationId).eq("company_id", company.id).maybeSingle();
    ensureNoError(oldRes);
    const old = oldRes.data;
    if (!old) throw new ActionError("招待が見つかりません。");
    if (old.cancelled_at) throw new ActionError("この招待は取り消されています。新しく招待してください。");

    const inv = unwrap(
      await supabase.rpc("create_invitation", {
        p_email: old.email,
        p_role: old.role,
        p_driver_id: old.role === "driver" && old.driver_id ? old.driver_id : undefined,
        p_display_name: old.display_name,
      }),
      "招待を作成できませんでした。",
    );
    // 古い招待が受諾済み（メール招待で auth ユーザー作成済み）の場合は関数内で取り消されないため、ここで取り消す
    if (old.accepted_at && !old.link_used_at) {
      ensureNoError(await supabase.from("invitations").update({ cancelled_at: new Date().toISOString() }).eq("id", old.id).eq("company_id", company.id));
    }

    const mail = parsed.sendEmail ? await sendInviteEmail(supabase, company.id, old.email, old.display_name) : { sent: false, warning: null };
    revalidateUsers();
    return { invitationId: inv.id, link: inviteLinkFor(inv.token), emailSent: mail.sent, warning: mail.warning, expiresAt: inv.expires_at };
  });
  return withWarningMessage(res, "招待リンクを再発行しました。");
}

/** 招待の取り消し（owner） */
export async function cancelInvitationAction(invitationId: string): Promise<ActionResult<null>> {
  return runAction(async () => {
    const { supabase, company } = await requireOwnerAction();
    const parsed = cancelInvitationSchema.parse({ invitationId });
    const res = await supabase
      .from("invitations")
      .update({ cancelled_at: new Date().toISOString() })
      .eq("id", parsed.invitationId)
      .eq("company_id", company.id)
      .is("cancelled_at", null)
      .select("id");
    ensureNoError(res);
    if ((res.data ?? []).length === 0) throw new ActionError("招待が見つからないか、既に取り消されています。");
    revalidateUsers();
    return null;
  }, "招待を取り消しました。");
}

/** 対応ドライバーが自社のものか確認する */
async function assertDriverInCompany(supabase: ServerSupabase, companyId: string, driverId: string): Promise<void> {
  const res = await supabase.from("drivers").select("id").eq("id", driverId).eq("company_id", companyId).maybeSingle();
  ensureNoError(res);
  if (!res.data) throw new ActionError("対応ドライバーが見つかりません。", { driverId: ["対応ドライバーが見つかりません"] });
}

/** ロール変更（owner）。driver ロールは対応ドライバー必須。自分自身は不可 */
export async function updateUserRoleAction(userId: string, role: Role, driverId?: string | null): Promise<ActionResult<null>> {
  return runAction(async () => {
    const { supabase, company, user } = await requireOwnerAction();
    const parsed = updateUserRoleSchema.parse({ userId, role, driverId: driverId ?? null });
    if (parsed.userId === user.id) throw new ActionError("自分自身のロール変更・無効化はできません。");
    if (parsed.driverId) await assertDriverInCompany(supabase, company.id, parsed.driverId);

    const res = await supabase
      .from("profiles")
      .update({ role: parsed.role, driver_id: parsed.driverId })
      .eq("id", parsed.userId)
      .eq("company_id", company.id)
      .select("id");
    ensureNoError(res);
    if ((res.data ?? []).length === 0) throw new ActionError("ユーザーが見つかりません。");
    revalidateUsers();
    return null;
  }, `ロールを「${ROLE_LABELS[role] ?? role}」に変更しました。`);
}

/** 無効化／有効化（owner）。自分自身は不可 */
export async function setUserActiveAction(userId: string, isActive: boolean): Promise<ActionResult<null>> {
  return runAction(async () => {
    const { supabase, company, user } = await requireOwnerAction();
    const parsed = setUserActiveSchema.parse({ userId, isActive });
    if (parsed.userId === user.id) throw new ActionError("自分自身のロール変更・無効化はできません。");

    const res = await supabase.from("profiles").update({ is_active: parsed.isActive }).eq("id", parsed.userId).eq("company_id", company.id).select("id, email");
    ensureNoError(res);
    if ((res.data ?? []).length === 0) throw new ActionError("ユーザーが見つかりません。");
    // 無効化したユーザー宛の未使用の招待リンクは取り消す（リンクで再有効化されるのを防ぐ）
    if (!parsed.isActive) {
      const email = res.data?.[0]?.email;
      if (email) {
        ensureNoError(
          await supabase
            .from("invitations")
            .update({ cancelled_at: new Date().toISOString() })
            .eq("company_id", company.id)
            .eq("email", email.toLowerCase())
            .is("cancelled_at", null)
            .is("link_used_at", null),
        );
      }
    }
    revalidateUsers();
    return null;
  }, isActive ? "ユーザーを有効にしました。" : "ユーザーを無効にしました。");
}

/** 自社のユーザーを 1 人読む（RLS：代表は自社の profiles を読める） */
async function loadCompanyProfile(supabase: ServerSupabase, companyId: string, userId: string) {
  const res = await supabase.from("profiles").select("id, role, is_active, email, display_name").eq("id", userId).eq("company_id", companyId).maybeSingle();
  ensureNoError(res);
  if (!res.data) throw new ActionError("ユーザーが見つかりません。");
  return res.data;
}

/**
 * 表示名・最初に開く画面（owner）。相手の画面の出し方を代表が整える。
 * 事務（office）は登録・編集ができるロールだけ（set_start_page と同じ線）
 */
export async function updateUserBasicsAction(input: { userId: string; displayName: string; startPage: string }): Promise<ActionResult<null>> {
  return runAction(async () => {
    const { supabase, company } = await requireOwnerAction();
    const parsed = updateUserBasicsSchema.parse(input);
    const target = await loadCompanyProfile(supabase, company.id, parsed.userId);
    const canOffice = target.role === "owner" || target.role === "admin" || target.role === "clerk";
    if (parsed.startPage === "office" && !canOffice) {
      throw new ActionError("事務の画面は、登録・編集ができるロール（オーナー・管理者・事務員）だけが使えます。", { startPage: ["このロールでは選べません"] });
    }
    const res = await supabase
      .from("profiles")
      .update({ display_name: parsed.displayName, start_page: parsed.startPage })
      .eq("id", parsed.userId)
      .eq("company_id", company.id)
      .select("id");
    ensureNoError(res);
    if ((res.data ?? []).length === 0) throw new ActionError("ユーザーが見つかりません。");
    revalidateUsers();
    return null;
  }, "保存しました。");
}

/**
 * 見せる範囲（owner。0029）。項目ごとに「ロールのとおり／見せる／見せない」。
 * ロールの既定と同じ選択は保存しない（buildAccessOverrides）。代表・ドライバー・自分自身には付けない
 * （DB でも protect_profile_columns が代表以外と自分自身の変更を拒否する）
 */
export async function setUserAccessAction(input: SetUserAccessInput): Promise<ActionResult<null>> {
  return runAction(async () => {
    const { supabase, company, user } = await requireOwnerAction();
    const parsed = setUserAccessSchema.parse(input);
    if (parsed.userId === user.id) throw new ActionError("自分自身の見せる範囲は変えられません。");
    const target = await loadCompanyProfile(supabase, company.id, parsed.userId);
    if (!canCustomizeAccess(target.role)) {
      throw new ActionError(target.role === "owner" ? "代表はいつもすべて見られます。" : "ドライバーには会社の数字を見せられません。");
    }
    const overrides = buildAccessOverrides(target.role, parsed.choices, toConfidentialScope(company.confidential_scope));
    const res = await supabase.from("profiles").update({ access_overrides: overrides }).eq("id", parsed.userId).eq("company_id", company.id).select("id");
    ensureNoError(res);
    if ((res.data ?? []).length === 0) throw new ActionError("ユーザーが見つかりません。");
    revalidateUsers();
    return null;
  }, "見せる範囲を保存しました。次に画面を開いたときから変わります。");
}

/**
 * 代表を譲る（owner。0029）。相手を代表にし、自分は選んだロールになる（RPC transfer_ownership が 1 回で入れ替える）。
 * 成功すると自分はもう代表ではないので、画面側は最初の画面へ移る
 */
export async function transferOwnershipAction(input: TransferOwnershipInput): Promise<ActionResult<{ targetName: string }>> {
  return runAction(async () => {
    const { supabase, company, user } = await requireOwnerAction();
    const parsed = transferOwnershipSchema.parse(input);
    if (parsed.userId === user.id) throw new ActionError("自分には譲れません。譲る相手を選んでください。");
    const target = await loadCompanyProfile(supabase, company.id, parsed.userId);
    ensureNoError(await supabase.rpc("transfer_ownership", { p_to: parsed.userId, p_my_role: parsed.myRole }));
    revalidatePath("/", "layout");
    return { targetName: target.display_name || target.email };
  }, `代表を譲りました。あなたは「${ROLE_LABELS[(input.myRole as Role) ?? "admin"] ?? "管理者"}」になりました。`);
}
