/**
 * レシート画像の保存（Storage の非公開バケット receipts）
 *
 * - パスは必ず `<company_id>/…`（RLS と API の 403 判定がこれを見る）
 * - 書き込み・削除はサーバーのサービスロールのみ（admin の Server Action から）
 * - 読み出しは署名付き URL 経由（/api/receipt/<path>）。署名付き URL はサーバー内だけで使い、ブラウザには渡さない
 */
import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { contentTypeFromReceiptPath, receiptStoragePath, type ReceiptMediaType } from "./helpers";

export const RECEIPT_BUCKET = "receipts";

/** 署名付き URL の有効時間（秒） */
export const RECEIPT_SIGNED_URL_TTL = 60;

/** 画像を保存する（サービスロール）。戻り値は保存先パス */
export async function uploadReceipt(companyId: string, bytes: Uint8Array, type: ReceiptMediaType, now: Date = new Date()): Promise<string> {
  const path = receiptStoragePath(companyId, type, now);
  const admin = createAdminClient();
  const { error } = await admin.storage.from(RECEIPT_BUCKET).upload(path, bytes, { contentType: type, upsert: false });
  if (error) throw new Error(`レシート画像の保存に失敗しました: ${error.message}`);
  return path;
}

/** 画像を削除する（無くてもエラーにしない） */
export async function removeReceipt(path: string): Promise<void> {
  const admin = createAdminClient();
  const { error } = await admin.storage.from(RECEIPT_BUCKET).remove([path]);
  if (error) console.warn("[intake] レシート画像の削除に失敗:", error.message);
}

/** 署名付き URL を作る（サーバー内でのみ使う）。無ければ null */
export async function receiptSignedUrl(path: string, expiresIn = RECEIPT_SIGNED_URL_TTL): Promise<string | null> {
  const admin = createAdminClient();
  const { data, error } = await admin.storage.from(RECEIPT_BUCKET).createSignedUrl(path, expiresIn);
  if (error || !data?.signedUrl) return null;
  return data.signedUrl;
}

/** 署名付き URL 経由で画像を読み出す。無ければ null */
export async function downloadReceipt(path: string): Promise<{ bytes: Buffer; contentType: string } | null> {
  const signed = await receiptSignedUrl(path);
  if (!signed) return null;
  const res = await fetch(signed, { cache: "no-store" });
  if (!res.ok) return null;
  const bytes = Buffer.from(await res.arrayBuffer());
  if (bytes.byteLength === 0) return null;
  const contentType = res.headers.get("content-type") ?? contentTypeFromReceiptPath(path);
  return { bytes, contentType: contentType.startsWith("image/") ? contentType : contentTypeFromReceiptPath(path) };
}
