import "server-only";
import { createClient as createSupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/db/database.types";
import { env } from "@/lib/env";

/**
 * サービスロールクライアント（サーバー専用）。
 * 用途は招待・招待リンクログイン・バックアップ保存・ユーザー管理に限定する。RLS を無視するため取り扱い注意。
 */
export function createAdminClient() {
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!key) throw new Error("SUPABASE_SERVICE_ROLE_KEY が設定されていません");
  return createSupabaseClient<Database>(env.supabaseUrl, key, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}

export function hasServiceRoleKey(): boolean {
  return Boolean(process.env.SUPABASE_SERVICE_ROLE_KEY);
}
