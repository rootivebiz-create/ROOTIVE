/**
 * 外部連携の機密（アクセストークン等）の保管（サーバー専用）。
 * integration_secrets は RLS を有効にしてポリシーを作っていない＝サービスロールだけが読み書きできる。
 * 画面には生の値を返さず、maskSecret でマスクした文字列だけを渡すこと。
 */
import "server-only";
import { createAdminClient, hasServiceRoleKey } from "@/lib/supabase/admin";
import { ActionError } from "@/lib/actions/result";
import type { Json } from "@/lib/db/database.types";
import type { IntegrationKind } from "@/lib/db/types";
import { maskSecret } from "./types";

export { maskSecret };

/** 機密は「名前 → 値」の文字列だけを扱う */
export type SecretRecord = Record<string, string>;

export const SERVICE_ROLE_REQUIRED_MESSAGE = "SUPABASE_SERVICE_ROLE_KEY が設定されていないため、外部連携の設定を保存・読み出しできません。";

function admin() {
  if (!hasServiceRoleKey()) throw new ActionError(SERVICE_ROLE_REQUIRED_MESSAGE);
  return createAdminClient();
}

/** jsonb を文字列だけの辞書に整える（数値・null などは捨てる） */
function toRecord(json: Json | null | undefined): SecretRecord {
  const out: SecretRecord = {};
  if (json && typeof json === "object" && !Array.isArray(json)) {
    for (const [k, v] of Object.entries(json)) if (typeof v === "string" && v.length > 0) out[k] = v;
  }
  return out;
}

/** 保存済みの機密を読む（サービスロール）。未設定なら空の辞書 */
export async function loadSecrets(companyId: string, kind: IntegrationKind): Promise<SecretRecord> {
  const { data, error } = await admin().from("integration_secrets").select("secrets").eq("company_id", companyId).eq("kind", kind).maybeSingle();
  if (error) throw error;
  return toRecord(data?.secrets);
}

/** 機密を保存する（サービスロール）。渡した内容でまるごと置き換える（空文字は保存しない） */
export async function saveSecrets(companyId: string, kind: IntegrationKind, secrets: SecretRecord): Promise<void> {
  const clean: SecretRecord = {};
  for (const [k, v] of Object.entries(secrets)) {
    const value = (v ?? "").trim();
    if (value) clean[k] = value;
  }
  const { error } = await admin()
    .from("integration_secrets")
    .upsert({ company_id: companyId, kind, secrets: clean as unknown as Json, updated_at: new Date().toISOString() }, { onConflict: "company_id,kind" });
  if (error) throw error;
}

/** 機密を消す（連携の解除） */
export async function clearSecrets(companyId: string, kind: IntegrationKind): Promise<void> {
  const { error } = await admin().from("integration_secrets").delete().eq("company_id", companyId).eq("kind", kind);
  if (error) throw error;
}

/** 全会社の機密（LINE の Webhook で署名を照合するときだけ使う。会社数は少ない前提） */
export async function loadAllSecrets(kind: IntegrationKind): Promise<{ companyId: string; secrets: SecretRecord }[]> {
  const { data, error } = await admin().from("integration_secrets").select("company_id, secrets").eq("kind", kind);
  if (error) throw error;
  return (data ?? []).map((row) => ({ companyId: row.company_id, secrets: toRecord(row.secrets) }));
}

/** 指定した鍵だけをマスクして返す（画面へ渡すのはこの形だけ） */
export function maskSecrets<K extends string>(secrets: SecretRecord, keys: readonly K[]): Record<K, string> {
  const out = {} as Record<K, string>;
  for (const key of keys) out[key] = maskSecret(secrets[key]);
  return out;
}

/**
 * 入力が空文字なら保存済みの値を残す（マスク表示のまま保存したケース）。
 * 戻り値は保存する内容そのもの。
 */
export function mergeSecrets(stored: SecretRecord, input: SecretRecord): SecretRecord {
  const merged: SecretRecord = { ...stored };
  for (const [k, v] of Object.entries(input)) {
    const value = (v ?? "").trim();
    if (value) merged[k] = value;
  }
  return merged;
}
