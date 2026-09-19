/**
 * 外部連携の実行記録（サーバー専用）。
 * integration_logs は読みが admin、書きはサービスロールのみ。記録の失敗で本体の処理を止めない。
 */
import "server-only";
import { createAdminClient, hasServiceRoleKey } from "@/lib/supabase/admin";
import type { Json } from "@/lib/db/database.types";
import type { IntegrationKind } from "@/lib/db/types";

export type IntegrationLogStatus = "ok" | "error";

/** 記録の本文の上限（DB に合わせて切り詰める） */
const MESSAGE_MAX = 500;

/**
 * 実行記録を 1 件残す（サービスロール）。
 * detail には機密（トークン等）を入れないこと。
 */
export async function logIntegration(
  companyId: string,
  kind: IntegrationKind,
  action: string,
  status: IntegrationLogStatus,
  message: string,
  detail?: Record<string, unknown>,
): Promise<void> {
  try {
    if (!hasServiceRoleKey()) return;
    await createAdminClient()
      .from("integration_logs")
      .insert({
        company_id: companyId,
        kind,
        action,
        status,
        message: (message ?? "").slice(0, MESSAGE_MAX),
        detail: (detail ?? {}) as unknown as Json,
      });
  } catch {
    // 記録できなくても本体の処理は続ける
  }
}
