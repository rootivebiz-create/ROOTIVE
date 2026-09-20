/**
 * 支払通知の画面用の型と変換（純関数。React・DB・ネットワークに触らない）
 *
 * ビュー（v_payment_notice_list / v_payment_notice_diff）は列が null 許容なので、
 * 画面に渡す前にここで既定値を埋める。サーバー側のページからも、クライアント側の部品からも使う。
 */
import { dateToMonth } from "@/lib/month";
import type { NoticeStatus, PaymentNoticeDiffRow, PaymentNoticeRow } from "@/lib/db/types";

// ---------------------------------------------------------------------------
// 一覧
// ---------------------------------------------------------------------------

/** 一覧の 1 行 */
export interface NoticeListItem {
  id: string;
  /** 稼動月 "YYYY-MM" */
  month: string;
  clientId: string;
  clientName: string;
  noticeNo: string;
  /** "YYYY-MM-DD"（未設定は ""） */
  receivedOn: string;
  totalAmount: number;
  taxAmount: number;
  ourBill: number;
  totalDiff: number;
  itemCount: number;
  unmatchedCount: number;
  itemTotal: number;
  status: NoticeStatus;
  memo: string;
}

/** v_payment_notice_list の 1 行 → 画面用 */
export function toNoticeListItem(row: PaymentNoticeRow): NoticeListItem {
  return {
    id: row.id ?? "",
    month: row.month ? dateToMonth(row.month) : "",
    clientId: row.client_id ?? "",
    clientName: row.client_name ?? "",
    noticeNo: row.notice_no ?? "",
    receivedOn: row.received_on ?? "",
    totalAmount: Number(row.total_amount ?? 0),
    taxAmount: Number(row.tax_amount ?? 0),
    ourBill: Number(row.our_bill ?? 0),
    totalDiff: Number(row.total_diff ?? 0),
    itemCount: Number(row.item_count ?? 0),
    unmatchedCount: Number(row.unmatched_count ?? 0),
    itemTotal: Number(row.item_total ?? 0),
    status: row.status ?? "received",
    memo: row.memo ?? "",
  };
}

/** 編集ダイアログに渡す値 */
export interface NoticeEditValues {
  id: string;
  clientId: string;
  month: string;
  noticeNo: string;
  receivedOn: string;
  totalAmount: number;
  taxAmount: number;
  memo: string;
}

export function toNoticeEditValues(row: NoticeListItem): NoticeEditValues {
  return {
    id: row.id,
    clientId: row.clientId,
    month: row.month,
    noticeNo: row.noticeNo,
    receivedOn: row.receivedOn,
    totalAmount: row.totalAmount,
    taxAmount: row.taxAmount,
    memo: row.memo,
  };
}

// ---------------------------------------------------------------------------
// 突合の明細
// ---------------------------------------------------------------------------

/** 突合の 1 行 */
export interface NoticeDiffItem {
  id: string;
  /** 元請の表記 */
  rawName: string;
  /** 紐づけた案件内容（"" = 未紐づけ） */
  projectItemId: string;
  projectName: string;
  itemName: string;
  noticeQty: number;
  noticeUnitPrice: number;
  noticeAmount: number;
  ourQty: number;
  ourUnitPrice: number | null;
  ourAmount: number;
  qtyDiff: number;
  amountDiff: number;
  diffStatus: string;
  /** 1 行の日本語の説明（lib/notices/diff.ts の explainDiff） */
  explanation: string;
  /** 明細のメモ（payment_notice_items.memo。ビューには無いので呼び出し側で渡す） */
  memo: string;
}

/** v_payment_notice_diff の 1 行 → 画面用（説明とメモは呼び出し側で渡す） */
export function toNoticeDiffItem(row: PaymentNoticeDiffRow, explanation: string, memo = ""): NoticeDiffItem {
  return {
    id: row.id ?? "",
    rawName: row.raw_name ?? "",
    projectItemId: row.project_item_id ?? "",
    projectName: row.project_name ?? "",
    itemName: row.item_name ?? "",
    noticeQty: Number(row.notice_qty ?? 0),
    noticeUnitPrice: Number(row.notice_unit_price ?? 0),
    noticeAmount: Number(row.notice_amount ?? 0),
    ourQty: Number(row.our_qty ?? 0),
    ourUnitPrice: row.our_unit_price == null ? null : Number(row.our_unit_price),
    ourAmount: Number(row.our_amount ?? 0),
    qtyDiff: Number(row.qty_diff ?? 0),
    amountDiff: Number(row.amount_diff ?? 0),
    diffStatus: row.diff_status ?? "",
    explanation,
    memo,
  };
}

/** 案件内容の選択肢（紐づけのプルダウン） */
export interface NoticeItemOption {
  id: string;
  name: string;
  projectId: string;
  projectName: string;
  isActive: boolean;
}

/** 取引先の選択肢 */
export interface NoticeClientOption {
  id: string;
  name: string;
  isActive: boolean;
}

/** 案件内容の表示名（「案件 / 内容」） */
export function itemOptionLabel(option: NoticeItemOption): string {
  return option.projectName ? `${option.projectName} / ${option.name}` : option.name;
}

/** 案件ごとにまとめた選択肢（optgroup 用。案件名の順） */
export function groupItemOptions(options: NoticeItemOption[]): { projectId: string; projectName: string; items: NoticeItemOption[] }[] {
  const groups = new Map<string, { projectId: string; projectName: string; items: NoticeItemOption[] }>();
  for (const option of options) {
    const key = option.projectId || "";
    const group = groups.get(key) ?? { projectId: key, projectName: option.projectName || "（案件なし）", items: [] };
    group.items.push(option);
    groups.set(key, group);
  }
  return [...groups.values()];
}
