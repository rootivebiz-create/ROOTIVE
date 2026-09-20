"use server";

import { revalidatePath } from "next/cache";
import { requireAdminAction } from "@/lib/auth/session";
import { ActionError, ensureNoError, runAction, unwrap, type ActionResult } from "@/lib/actions/result";
import { decodeBankCsv } from "@/lib/bank/csv";
import { noticeCsvTotal, parseNoticeCsv, type NoticeCsvRow } from "@/lib/notices/csv";
import { monthToDate } from "@/lib/month";
import {
  deleteNoticeItemSchema,
  deleteNoticeSchema,
  importNoticeItemsSchema,
  matchNoticeItemsSchema,
  MAX_NOTICE_CSV_BYTES,
  MAX_NOTICE_TEXT_LENGTH,
  noticeInputSchema,
  noticeItemSchema,
  noticeStatusSchema,
  type ImportNoticeItemsInput,
  type NoticeFormInput,
  type NoticeItemFormInput,
  type NoticeStatusInput,
} from "@/lib/schemas/notices";
import { NOTICE_STATUS_LABELS, type NoticeStatus } from "@/lib/db/types";
import type { ServerSupabase } from "@/lib/supabase/server";

/** 支払通知の変更が影響する画面 */
function revalidateNoticePaths(): void {
  revalidatePath("/invoices/notices", "layout");
  revalidatePath("/invoices");
  revalidatePath("/alerts");
  revalidatePath("/dashboard");
}

/** その通知書が自社のものか確認する */
async function loadNoticeRow(supabase: ServerSupabase, companyId: string, noticeId: string): Promise<{ id: string; month: string }> {
  const res = await supabase.from("payment_notices").select("id, month").eq("id", noticeId).eq("company_id", companyId).maybeSingle();
  return unwrap<{ id: string; month: string }>(res, "支払通知書が見つかりません。");
}

// ===========================================================================
// A. CSV・貼り付けテキストの読み取り（プレビュー。DB には書かない）
// ===========================================================================

/** プレビューの結果（画面に出す） */
export interface NoticeCsvPreview {
  /** 読み取れた明細 */
  rows: NoticeCsvRow[];
  /** どの列をどう読んだか（日本語） */
  columnReport: string[];
  /** 読み飛ばした行の理由（日本語） */
  errors: string[];
  /** 読み取りの補足（日本語） */
  notes: string[];
  skipped: number;
  /** 判定した文字コード（貼り付けのときは "テキスト"） */
  encoding: string;
  /** 判定した区切り */
  delimiter: string;
  /** 読み取れた明細の合計金額 */
  total: number;
  /** 読み取り元のファイル名（貼り付けのときは ""） */
  fileName: string;
}

const ENCODING_LABELS: Record<string, string> = { "utf-8": "UTF-8", shift_jis: "Shift_JIS" };

/**
 * 支払通知書の CSV（ファイル）か、貼り付けたテキストを読み取る（admin+。DB には書かない）。
 * FormData の "file" に CSV、または "text" に貼り付けた表を入れる。
 */
export async function previewNoticeCsvAction(formData: FormData): Promise<ActionResult<NoticeCsvPreview>> {
  return runAction(async () => {
    await requireAdminAction();

    const file = formData.get("file");
    const text = formData.get("text");

    let content = "";
    let encoding = "テキスト";
    let fileName = "";

    if (file instanceof File && file.size > 0) {
      if (file.size > MAX_NOTICE_CSV_BYTES) {
        throw new ActionError(`CSV は ${MAX_NOTICE_CSV_BYTES / 1024 / 1024}MB 以下にしてください（${(file.size / 1024 / 1024).toFixed(1)}MB）。`);
      }
      const decoded = decodeBankCsv(new Uint8Array(await file.arrayBuffer()));
      content = decoded.text;
      encoding = ENCODING_LABELS[decoded.encoding] ?? decoded.encoding;
      fileName = file.name.slice(0, 200);
    } else if (typeof text === "string" && text.trim() !== "") {
      if (text.length > MAX_NOTICE_TEXT_LENGTH) throw new ActionError("貼り付けた内容が大きすぎます。分けて取り込んでください。");
      content = text;
    } else {
      throw new ActionError("CSV ファイルを選ぶか、支払通知書の表を貼り付けてください。");
    }

    const parsed = parseNoticeCsv(content);
    return {
      rows: parsed.rows,
      columnReport: parsed.columnReport,
      errors: parsed.errors,
      notes: parsed.notes,
      skipped: parsed.skipped,
      encoding,
      delimiter: parsed.delimiter === "\t" ? "タブ区切り" : "コンマ区切り",
      total: noticeCsvTotal(parsed.rows),
      fileName,
    };
  });
}

// ===========================================================================
// B. 支払通知書（見出し）
// ===========================================================================

/** 支払通知書の登録・編集（admin+） */
export async function saveNoticeAction(input: NoticeFormInput): Promise<ActionResult<{ id: string }>> {
  return runAction(async () => {
    const { supabase, company, profile } = await requireAdminAction();
    const parsed = noticeInputSchema.parse(input);

    const row = {
      client_id: parsed.client_id,
      month: monthToDate(parsed.month),
      notice_no: parsed.notice_no,
      received_on: parsed.received_on,
      total_amount: parsed.total_amount,
      tax_amount: parsed.tax_amount,
      memo: parsed.memo,
    };

    // 取引先 × 稼動月 × 通知番号 は会社内で一意（DB の unique 制約と同じ条件で先に案内する）
    let dup = supabase.from("payment_notices").select("id").eq("company_id", company.id).eq("month", row.month).eq("notice_no", row.notice_no);
    dup = parsed.client_id == null ? dup.is("client_id", null) : dup.eq("client_id", parsed.client_id);
    if (parsed.id) dup = dup.neq("id", parsed.id);
    const dupRes = await dup.limit(1);
    ensureNoError(dupRes);
    if ((dupRes.data ?? []).length > 0) {
      throw new ActionError("同じ取引先・稼動月・通知番号の支払通知書が既に登録されています。", { notice_no: ["同じ通知番号が既に登録されています"] });
    }

    if (parsed.id) {
      const res = await supabase.from("payment_notices").update(row).eq("id", parsed.id).eq("company_id", company.id).select("id").single();
      const id = unwrap(res, "支払通知書が見つかりません。").id;
      revalidateNoticePaths();
      return { id };
    }

    const res = await supabase
      .from("payment_notices")
      .insert({ ...row, company_id: company.id, created_by: profile.id })
      .select("id")
      .single();
    const id = unwrap(res, "支払通知書を登録できませんでした。").id;
    revalidateNoticePaths();
    return { id };
  }, "保存しました");
}

/** 支払通知書の削除（明細も一緒に消える。admin+） */
export async function deleteNoticeAction(id: string): Promise<ActionResult<null>> {
  return runAction(async () => {
    const { supabase, company } = await requireAdminAction();
    const parsed = deleteNoticeSchema.parse({ id });

    const res = await supabase.from("payment_notices").delete().eq("id", parsed.id).eq("company_id", company.id).select("id");
    ensureNoError(res);
    if ((res.data ?? []).length === 0) throw new ActionError("支払通知書が見つかりません。");

    revalidateNoticePaths();
    return null;
  }, "削除しました");
}

/** 状態の変更（受領 → 確認済み → 解決済み。admin+） */
export async function setNoticeStatusAction(input: NoticeStatusInput): Promise<ActionResult<{ id: string }>> {
  const label = NOTICE_STATUS_LABELS[input?.status as NoticeStatus] as string | undefined;
  return runAction(async () => {
    const { supabase, company } = await requireAdminAction();
    const parsed = noticeStatusSchema.parse(input);

    const res = await supabase.from("payment_notices").update({ status: parsed.status }).eq("id", parsed.id).eq("company_id", company.id).select("id").single();
    const id = unwrap(res, "支払通知書が見つかりません。").id;

    revalidateNoticePaths();
    return { id };
  }, label ? `${label}にしました` : "状態を変更しました");
}

// ===========================================================================
// C. 明細
// ===========================================================================

/** 取り込みの結果 */
export interface ImportNoticeItemsResult {
  /** 取り込んだ行数 */
  inserted: number;
  /** 置き換えで消した行数 */
  removed: number;
  /** 名前の一致で案件内容を紐づけられた行数 */
  matched: number;
}

/**
 * 読み取った明細をまとめて登録する（admin+）。
 * mode="replace" は既存の明細を消してから入れ直す。"append" は今ある明細の後ろに足す。
 * 取り込んだあとに名前で自動紐づけ（RPC match_notice_items）まで行う。
 */
export async function importNoticeItemsAction(input: ImportNoticeItemsInput): Promise<ActionResult<ImportNoticeItemsResult>> {
  return runAction(async () => {
    const { supabase, company } = await requireAdminAction();
    const parsed = importNoticeItemsSchema.parse(input);
    await loadNoticeRow(supabase, company.id, parsed.notice_id);

    let removed = 0;
    let offset = 0;
    if (parsed.mode === "replace") {
      const del = await supabase.from("payment_notice_items").delete().eq("company_id", company.id).eq("notice_id", parsed.notice_id).select("id");
      ensureNoError(del);
      removed = (del.data ?? []).length;
    } else {
      const existing = await supabase.from("payment_notice_items").select("sort_order").eq("company_id", company.id).eq("notice_id", parsed.notice_id);
      ensureNoError(existing);
      offset = (existing.data ?? []).reduce((max, r) => Math.max(max, Number(r.sort_order ?? 0)), 0);
    }

    const rows = parsed.rows.map((r, i) => ({
      company_id: company.id,
      notice_id: parsed.notice_id,
      raw_name: r.raw_name,
      qty: r.qty,
      unit_price: r.unit_price,
      amount: r.amount,
      sort_order: offset + i + 1,
    }));
    const ins = await supabase.from("payment_notice_items").insert(rows).select("id");
    ensureNoError(ins);

    // 名前の一致で案件内容を紐づける（失敗しても取り込み自体は成立しているので握りつぶす）
    const match = await supabase.rpc("match_notice_items", { p_notice_id: parsed.notice_id });
    const matched = match.error ? 0 : Number(match.data ?? 0);

    revalidateNoticePaths();
    return { inserted: (ins.data ?? []).length, removed, matched };
  }, "明細を取り込みました");
}

/** 明細 1 行の登録・編集（案件内容の紐づけもここで行う。admin+） */
export async function saveNoticeItemAction(input: NoticeItemFormInput): Promise<ActionResult<{ id: string }>> {
  return runAction(async () => {
    const { supabase, company } = await requireAdminAction();
    const parsed = noticeItemSchema.parse(input);
    await loadNoticeRow(supabase, company.id, parsed.notice_id);

    const row = {
      project_item_id: parsed.project_item_id,
      raw_name: parsed.raw_name,
      qty: parsed.qty,
      unit_price: parsed.unit_price,
      amount: parsed.amount,
      memo: parsed.memo,
    };

    if (parsed.id) {
      const res = await supabase
        .from("payment_notice_items")
        .update(row)
        .eq("id", parsed.id)
        .eq("company_id", company.id)
        .eq("notice_id", parsed.notice_id)
        .select("id")
        .single();
      const id = unwrap(res, "明細が見つかりません。").id;
      revalidateNoticePaths();
      return { id };
    }

    const last = await supabase.from("payment_notice_items").select("sort_order").eq("company_id", company.id).eq("notice_id", parsed.notice_id);
    ensureNoError(last);
    const sortOrder = (last.data ?? []).reduce((max, r) => Math.max(max, Number(r.sort_order ?? 0)), 0) + 1;

    const res = await supabase
      .from("payment_notice_items")
      .insert({ ...row, company_id: company.id, notice_id: parsed.notice_id, sort_order: sortOrder })
      .select("id")
      .single();
    const id = unwrap(res, "明細を登録できませんでした。").id;

    revalidateNoticePaths();
    return { id };
  }, "保存しました");
}

/** 明細 1 行の削除（admin+） */
export async function deleteNoticeItemAction(id: string): Promise<ActionResult<null>> {
  return runAction(async () => {
    const { supabase, company } = await requireAdminAction();
    const parsed = deleteNoticeItemSchema.parse({ id });

    const res = await supabase.from("payment_notice_items").delete().eq("id", parsed.id).eq("company_id", company.id).select("id");
    ensureNoError(res);
    if ((res.data ?? []).length === 0) throw new ActionError("明細が見つかりません。");

    revalidateNoticePaths();
    return null;
  }, "削除しました");
}

/** 名前の一致で案件内容を紐づける（RPC match_notice_items。admin+） */
export async function matchNoticeItemsAction(noticeId: string): Promise<ActionResult<{ matched: number }>> {
  return runAction(async () => {
    const { supabase, company } = await requireAdminAction();
    const parsed = matchNoticeItemsSchema.parse({ notice_id: noticeId });
    await loadNoticeRow(supabase, company.id, parsed.notice_id);

    const res = await supabase.rpc("match_notice_items", { p_notice_id: parsed.notice_id });
    if (res.error) throw res.error;

    revalidateNoticePaths();
    return { matched: Number(res.data ?? 0) };
  });
}
