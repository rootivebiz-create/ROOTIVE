"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { appUrl } from "@/lib/env";
import { emailSchema } from "@/lib/schemas/common";
import { getSessionContext } from "@/lib/auth/session";
import { recordLoginEvent } from "@/lib/auth/login-events";

export interface AuthFormState {
  ok?: boolean;
  error?: string;
  message?: string;
}

/** リダイレクト先は同一サイト内の絶対パスのみ許可（"//" や "/\\" による外部サイトへの誘導を防ぐ） */
function safeNext(next: unknown): string {
  return typeof next === "string" && /^\/(?![\/\\])[^\s]*$/.test(next) && !next.includes("\\") ? next : "/dashboard";
}

function translateAuthError(message: string): string {
  const m = message.toLowerCase();
  if (m.includes("invalid login credentials")) return "メールアドレスまたはパスワードが正しくありません。";
  if (m.includes("signups not allowed") || m.includes("signup") || m.includes("user not found")) return "このメールアドレスは招待されていません。オーナーに招待を依頼してください。";
  if (m.includes("rate limit") || m.includes("too many")) return "送信回数が上限に達しました。しばらく待ってから再度お試しください。";
  if (m.includes("expired") || m.includes("invalid") || m.includes("otp")) return "リンクの有効期限が切れているか、無効です。もう一度ログインをお試しください。";
  if (m.includes("email not confirmed")) return "メールアドレスが確認されていません。";
  if (m.includes("password") && m.includes("least")) return "パスワードは 8 文字以上にしてください。";
  if (m.includes("招待が必要")) return "招待が必要です。オーナーに招待を依頼してください。";
  return message;
}

/** マジックリンク送信（招待済みユーザーのみ。自由登録は不可） */
export async function sendMagicLinkAction(_prev: AuthFormState, formData: FormData): Promise<AuthFormState> {
  const parsed = emailSchema.safeParse(formData.get("email"));
  if (!parsed.success) return { error: "メールアドレスの形式が正しくありません。" };
  const next = safeNext(formData.get("next"));
  const supabase = await createClient();
  const { error } = await supabase.auth.signInWithOtp({
    email: parsed.data,
    // メールテンプレートは {{ .SiteURL }}/auth/confirm?...&next={{ .RedirectTo }} を組み立てるため、ここには最終的な遷移先を渡す
    options: { shouldCreateUser: false, emailRedirectTo: `${appUrl()}${next}` },
  });
  if (error) return { error: translateAuthError(error.message) };
  return { ok: true, message: `${parsed.data} にログイン用のリンクを送信しました。メールを開いてリンクをタップしてください（届かない場合は迷惑メールフォルダも確認してください）。` };
}

/** パスワードでログイン */
export async function signInWithPasswordAction(_prev: AuthFormState, formData: FormData): Promise<AuthFormState> {
  const schema = z.object({ email: emailSchema, password: z.string().min(1, "パスワードを入力してください") });
  const parsed = schema.safeParse({ email: formData.get("email"), password: formData.get("password") });
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "入力内容を確認してください。" };
  const next = safeNext(formData.get("next"));
  const supabase = await createClient();
  const { data, error } = await supabase.auth.signInWithPassword(parsed.data);
  if (error) return { error: translateAuthError(error.message) };
  // ログインの記録（代表だけが見られる。失敗してもログインは止めない）
  await recordLoginEvent(data.user?.id, "login", { headers: await headers() });
  redirect(next);
}

/** パスワード再設定メール */
export async function sendPasswordResetAction(_prev: AuthFormState, formData: FormData): Promise<AuthFormState> {
  const parsed = emailSchema.safeParse(formData.get("email"));
  if (!parsed.success) return { error: "メールアドレスの形式が正しくありません。" };
  const supabase = await createClient();
  const { error } = await supabase.auth.resetPasswordForEmail(parsed.data, { redirectTo: `${appUrl()}/settings/account?reset=1` });
  if (error) return { error: translateAuthError(error.message) };
  return { ok: true, message: "パスワード再設定用のリンクを送信しました。" };
}

/** ログアウト */
export async function signOutAction(): Promise<void> {
  const supabase = await createClient();
  await supabase.auth.signOut();
  redirect("/login");
}

/** 招待リンクからのログイン（メール不要）。トークンを検証し、auth ユーザーを作成してその場でセッションを発行する */
export async function acceptInviteAction(_prev: AuthFormState, formData: FormData): Promise<AuthFormState> {
  const token = String(formData.get("token") ?? "");
  if (!/^[a-f0-9]{32,128}$/i.test(token)) return { error: "招待リンクが不正です。" };

  let admin;
  try {
    admin = createAdminClient();
  } catch {
    return { error: "サーバーの設定（SUPABASE_SERVICE_ROLE_KEY）が不足しているため招待リンクを処理できません。管理者に連絡してください。" };
  }

  const { data: inv, error: invErr } = await admin.from("invitations").select("*").eq("token", token).maybeSingle();
  if (invErr) return { error: `招待の確認に失敗しました: ${invErr.message}` };
  if (!inv) return { error: "招待リンクが見つかりません。" };
  if (inv.cancelled_at) return { error: "この招待は取り消されています。" };
  if (inv.link_used_at) return { error: "この招待リンクは既に使用されています。ログイン画面からメールアドレスでログインしてください。" };
  if (new Date(inv.expires_at).getTime() < Date.now()) return { error: "招待リンクの有効期限が切れています。オーナーに再送を依頼してください。" };

  const email = inv.email.toLowerCase();

  // 招待リンクは 1 回限り：先に使用済みにする（同時アクセスでも 1 回しか通らない）
  const { data: claimed, error: claimErr } = await admin
    .from("invitations")
    .update({ link_used_at: new Date().toISOString() })
    .eq("id", inv.id)
    .is("link_used_at", null)
    .select("id");
  if (claimErr) return { error: `招待の確認に失敗しました: ${claimErr.message}` };
  if (!claimed || claimed.length === 0) return { error: "この招待リンクは既に使用されています。ログイン画面からメールアドレスでログインしてください。" };
  const releaseClaim = async () => {
    await admin.from("invitations").update({ link_used_at: null }).eq("id", inv.id);
  };

  // 既存ユーザーか（profiles をサービスロールで検索。メールは完全一致・小文字）
  const { data: existing } = await admin.from("profiles").select("id").eq("email", email).maybeSingle();
  let userId = existing?.id ?? null;

  if (!userId) {
    const { data: created, error: createErr } = await admin.auth.admin.createUser({ email, email_confirm: true, user_metadata: { display_name: inv.display_name } });
    if (createErr) {
      // 既に auth 側にだけ存在する場合はメールで検索する
      const msg = createErr.message ?? "";
      if (/already|registered|exists/i.test(msg)) {
        const { data: list } = await admin.auth.admin.listUsers({ page: 1, perPage: 1000 });
        userId = list?.users.find((u) => (u.email ?? "").toLowerCase() === email)?.id ?? null;
      }
      if (!userId) {
        await releaseClaim();
        return { error: `ユーザーの作成に失敗しました: ${translateAuthError(msg)}` };
      }
    } else {
      userId = created.user.id;
    }
  }

  // 既存ユーザー・招待未反映のユーザーには招待内容（ロール・ドライバー）を適用する
  const { data: prof } = await admin.from("profiles").select("id").eq("id", userId).maybeSingle();
  const { data: invAfter } = await admin.from("invitations").select("accepted_at").eq("id", inv.id).maybeSingle();
  if (!prof || !invAfter?.accepted_at) {
    // トークンで特定した招待だけを適用する（同じメールの別の招待を誤って適用しない）
    const { error: applyErr } = await admin.rpc("apply_invitation", { p_user_id: userId, p_email: email, p_token: token });
    if (applyErr) {
      await releaseClaim();
      return { error: `招待の適用に失敗しました: ${applyErr.message}` };
    }
  }

  // マジックリンクのトークンを発行し、その場で検証してログイン（メール送信なし）
  const { data: link, error: linkErr } = await admin.auth.admin.generateLink({ type: "magiclink", email });
  if (linkErr || !link?.properties?.hashed_token) {
    await releaseClaim();
    return { error: `ログイン用トークンの発行に失敗しました: ${linkErr?.message ?? "unknown"}` };
  }

  const supabase = await createClient();
  const { data: verified, error: verifyErr } = await supabase.auth.verifyOtp({ token_hash: link.properties.hashed_token, type: "magiclink" });
  if (verifyErr) {
    await releaseClaim();
    return { error: `ログインに失敗しました: ${translateAuthError(verifyErr.message)}` };
  }
  await admin.from("invitations").update({ accepted_at: inv.accepted_at ?? new Date().toISOString() }).eq("id", inv.id);
  await recordLoginEvent(verified.user?.id, "invite", { headers: await headers() });

  redirect(inv.role === "driver" ? "/driver" : "/dashboard");
}

/** 表示名の更新（本人） */
export async function updateDisplayNameAction(_prev: AuthFormState, formData: FormData): Promise<AuthFormState> {
  const ctx = await getSessionContext();
  if (!ctx) return { error: "ログインが必要です。" };
  const name = String(formData.get("display_name") ?? "").trim();
  if (name.length < 1 || name.length > 50) return { error: "表示名は 1〜50 文字で入力してください。" };
  const { error } = await ctx.supabase.from("profiles").update({ display_name: name }).eq("id", ctx.user.id);
  if (error) return { error: error.message };
  revalidatePath("/", "layout");
  return { ok: true, message: "表示名を更新しました。" };
}

/** パスワードの設定・変更（本人） */
export async function updatePasswordAction(_prev: AuthFormState, formData: FormData): Promise<AuthFormState> {
  const ctx = await getSessionContext();
  if (!ctx) return { error: "ログインが必要です。" };
  const password = String(formData.get("password") ?? "");
  const confirm = String(formData.get("password_confirm") ?? "");
  if (password.length < 8) return { error: "パスワードは 8 文字以上にしてください。" };
  if (password !== confirm) return { error: "確認用パスワードが一致しません。" };
  const { error } = await ctx.supabase.auth.updateUser({ password });
  if (error) return { error: translateAuthError(error.message) };
  return { ok: true, message: "パスワードを設定しました。次回からメールアドレスとパスワードでもログインできます。" };
}
