"use server";

import { revalidatePath } from "next/cache";
import { requireAdminAction } from "@/lib/auth/session";
import { ActionError, ensureNoError, runAction, unwrap, type ActionResult } from "@/lib/actions/result";
import {
  bankCsvFileSchema,
  deleteBankImportSchema,
  matchBankTxnSchema,
  setBankTxnStatusSchema,
  MAX_BANK_CSV_BYTES,
} from "@/lib/schemas/bank";
import { fingerprintTxns, parseBankCsv, summarizeImport } from "@/lib/bank";
import type { TablesInsert } from "@/lib/db/database.types";
import type { BankTxnStatus } from "@/lib/db/types";

/** 明細をまとめて登録するときの 1 回あたりの件数 */
const UPSERT_CHUNK = 500;

/** 消込の結果が影響する画面 */
function revalidateBank(): void {
  revalidatePath("/bank");
  revalidatePath("/invoices", "layout");
  revalidatePath("/cashflow");
  revalidatePath("/dashboard");
}

/** 取り込みの結果（画面のサマリーに出す） */
export interface ImportBankCsvResult {
  importId: string;
  fileName: string;
  /** 判定した書式名 */
  format: string;
  /** 読み取れた明細の件数 */
  rowCount: number;
  /** 新しく登録した件数 */
  inserted: number;
  /** 取り込み済みのため飛ばした件数 */
  skipped: number;
  /** 日付・金額が読めずに飛ばした行数 */
  failed: number;
  /** 自動で消し込んだ件数 */
  matched: number;
  /** 読めなかった行の理由（日本語） */
  errors: string[];
}

/**
 * 銀行 CSV の取り込み（admin+）。
 * FormData の "file" に入出金明細 CSV（.csv / .txt、2MB まで。UTF-8 / Shift_JIS）。
 * 解析 → 取り込み履歴を作る → 明細を登録（指紋が同じ行は飛ばす）→ 自動消込 の順に行う。
 */
export async function importBankCsvAction(formData: FormData): Promise<ActionResult<ImportBankCsvResult>> {
  return runAction(async () => {
    const { supabase, company, user } = await requireAdminAction();

    const file = formData.get("file");
    if (!(file instanceof File) || file.size === 0) throw new ActionError("CSV ファイルを選択してください。");
    if (file.size > MAX_BANK_CSV_BYTES) {
      throw new ActionError(`CSV は 2MB 以下にしてください（${(file.size / 1024 / 1024).toFixed(1)}MB）。`);
    }
    const meta = bankCsvFileSchema.parse({ name: file.name, size: file.size });

    const parsed = parseBankCsv(new Uint8Array(await file.arrayBuffer()));
    if (parsed.rows.length === 0) {
      throw new ActionError(parsed.errors[0] ?? "取り込める明細がありませんでした。ファイルの内容を確認してください。");
    }
    const summary = summarizeImport(parsed.rows);

    const created = unwrap<{ id: string }>(
      await supabase
        .from("bank_imports")
        .insert({
          company_id: company.id,
          file_name: meta.name,
          format: parsed.format,
          row_count: parsed.rows.length,
          period_from: summary.from,
          period_to: summary.to,
          created_by: user.id,
        })
        .select("id")
        .single(),
      "取り込み履歴を作成できませんでした。",
    );
    const importId = created.id;

    const fingerprints = fingerprintTxns(company.id, parsed.rows);
    const records: TablesInsert<"bank_transactions">[] = parsed.rows.map((row, i) => ({
      company_id: company.id,
      import_id: importId,
      txn_date: row.txnDate,
      description: row.description,
      amount: row.amount,
      balance: row.balance,
      fingerprint: fingerprints[i],
    }));

    let inserted = 0;
    for (let i = 0; i < records.length; i += UPSERT_CHUNK) {
      const res = await supabase
        .from("bank_transactions")
        .upsert(records.slice(i, i + UPSERT_CHUNK), { onConflict: "company_id,fingerprint", ignoreDuplicates: true })
        .select("id");
      ensureNoError(res);
      inserted += (res.data ?? []).length;
    }
    const skipped = parsed.rows.length - inserted;

    ensureNoError(
      await supabase.from("bank_imports").update({ inserted_count: inserted, skipped_count: skipped }).eq("id", importId).eq("company_id", company.id),
    );

    // 取り込んだ入金と未入金の請求書を自動で突き合わせる（候補が 1 件のときだけ消し込む）
    const matchRes = await supabase.rpc("bank_auto_match", { p_import_id: importId });
    ensureNoError(matchRes);
    const matched = Number(matchRes.data ?? 0);

    revalidateBank();
    return {
      importId,
      fileName: meta.name,
      format: parsed.format,
      rowCount: parsed.rows.length,
      inserted,
      skipped,
      failed: parsed.skipped,
      matched,
      errors: parsed.errors,
    } satisfies ImportBankCsvResult;
  }, "銀行 CSV を取り込みました");
}

/** 未消込の入金をまとめて自動消込（admin+）。RPC bank_auto_match */
export async function autoMatchBankAction(): Promise<ActionResult<{ matched: number }>> {
  return runAction(async () => {
    const { supabase } = await requireAdminAction();
    const res = await supabase.rpc("bank_auto_match", {});
    ensureNoError(res);
    revalidateBank();
    return { matched: Number(res.data ?? 0) };
  }, "自動消込を実行しました");
}

/** 手で請求書に消し込む（admin+）。請求書は入金済みになる */
export async function matchBankTxnAction(txnId: string, invoiceId: string): Promise<ActionResult<{ txnId: string }>> {
  return runAction(async () => {
    const { supabase } = await requireAdminAction();
    const v = matchBankTxnSchema.parse({ txn_id: txnId, invoice_id: invoiceId });
    ensureNoError(await supabase.rpc("bank_match_invoice", { p_txn_id: v.txn_id, p_invoice_id: v.invoice_id }));
    revalidateBank();
    return { txnId: v.txn_id };
  }, "請求書に消し込みました");
}

/** 消込を外す（unmatched）・対象外にする（ignored）（admin+）。RPC bank_set_status */
export async function setBankTxnStatusAction(txnId: string, status: BankTxnStatus): Promise<ActionResult<{ txnId: string; status: BankTxnStatus }>> {
  return runAction(async () => {
    const { supabase } = await requireAdminAction();
    const v = setBankTxnStatusSchema.parse({ txn_id: txnId, status });
    ensureNoError(await supabase.rpc("bank_set_status", { p_txn_id: v.txn_id, p_status: v.status }));
    revalidateBank();
    return { txnId: v.txn_id, status: v.status };
  }, "明細の状態を変更しました");
}

/** 取り込みの取り消し（admin+）。未消込の明細と取り込み履歴だけを削除し、消込済み・対象外は残す */
export async function deleteBankImportAction(importId: string): Promise<ActionResult<{ deleted: number }>> {
  return runAction(async () => {
    const { supabase, company } = await requireAdminAction();
    const v = deleteBankImportSchema.parse({ id: importId });

    const removed = await supabase
      .from("bank_transactions")
      .delete()
      .eq("import_id", v.id)
      .eq("company_id", company.id)
      .eq("status", "unmatched")
      .select("id");
    ensureNoError(removed);

    unwrap<{ id: string }>(
      await supabase.from("bank_imports").delete().eq("id", v.id).eq("company_id", company.id).select("id").maybeSingle(),
      "取り込み履歴が見つかりません（既に削除された可能性があります）。",
    );

    revalidateBank();
    return { deleted: (removed.data ?? []).length };
  }, "取り込みを取り消しました");
}
