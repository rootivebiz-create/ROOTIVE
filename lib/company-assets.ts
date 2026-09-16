/**
 * 会社のロゴ・認印（支払明細に印字する画像）の保存と取得
 * - Storage の非公開バケット company-assets に `<company_id>/<kind>-<timestamp>.<ext>` で保存する
 * - 書き込みはサーバーのサービスロールのみ（owner の Server Action から）。読み出しは /api/company-asset/<kind>（ログイン必須）
 * - PNG / JPEG のみ、2MB まで
 */
import "server-only";
import type { Company } from "@/lib/db/types";
import { createAdminClient } from "@/lib/supabase/admin";

export const COMPANY_ASSET_BUCKET = "company-assets";
export const COMPANY_ASSET_KINDS = ["logo", "seal"] as const;
export type CompanyAssetKind = (typeof COMPANY_ASSET_KINDS)[number];
export const COMPANY_ASSET_LABELS: Record<CompanyAssetKind, string> = { logo: "ロゴ", seal: "認印" };
export const COMPANY_ASSET_MAX_BYTES = 2 * 1024 * 1024;

export type ImageType = "png" | "jpeg";

export function isCompanyAssetKind(v: unknown): v is CompanyAssetKind {
  return v === "logo" || v === "seal";
}

/** 先頭バイトから画像形式を判定する（拡張子や Content-Type は信用しない） */
export function detectImageType(bytes: Uint8Array): ImageType | null {
  if (bytes.length >= 8 && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47 && bytes[4] === 0x0d && bytes[5] === 0x0a && bytes[6] === 0x1a && bytes[7] === 0x0a) {
    return "png";
  }
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return "jpeg";
  return null;
}

export function contentTypeOf(type: ImageType): string {
  return type === "png" ? "image/png" : "image/jpeg";
}

/** パスの拡張子から Content-Type を推定する（保存時に自前で決めた拡張子だけを想定） */
export function contentTypeFromPath(path: string): string {
  return path.toLowerCase().endsWith(".png") ? "image/png" : "image/jpeg";
}

/** 保存先パス `<company_id>/<kind>-<timestamp>.<ext>` */
export function companyAssetPath(companyId: string, kind: CompanyAssetKind, type: ImageType, now: Date = new Date()): string {
  const ts = now.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z");
  return `${companyId}/${kind}-${ts}.${type === "png" ? "png" : "jpg"}`;
}

/** 会社の画像のパス（列名を kind から引く） */
export function companyAssetPathOf(company: Pick<Company, "logo_path" | "seal_path">, kind: CompanyAssetKind): string | null {
  return kind === "logo" ? (company.logo_path ?? null) : (company.seal_path ?? null);
}

/** パスが会社のフォルダ配下か（他社の画像を参照させない） */
export function isOwnedAssetPath(companyId: string, path: string): boolean {
  return path.startsWith(`${companyId}/`) && !path.includes("..");
}

/** 画像を Storage に保存する（サービスロール）。戻り値は保存先パス */
export async function uploadCompanyAsset(companyId: string, kind: CompanyAssetKind, bytes: Uint8Array, type: ImageType): Promise<string> {
  const path = companyAssetPath(companyId, kind, type);
  const admin = createAdminClient();
  const { error } = await admin.storage.from(COMPANY_ASSET_BUCKET).upload(path, bytes, { contentType: contentTypeOf(type), upsert: false });
  if (error) throw new Error(`画像の保存に失敗しました: ${error.message}`);
  return path;
}

/** Storage から画像を削除する（無くてもエラーにしない） */
export async function removeCompanyAsset(path: string): Promise<void> {
  const admin = createAdminClient();
  const { error } = await admin.storage.from(COMPANY_ASSET_BUCKET).remove([path]);
  if (error) console.warn("[company-assets] 削除に失敗:", error.message);
}

/** Storage から画像を読み出す（サービスロール）。無ければ null */
export async function downloadCompanyAsset(path: string): Promise<{ bytes: Buffer; contentType: string } | null> {
  const admin = createAdminClient();
  const { data, error } = await admin.storage.from(COMPANY_ASSET_BUCKET).download(path);
  if (error || !data) return null;
  const bytes = Buffer.from(await data.arrayBuffer());
  const type = detectImageType(bytes);
  return { bytes, contentType: type ? contentTypeOf(type) : contentTypeFromPath(path) };
}

export interface StatementAssets {
  logo?: { bytes: Buffer; contentType: string };
  seal?: { bytes: Buffer; contentType: string };
}

/** PDF 明細に印字するロゴ・認印を読み出す（未設定・取得失敗は省略） */
export async function loadStatementAssets(company: Pick<Company, "id" | "logo_path" | "seal_path">): Promise<StatementAssets> {
  const out: StatementAssets = {};
  for (const kind of COMPANY_ASSET_KINDS) {
    const path = companyAssetPathOf(company, kind);
    if (!path || !isOwnedAssetPath(company.id, path)) continue;
    try {
      const file = await downloadCompanyAsset(path);
      if (file) out[kind] = file;
    } catch (e) {
      console.warn(`[company-assets] ${kind} の読み出しに失敗:`, e);
    }
  }
  return out;
}

/** PDF の Image src 用の data URI */
export function toDataUri(file: { bytes: Buffer; contentType: string }): string {
  return `data:${file.contentType};base64,${file.bytes.toString("base64")}`;
}
