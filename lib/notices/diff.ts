/**
 * 支払通知書と自社の売上の差の集計・説明（純関数。DB・ネットワーク・React に触らない）
 *
 * 差そのものは DB のビュー（v_payment_notice_diff）が計算する。ここでは
 * - 画面に出す件数・合計（合計は必ず sumMoney。独自の丸めは書かない）
 * - バッジの色と日本語ラベル
 * - 1 行ぶんの日本語の説明（数量の差か単価の差かを判定して書き分ける）
 * だけを行う。
 */
import { subMoney, sumMoney } from "@/lib/calc/money";
import { qty as qtyText, yen } from "@/lib/format";
import { NOTICE_DIFF_LABELS, NOTICE_STATUS_LABELS, type NoticeStatus } from "@/lib/db/types";

/** 突合の 1 行（v_payment_notice_diff のうち、判定に使う列だけ） */
export interface NoticeDiffLike {
  diff_status: string | null;
  raw_name?: string | null;
  project_name?: string | null;
  item_name?: string | null;
  notice_qty: number | null;
  notice_unit_price: number | null;
  notice_amount: number | null;
  our_qty: number | null;
  our_amount: number | null;
  our_unit_price: number | null;
  qty_diff: number | null;
  amount_diff: number | null;
}

/** 金額が一致とみなす幅（DB のビューと同じ 1 円未満） */
export const AMOUNT_EPSILON = 1;
/** 単価が同じとみなす幅（自社の単価は 金額 ÷ 数量 の小数 2 桁） */
export const PRICE_EPSILON = 0.01;
/** 数量が同じとみなす幅 */
export const QTY_EPSILON = 0.005;

function num(v: number | null | undefined): number {
  return v == null || !Number.isFinite(v) ? 0 : v;
}

/** 数量が 0 のときの単価は求められない（null） */
function unitPriceOf(price: number | null | undefined, quantity: number, amount: number): number | null {
  if (price != null && Number.isFinite(price) && price !== 0) return price;
  if (quantity === 0) return null;
  return Math.round((amount / quantity) * 100) / 100;
}

// ---------------------------------------------------------------------------
// 集計
// ---------------------------------------------------------------------------

export interface NoticeDiffSummary {
  /** 明細の件数 */
  count: number;
  /** 一致 */
  ok: number;
  /** 通知のほうが多い */
  noticeMore: number;
  /** 通知のほうが少ない */
  noticeLess: number;
  /** 案件内容が未紐づけ */
  unmatched: number;
  /** 一致しなかった件数（通知のほうが多い ＋ 少ない） */
  mismatched: number;
  /** 通知の金額の合計 */
  noticeTotal: number;
  /** 自社の売上の合計 */
  ourTotal: number;
  /** 差額の合計（プラスは通知のほうが多い） */
  diffTotal: number;
  /** 通知のほうが多い行の差額の合計 */
  moreTotal: number;
  /** 通知のほうが少ない行の差額の合計（マイナス） */
  lessTotal: number;
}

/** 明細ごとの差をまとめる（合計は sumMoney） */
export function noticeDiffSummary(rows: NoticeDiffLike[]): NoticeDiffSummary {
  const list = rows ?? [];
  const statusOf = (r: NoticeDiffLike) => r.diff_status ?? "";
  const count = (status: string) => list.filter((r) => statusOf(r) === status).length;
  const more = list.filter((r) => statusOf(r) === "notice_more");
  const less = list.filter((r) => statusOf(r) === "notice_less");

  const noticeMore = more.length;
  const noticeLess = less.length;

  return {
    count: list.length,
    ok: count("ok"),
    noticeMore,
    noticeLess,
    unmatched: count("unmatched"),
    mismatched: noticeMore + noticeLess,
    noticeTotal: sumMoney(list.map((r) => num(r.notice_amount))),
    ourTotal: sumMoney(list.map((r) => num(r.our_amount))),
    diffTotal: sumMoney(list.map((r) => num(r.amount_diff))),
    moreTotal: sumMoney(more.map((r) => num(r.amount_diff))),
    lessTotal: sumMoney(less.map((r) => num(r.amount_diff))),
  };
}

/** 突合のまとめの 1 行（画面の見出し・トーストに使う） */
export function noticeDiffSummaryText(summary: NoticeDiffSummary): string {
  if (summary.count === 0) return "明細がまだ取り込まれていません。";
  if (summary.unmatched > 0 && summary.mismatched === 0) {
    return `${summary.count} 件中 ${summary.ok} 件が一致・${summary.unmatched} 件が未紐づけです。`;
  }
  if (summary.mismatched === 0) return `${summary.count} 件すべてが自社の売上と一致しています。`;
  const unmatched = summary.unmatched > 0 ? `・未紐づけ ${summary.unmatched} 件` : "";
  return `${summary.count} 件中 ${summary.mismatched} 件に差があります（差額 ${yen(summary.diffTotal)}）${unmatched}`;
}

// ---------------------------------------------------------------------------
// バッジ
// ---------------------------------------------------------------------------

export type NoticeDiffVariant = "success" | "warning" | "destructive" | "secondary";

export interface NoticeDiffTone {
  /** 日本語ラベル（NOTICE_DIFF_LABELS） */
  label: string;
  /** Badge の variant */
  variant: NoticeDiffVariant;
  /** 目立たせる行か（一覧で色を付ける） */
  attention: boolean;
}

/** 判定（ok / notice_more / notice_less / unmatched）の色とラベル */
export function noticeDiffTone(status: string | null | undefined): NoticeDiffTone {
  const key = (status ?? "").trim();
  const label = NOTICE_DIFF_LABELS[key] ?? "判定できません";
  switch (key) {
    case "ok":
      return { label, variant: "success", attention: false };
    case "notice_more":
      return { label, variant: "warning", attention: true };
    case "notice_less":
      return { label, variant: "destructive", attention: true };
    case "unmatched":
      return { label, variant: "secondary", attention: true };
    default:
      return { label, variant: "secondary", attention: false };
  }
}

/** 支払通知書の状態（受領・確認済み・解決済み）の色とラベル */
export function noticeStatusTone(status: NoticeStatus | null | undefined): { label: string; variant: "default" | "secondary" | "success" } {
  switch (status) {
    case "checked":
      return { label: NOTICE_STATUS_LABELS.checked, variant: "default" };
    case "resolved":
      return { label: NOTICE_STATUS_LABELS.resolved, variant: "success" };
    default:
      return { label: NOTICE_STATUS_LABELS.received, variant: "secondary" };
  }
}

// ---------------------------------------------------------------------------
// 1 行の説明
// ---------------------------------------------------------------------------

/** 差の原因 */
export type NoticeDiffCause = "unmatched" | "ok" | "missing" | "qty" | "price" | "both" | "amount";

/** 差の原因を判定する（数量の差か、単価の差か、その両方か） */
export function diffCause(row: NoticeDiffLike): NoticeDiffCause {
  if ((row.diff_status ?? "") === "unmatched") return "unmatched";

  const noticeQty = num(row.notice_qty);
  const noticeAmount = num(row.notice_amount);
  const ourQty = num(row.our_qty);
  const ourAmount = num(row.our_amount);
  const amountDiff = row.amount_diff == null ? subMoney(noticeAmount, ourAmount) : row.amount_diff;
  if (Math.abs(amountDiff) < AMOUNT_EPSILON) return "ok";
  if (ourQty === 0 && ourAmount === 0) return "missing";

  const qtyDiff = row.qty_diff == null ? subMoney(noticeQty, ourQty) : row.qty_diff;
  const noticePrice = unitPriceOf(row.notice_unit_price, noticeQty, noticeAmount);
  const ourPrice = unitPriceOf(row.our_unit_price, ourQty, ourAmount);
  const sameQty = Math.abs(qtyDiff) < QTY_EPSILON;
  const samePrice = noticePrice == null || ourPrice == null ? false : Math.abs(noticePrice - ourPrice) < PRICE_EPSILON;

  if (!sameQty && samePrice) return "qty";
  if (sameQty && !samePrice) return "price";
  if (!sameQty && !samePrice) return "both";
  return "amount";
}

/**
 * 1 行ぶんの日本語の説明。
 * 例:「通知の数量が 2 少ないため、¥46,050 の差があります（通知 18・自社 20）。」
 *   「単価が ¥23,025 ではなく ¥22,500 で計算されています。」
 */
export function explainDiff(row: NoticeDiffLike): string {
  const cause = diffCause(row);
  const noticeQty = num(row.notice_qty);
  const noticeAmount = num(row.notice_amount);
  const ourQty = num(row.our_qty);
  const ourAmount = num(row.our_amount);
  const amountDiff = row.amount_diff == null ? subMoney(noticeAmount, ourAmount) : row.amount_diff;
  const qtyDiff = row.qty_diff == null ? subMoney(noticeQty, ourQty) : row.qty_diff;
  const noticePrice = unitPriceOf(row.notice_unit_price, noticeQty, noticeAmount);
  const ourPrice = unitPriceOf(row.our_unit_price, ourQty, ourAmount);
  const diffAmountText = yen(Math.abs(amountDiff));
  const moreOrLess = amountDiff > 0 ? "多い" : "少ない";

  switch (cause) {
    case "unmatched":
      return "案件内容が紐づいていないため、自社の売上と比べられません。「案件内容」から選ぶか、「名前で自動紐づけ」を押してください。";
    case "ok":
      return "通知の金額と自社の売上は一致しています。";
    case "missing":
      return `自社にこの案件内容の稼働がありません。通知には ${qtyText(noticeQty)} × ${yen(noticePrice ?? 0)}＝${yen(noticeAmount)} が載っています。稼働の登録漏れがないか確認してください。`;
    case "qty":
      return `通知の数量が ${qtyText(Math.abs(qtyDiff))} ${qtyDiff > 0 ? "多い" : "少ない"}ため、${diffAmountText} の差があります（通知 ${qtyText(noticeQty)}・自社 ${qtyText(ourQty)}）。`;
    case "price":
      return `単価が ${yen(ourPrice ?? 0)} ではなく ${yen(noticePrice ?? 0)} で計算されています（数量 ${qtyText(noticeQty)}）。差は ${diffAmountText}（通知のほうが${moreOrLess}）です。`;
    case "both":
      return `数量も単価も違います（通知 ${qtyText(noticeQty)} × ${yen(noticePrice ?? 0)}、自社 ${qtyText(ourQty)} × ${yen(ourPrice ?? 0)}）。差は ${diffAmountText}（通知のほうが${moreOrLess}）です。`;
    default:
      return `数量と単価は同じですが、金額が ${diffAmountText} ${moreOrLess}です（通知 ${yen(noticeAmount)}・自社 ${yen(ourAmount)}）。`;
  }
}

// ---------------------------------------------------------------------------
// 一覧（v_payment_notice_list）
// ---------------------------------------------------------------------------

/** 一覧の 1 行（判定に使う列だけ） */
export interface NoticeListLike {
  total_amount: number | null;
  our_bill: number | null;
  total_diff: number | null;
  item_total: number | null;
  item_count: number | null;
  unmatched_count: number | null;
}

export interface NoticeListSummary {
  count: number;
  /** 差額が 1 円以上ある通知の件数 */
  diffCount: number;
  /** 案件内容が未紐づけの明細がある通知の件数 */
  unmatchedCount: number;
  noticeTotal: number;
  ourTotal: number;
  diffTotal: number;
}

/** 一覧の合計（合計は sumMoney） */
export function noticeListSummary(rows: NoticeListLike[]): NoticeListSummary {
  const list = rows ?? [];
  return {
    count: list.length,
    diffCount: list.filter((r) => Math.abs(num(r.total_diff)) >= AMOUNT_EPSILON).length,
    unmatchedCount: list.filter((r) => num(r.unmatched_count) > 0).length,
    noticeTotal: sumMoney(list.map((r) => num(r.total_amount))),
    ourTotal: sumMoney(list.map((r) => num(r.our_bill))),
    diffTotal: sumMoney(list.map((r) => num(r.total_diff))),
  };
}

/** 通知の合計と明細の合計がずれているとき（入力漏れ・読み取り漏れ）の案内。問題なければ "" */
export function noticeTotalMismatchText(row: NoticeListLike): string {
  const total = num(row.total_amount);
  const items = num(row.item_total);
  if (num(row.item_count) === 0) return "";
  const gap = subMoney(total, items);
  if (Math.abs(gap) < AMOUNT_EPSILON) return "";
  return `通知書の合計（${yen(total)}）と明細の合計（${yen(items)}）が ${yen(Math.abs(gap))} ずれています。取り込み漏れがないか確認してください。`;
}
