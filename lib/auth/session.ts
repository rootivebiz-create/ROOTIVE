import "server-only";
import { cache } from "react";
import { redirect } from "next/navigation";
import { createClient, type ServerSupabase } from "@/lib/supabase/server";
import type { Company, Profile, Role } from "@/lib/db/types";
import { ActionError } from "@/lib/actions/result";

/** ログイン中のユーザー（profiles.id は auth.users.id と同じ） */
export interface SessionUser {
  id: string;
  email: string;
}

export interface SessionContext {
  supabase: ServerSupabase;
  user: SessionUser;
  profile: Profile;
  company: Company;
}

/**
 * ログイン中ユーザーのプロフィールと会社（リクエスト内でメモ化）。
 *
 * **1 往復で取る**（0021）。以前は auth.getUser() → profiles → companies と
 * 3 回続けて待っていたため、画面を開くたびに体感で遅くなっていた。
 *
 * RPC `me()` は security invoker なので RLS がそのまま効く。
 * PostgREST が JWT を検証したうえで auth.uid() を渡すので、
 * **行が返ること自体が「正しいセッションである」ことの証明**になる
 * （偽のトークン・期限切れのトークンでは 401 か 0 行になる）。
 * トークンの更新は middleware が行う（lib/supabase/middleware.ts）。
 */
export const getSessionContext = cache(async (): Promise<SessionContext | null> => {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("me");
  if (error || !data) return null;
  const row = data as unknown as { profile?: Profile; company?: Company } | null;
  const profile = row?.profile;
  const company = row?.company;
  if (!profile || !profile.is_active || !company) return null;
  return { supabase, user: { id: profile.id, email: profile.email }, profile, company };
});

/** スタッフの画面を使えるロール（DB の is_staff() と同じ） */
export const STAFF_ROLES: Role[] = ["owner", "admin", "clerk", "viewer"];
/** 登録・編集ができるロール（DB の is_admin() と同じ。事務員を含む） */
export const ADMIN_ROLES: Role[] = ["owner", "admin", "clerk"];
/** 経営の設定ができるロール（外部連携・監査ログ・目標・バックアップ。DB の is_manager() と同じ） */
export const MANAGER_ROLES: Role[] = ["owner", "admin"];
/** 経営の数字を見てよいロール（ホーム・資金繰り・財務・レポート・AI。DB の can_see_management() と同じ。事務員だけが外れる） */
export const MANAGEMENT_VIEW_ROLES: Role[] = ["owner", "admin", "viewer"];

/** ロールごとの「ここに行けない」ときの行き先（事務員はホームを見ないので事務へ） */
export function homeFor(role: Role): string {
  if (role === "driver") return "/driver";
  if (role === "clerk") return "/office";
  return "/dashboard";
}

/** 画面用：スタッフ（owner/admin/clerk/viewer）以外はリダイレクト */
export async function requireStaff(): Promise<SessionContext> {
  const ctx = await getSessionContext();
  if (!ctx) redirect("/login");
  if (ctx.profile.role === "driver") redirect("/driver");
  return ctx;
}

/** 画面用：指定ロール以外は、そのロールの行き先（ホーム・事務・ポータル）へ */
export async function requirePageRole(roles: Role[]): Promise<SessionContext> {
  const ctx = await getSessionContext();
  if (!ctx) redirect("/login");
  if (!roles.includes(ctx.profile.role)) redirect(homeFor(ctx.profile.role));
  return ctx;
}

/** 画面用：経営の数字を出す画面（ホーム・資金繰り・財務・レポート・案件別採算・ドライバー別採算・AI）。事務員は事務へ */
export const requireManagementPage = () => requirePageRole(MANAGEMENT_VIEW_ROLES);

/** 画面用：ドライバー本人 */
export async function requireDriver(): Promise<SessionContext & { driverId: string }> {
  const ctx = await getSessionContext();
  if (!ctx) redirect("/login");
  if (ctx.profile.role !== "driver" || !ctx.profile.driver_id) redirect("/dashboard");
  return { ...ctx, driverId: ctx.profile.driver_id };
}

/** Server Action 用：ロール確認（不足時は例外 → ActionResult に変換される） */
export async function requireActionRole(roles: Role[]): Promise<SessionContext> {
  const ctx = await getSessionContext();
  if (!ctx) throw new ActionError("ログインが必要です。");
  if (!roles.includes(ctx.profile.role)) throw new ActionError("この操作を行う権限がありません。");
  return ctx;
}

export const requireAdminAction = () => requireActionRole(ADMIN_ROLES);
export const requireOwnerAction = () => requireActionRole(["owner"]);
export const requireStaffAction = () => requireActionRole(STAFF_ROLES);
/** 経営の設定（外部連携・目標・バックアップなど）。事務員は通さない */
export const requireManagerAction = () => requireActionRole(MANAGER_ROLES);
/** 経営の数字を扱う操作（AI の分析・相談など）。事務員は通さない */
export const requireManagementAction = () => requireActionRole(MANAGEMENT_VIEW_ROLES);

/** 登録・編集ができる（owner・admin・事務員） */
export function canEdit(role: Role): boolean {
  return ADMIN_ROLES.includes(role);
}
/** 経営の設定ができる（owner・admin） */
export function canManage(role: Role): boolean {
  return MANAGER_ROLES.includes(role);
}
/** 経営の数字を見てよい（owner・admin・閲覧者。事務員は見ない） */
export function canSeeManagement(role: Role): boolean {
  return MANAGEMENT_VIEW_ROLES.includes(role);
}
export function isOwner(role: Role): boolean {
  return role === "owner";
}
