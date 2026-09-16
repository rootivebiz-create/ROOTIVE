"use server";

import { revalidatePath } from "next/cache";
import { requireOwnerAction } from "@/lib/auth/session";
import { ActionError, ensureNoError, runAction, type ActionResult } from "@/lib/actions/result";
import {
  COMPANY_ASSET_LABELS,
  COMPANY_ASSET_MAX_BYTES,
  companyAssetPathOf,
  detectImageType,
  isCompanyAssetKind,
  removeCompanyAsset,
  uploadCompanyAsset,
  type CompanyAssetKind,
} from "@/lib/company-assets";

function revalidateAssets() {
  revalidatePath("/settings/company");
  revalidatePath("/payouts", "layout");
  revalidatePath("/driver", "layout");
}

function pathUpdate(kind: CompanyAssetKind, path: string | null): { logo_path: string | null } | { seal_path: string | null } {
  return kind === "logo" ? { logo_path: path } : { seal_path: path };
}

/**
 * ロゴ・認印のアップロード（owner のみ）。FormData の "file" に PNG / JPEG（2MB まで）
 * 保存後に会社設定のパスを更新し、古い画像は削除する
 */
export async function uploadCompanyAssetAction(kind: string, formData: FormData): Promise<ActionResult<{ path: string }>> {
  return runAction(async () => {
    const { supabase, company } = await requireOwnerAction();
    if (!isCompanyAssetKind(kind)) throw new ActionError("画像の種類が不正です。");
    const label = COMPANY_ASSET_LABELS[kind];
    const file = formData.get("file");
    if (!(file instanceof File) || file.size === 0) throw new ActionError(`${label}の画像ファイルを選択してください。`);
    if (file.size > COMPANY_ASSET_MAX_BYTES) throw new ActionError(`${label}の画像は 2MB 以下にしてください（${(file.size / 1024 / 1024).toFixed(1)}MB）。`);
    const bytes = new Uint8Array(await file.arrayBuffer());
    const type = detectImageType(bytes);
    if (!type) throw new ActionError(`${label}は PNG または JPEG の画像を選択してください。`);

    const path = await uploadCompanyAsset(company.id, kind, bytes, type);
    const previous = companyAssetPathOf(company, kind);
    const res = await supabase
      .from("companies")
      .update(pathUpdate(kind, path))
      .eq("id", company.id)
      .select("id");
    ensureNoError(res);
    if ((res.data ?? []).length === 0) {
      await removeCompanyAsset(path);
      throw new ActionError("会社設定を更新できませんでした（権限を確認してください）。");
    }
    if (previous && previous !== path) await removeCompanyAsset(previous);
    revalidateAssets();
    return { path };
  }, "画像を保存しました。支払明細（PDF・印刷）に印字されます。");
}

/** ロゴ・認印の削除（owner のみ） */
export async function deleteCompanyAssetAction(kind: string): Promise<ActionResult<null>> {
  return runAction(async () => {
    const { supabase, company } = await requireOwnerAction();
    if (!isCompanyAssetKind(kind)) throw new ActionError("画像の種類が不正です。");
    const previous = companyAssetPathOf(company, kind);
    const res = await supabase
      .from("companies")
      .update(pathUpdate(kind, null))
      .eq("id", company.id)
      .select("id");
    ensureNoError(res);
    if ((res.data ?? []).length === 0) throw new ActionError("会社設定を更新できませんでした（権限を確認してください）。");
    if (previous) await removeCompanyAsset(previous);
    revalidateAssets();
    return null;
  }, "画像を削除しました。");
}
