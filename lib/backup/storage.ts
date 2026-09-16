import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/db/database.types";
import { createAdminClient } from "@/lib/supabase/admin";
import { isMonthKey } from "@/lib/month";

/** 締め時バックアップを保存する Storage バケット（非公開） */
export const BACKUP_BUCKET = "backups";

/** 署名付き URL の有効期間（秒） */
export const BACKUP_SIGNED_URL_TTL = 60;

export interface BackupFile {
  /** Storage 上のパス（`<company_id>/<YYYY-MM>_<timestamp>.json`） */
  path: string;
  /** ファイル名（`<YYYY-MM>_<timestamp>.json`） */
  name: string;
  /** ファイル名から取り出した稼動月（"YYYY-MM"。判別できなければ null） */
  month: string | null;
  createdAt: string | null;
  size: number | null;
}

type StorageClient = Pick<SupabaseClient<Database>, "storage">;

/** タイムスタンプ（UTC、ファイル名用：20260916T123045Z） */
function fileTimestamp(now: Date): string {
  return now.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z");
}

/** 保存先パス `<company_id>/<YYYY-MM>_<timestamp>.json` */
export function backupObjectPath(companyId: string, month: string, now: Date = new Date()): string {
  if (!isMonthKey(month)) throw new Error(`不正な稼動月: ${month}`);
  return `${companyId}/${month}_${fileTimestamp(now)}.json`;
}

/** 任意のクライアント（サービスロール、または RLS 適用の本人）でバックアップを保存する */
export async function uploadBackupWith(client: StorageClient, companyId: string, month: string, data: unknown): Promise<{ path: string }> {
  const path = backupObjectPath(companyId, month);
  const body = typeof data === "string" ? data : JSON.stringify(data);
  const { error } = await client.storage.from(BACKUP_BUCKET).upload(path, body, { contentType: "application/json", upsert: false });
  if (error) throw new Error(`バックアップの保存に失敗しました: ${error.message}`);
  return { path };
}

/** 締め時バックアップ JSON を Storage へ保存する（サービスロール。SUPABASE_SERVICE_ROLE_KEY が無ければ例外） */
export async function uploadBackup(companyId: string, month: string, data: unknown): Promise<{ path: string }> {
  return uploadBackupWith(createAdminClient(), companyId, month, data);
}

/** ダウンロード用の署名付き URL（60 秒） */
export async function createBackupSignedUrl(path: string): Promise<string> {
  const admin = createAdminClient();
  const { data, error } = await admin.storage.from(BACKUP_BUCKET).createSignedUrl(path, BACKUP_SIGNED_URL_TTL);
  if (error || !data?.signedUrl) throw new Error(`バックアップのダウンロード URL を作成できませんでした: ${error?.message ?? "unknown"}`);
  return data.signedUrl;
}

/** 会社フォルダ内のバックアップ一覧（新しい順） */
export async function listBackups(companyId: string): Promise<BackupFile[]> {
  const admin = createAdminClient();
  const { data, error } = await admin.storage.from(BACKUP_BUCKET).list(companyId, { limit: 1000 });
  if (error) throw new Error(`バックアップ一覧の取得に失敗しました: ${error.message}`);
  const files: BackupFile[] = (data ?? [])
    .filter((f) => f.name.endsWith(".json"))
    .map((f) => {
      const m = f.name.slice(0, 7);
      const meta = (f.metadata ?? {}) as { size?: number };
      return {
        path: `${companyId}/${f.name}`,
        name: f.name,
        month: isMonthKey(m) ? m : null,
        createdAt: f.created_at ?? null,
        size: typeof meta.size === "number" ? meta.size : null,
      };
    });
  return files.sort((a, b) => (a.name < b.name ? 1 : a.name > b.name ? -1 : 0));
}
