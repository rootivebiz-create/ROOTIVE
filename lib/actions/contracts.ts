"use server";

/**
 * 締結済みの業務委託契約書（PDF・写真）の保管
 *
 * - Storage の非公開バケット `contracts` に `<company_id>/<contract_id>/<タイムスタンプ>_<ファイル名>` で保存する
 * - 書き込み・削除はサーバーのサービスロールのみ（admin 以上の Server Action から）。
 *   読み出しは /api/contract-file?id=<contract_id>（ログイン必須。ドライバーは自分の契約のみ）
 * - PDF・JPEG・PNG・HEIC のみ、10MB まで。拡張子・MIME・先頭バイトの 3 つを確認する
 * - 契約そのものの登録・編集・削除は lib/actions/hr.ts（ここではファイルだけを扱う）
 */

import { revalidatePath } from "next/cache";
import { requireAdminAction } from "@/lib/auth/session";
import { ActionError, ensureNoError, runAction, unwrap, type ActionResult } from "@/lib/actions/result";
import { uuidSchema } from "@/lib/schemas/common";
import { createAdminClient } from "@/lib/supabase/admin";
import type { ServerSupabase } from "@/lib/supabase/server";

const CONTRACT_BUCKET = "contracts";
const MAX_CONTRACT_BYTES = 10 * 1024 * 1024;

type ContractFileType = "application/pdf" | "image/jpeg" | "image/png" | "image/heic";

const EXTENSIONS: Record<ContractFileType, string> = {
  "application/pdf": "pdf",
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/heic": "heic",
};

/** 受け付ける拡張子（小文字） */
const ALLOWED_EXTENSIONS = ["pdf", "jpg", "jpeg", "png", "heic", "heif"];
/** 受け付ける MIME（ブラウザが付けてくる Content-Type。空のこともある） */
const ALLOWED_MIME = ["application/pdf", "image/jpeg", "image/jpg", "image/png", "image/heic", "image/heif"];

function ascii(bytes: Uint8Array, from: number, length: number): string {
  let s = "";
  for (let i = from; i < from + length && i < bytes.length; i += 1) s += String.fromCharCode(bytes[i]);
  return s;
}

/** 先頭バイトから種類を判定する（拡張子・Content-Type は信用しない） */
function detectContractFileType(bytes: Uint8Array): ContractFileType | null {
  if (ascii(bytes, 0, 4) === "%PDF") return "application/pdf";
  if (bytes.length >= 8 && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) return "image/png";
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return "image/jpeg";
  if (bytes.length >= 12 && ascii(bytes, 4, 4) === "ftyp") {
    const brand = ascii(bytes, 8, 4).toLowerCase();
    if (["heic", "heix", "heim", "heis", "hevc", "mif1", "msf1"].includes(brand)) return "image/heic";
  }
  return null;
}

/** ファイル名を安全な形に（記号は _ に、長さを詰める）。拡張子は判定した種類に合わせる */
function safeFileName(original: string, type: ContractFileType): string {
  const base = original.replace(/\.[^.]*$/, "");
  const cleaned = base.replace(/[^\p{L}\p{N}._-]+/gu, "_").replace(/^_+|_+$/g, "");
  const name = cleaned.slice(0, 60) || "contract";
  return `${name}.${EXTENSIONS[type]}`;
}

/** 保存先 `<company_id>/<contract_id>/<タイムスタンプ>_<ファイル名>` */
function contractFilePath(companyId: string, contractId: string, fileName: string, now: Date = new Date()): string {
  const ts = now.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z");
  return `${companyId}/${contractId}/${ts}_${fileName}`;
}

/** 自社のフォルダ配下に保存されたファイルか（手入力の「保管場所メモ」と区別する） */
function isStoredPath(companyId: string, path: string): boolean {
  return Boolean(path) && path.startsWith(`${companyId}/`) && !path.includes("..");
}

/** Storage から削除する（無くてもエラーにしない） */
async function removeStoredFile(path: string): Promise<void> {
  const admin = createAdminClient();
  const { error } = await admin.storage.from(CONTRACT_BUCKET).remove([path]);
  if (error) console.warn("[contracts] 契約書ファイルの削除に失敗:", error.message);
}

function revalidateContracts() {
  revalidatePath("/hr");
  revalidatePath("/dashboard");
}

/** 契約を取り出す（自社のものだけ。RLS でも守られる） */
async function loadContract(supabase: ServerSupabase, companyId: string, contractId: string) {
  return unwrap<{ id: string; file_path: string }>(
    await supabase.from("contracts").select("id, file_path").eq("id", contractId).eq("company_id", companyId).maybeSingle(),
    "対象の契約が見つかりません（既に削除された可能性があります）。",
  );
}

/**
 * 締結済みの契約書ファイルのアップロード（admin+）。
 * FormData の "file" に PDF・JPEG・PNG・HEIC（10MB まで）。古いファイルは置き換える。
 */
export async function uploadContractFileAction(contractId: string, formData: FormData): Promise<ActionResult<{ path: string; name: string }>> {
  return runAction(async () => {
    const { supabase, company } = await requireAdminAction();
    const id = uuidSchema.parse(contractId);
    const contract = await loadContract(supabase, company.id, id);

    const file = formData.get("file");
    if (!(file instanceof File) || file.size === 0) throw new ActionError("契約書のファイルを選んでください。");
    if (file.size > MAX_CONTRACT_BYTES) {
      throw new ActionError(`契約書のファイルは 10MB 以下にしてください（${(file.size / 1024 / 1024).toFixed(1)}MB）。`);
    }
    const ext = (file.name.split(".").pop() ?? "").toLowerCase();
    if (!ALLOWED_EXTENSIONS.includes(ext)) {
      throw new ActionError("契約書は PDF・JPEG・PNG・HEIC のファイルを選んでください。");
    }
    const mime = (file.type ?? "").toLowerCase();
    if (mime !== "" && !ALLOWED_MIME.includes(mime)) {
      throw new ActionError("契約書は PDF・JPEG・PNG・HEIC のファイルを選んでください。");
    }

    const bytes = new Uint8Array(await file.arrayBuffer());
    const type = detectContractFileType(bytes);
    if (!type) throw new ActionError("ファイルの中身を読み取れませんでした。PDF・JPEG・PNG・HEIC のファイルを選んでください。");

    const name = safeFileName(file.name, type);
    const path = contractFilePath(company.id, id, name);
    const admin = createAdminClient();
    const uploaded = await admin.storage.from(CONTRACT_BUCKET).upload(path, bytes, { contentType: type, upsert: false });
    if (uploaded.error) throw new ActionError(`契約書の保存に失敗しました: ${uploaded.error.message}`);

    const res = await supabase.from("contracts").update({ file_path: path }).eq("id", id).eq("company_id", company.id).select("id");
    ensureNoError(res);
    if ((res.data ?? []).length === 0) {
      await removeStoredFile(path);
      throw new ActionError("契約を更新できませんでした（権限を確認してください）。");
    }

    // 置き換え前のファイル（自社の保管ファイルのときだけ）を消す
    const previous = contract.file_path ?? "";
    if (previous && previous !== path && isStoredPath(company.id, previous)) await removeStoredFile(previous);

    revalidateContracts();
    return { path, name };
  }, "契約書を登録しました");
}

/** 契約書ファイルの削除（admin+）。Storage から消して file_path を空にする */
export async function deleteContractFileAction(contractId: string): Promise<ActionResult<null>> {
  return runAction(async () => {
    const { supabase, company } = await requireAdminAction();
    const id = uuidSchema.parse(contractId);
    const contract = await loadContract(supabase, company.id, id);
    const previous = contract.file_path ?? "";
    if (!previous) throw new ActionError("この契約には契約書ファイルが登録されていません。");

    const res = await supabase.from("contracts").update({ file_path: "" }).eq("id", id).eq("company_id", company.id).select("id");
    ensureNoError(res);
    if ((res.data ?? []).length === 0) throw new ActionError("契約を更新できませんでした（権限を確認してください）。");
    if (isStoredPath(company.id, previous)) await removeStoredFile(previous);

    revalidateContracts();
    return null;
  }, "契約書を削除しました");
}
