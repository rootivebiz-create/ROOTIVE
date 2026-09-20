/**
 * 書類の検索（電子帳簿保存法の検索要件）
 *
 * 電子取引で受け渡しした書類は、**取引年月日・取引金額・取引先**で検索でき、
 * 日付と金額は範囲で指定でき、2 つ以上を組み合わせて絞り込めることが求められます。
 * ここはその絞り込みを行う純関数だけを置きます（DB の読み取りは画面側）。
 */
import { sumMoney } from "@/lib/calc/money";

/** 書類の種類 */
export type RecordKind = "receipt" | "invoice" | "notice" | "contract";

export const RECORD_KINDS: RecordKind[] = ["receipt", "invoice", "notice", "contract"];

export const RECORD_KIND_LABELS: Record<RecordKind, string> = {
  receipt: "レシート・領収書",
  invoice: "請求書（発行）",
  notice: "支払通知（受領）",
  contract: "業務委託契約書",
};

/** 検索の対象になる 1 件 */
export interface RecordDoc {
  id: string;
  kind: RecordKind;
  /** 取引年月日（YYYY-MM-DD）。分からないものは null */
  date: string | null;
  /** 取引金額。契約書のように金額が無いものは null */
  amount: number | null;
  /** 取引先（相手先） */
  counterparty: string;
  /** 件名 */
  title: string;
  /** 開く先（ファイルが無ければ null） */
  href: string | null;
  /** 電子データ（ファイル）が保存されているか */
  hasFile: boolean;
  /** 稼動月（YYYY-MM） */
  month: string | null;
  memo: string;
}

/** 絞り込みの条件（すべて任意。指定したものは AND で効く） */
export interface RecordFilter {
  /** 取引年月日の開始（YYYY-MM-DD） */
  from?: string;
  /** 取引年月日の終了（YYYY-MM-DD） */
  to?: string;
  /** 取引金額の下限 */
  minAmount?: number | null;
  /** 取引金額の上限 */
  maxAmount?: number | null;
  /** 種類（空・未指定はすべて） */
  kinds?: RecordKind[];
  /** 取引先・件名の部分一致 */
  q?: string;
  /** ファイルが保存されていないものだけ */
  missingFileOnly?: boolean;
}

/** 検索に使う文字をそろえる（全角英数 → 半角、カタカナの濁点はそのまま、大文字小文字を無視） */
export function normalizeQuery(s: string): string {
  return (s ?? "")
    .replace(/[Ａ-Ｚａ-ｚ０-９]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xfee0))
    .replace(/[\s　]+/g, "")
    .toLowerCase();
}

/** 日付が範囲に入っているか（from / to は含む。null の日付は範囲指定があるときは外す） */
export function inDateRange(date: string | null, from?: string, to?: string): boolean {
  if (!from && !to) return true;
  if (!date) return false;
  if (from && date < from) return false;
  if (to && date > to) return false;
  return true;
}

/** 金額が範囲に入っているか（min / max は含む。null の金額は範囲指定があるときは外す） */
export function inAmountRange(amount: number | null, min?: number | null, max?: number | null): boolean {
  const hasMin = min != null && Number.isFinite(min);
  const hasMax = max != null && Number.isFinite(max);
  if (!hasMin && !hasMax) return true;
  if (amount == null || !Number.isFinite(amount)) return false;
  if (hasMin && amount < (min as number)) return false;
  if (hasMax && amount > (max as number)) return false;
  return true;
}

/** 取引先・件名・メモの部分一致 */
export function matchesQuery(doc: RecordDoc, q?: string): boolean {
  const needle = normalizeQuery(q ?? "");
  if (!needle) return true;
  const hay = normalizeQuery(`${doc.counterparty} ${doc.title} ${doc.memo}`);
  return hay.includes(needle);
}

/** 条件をすべて満たす書類だけを返す（日付の新しい順） */
export function filterRecords(docs: RecordDoc[], filter: RecordFilter = {}): RecordDoc[] {
  const kinds = filter.kinds && filter.kinds.length > 0 ? new Set(filter.kinds) : null;
  return docs
    .filter((d) => {
      if (kinds && !kinds.has(d.kind)) return false;
      if (!inDateRange(d.date, filter.from, filter.to)) return false;
      if (!inAmountRange(d.amount, filter.minAmount, filter.maxAmount)) return false;
      if (!matchesQuery(d, filter.q)) return false;
      if (filter.missingFileOnly && d.hasFile) return false;
      return true;
    })
    .sort(compareRecords);
}

/** 日付の新しい順 → 種類 → 件名 */
export function compareRecords(a: RecordDoc, b: RecordDoc): number {
  const da = a.date ?? "";
  const db = b.date ?? "";
  if (da !== db) return da < db ? 1 : -1;
  if (a.kind !== b.kind) return RECORD_KINDS.indexOf(a.kind) - RECORD_KINDS.indexOf(b.kind);
  return a.title.localeCompare(b.title, "ja");
}

export interface RecordSummary {
  count: number;
  total: number;
  withFile: number;
  missingFile: number;
  byKind: Record<RecordKind, number>;
  oldest: string | null;
  newest: string | null;
}

/** 件数・合計金額・種類ごとの件数（金額は sumMoney で足す） */
export function recordsSummary(docs: RecordDoc[]): RecordSummary {
  const byKind = { receipt: 0, invoice: 0, notice: 0, contract: 0 } as Record<RecordKind, number>;
  const dates: string[] = [];
  let withFile = 0;
  for (const d of docs) {
    byKind[d.kind] += 1;
    if (d.hasFile) withFile += 1;
    if (d.date) dates.push(d.date);
  }
  dates.sort();
  return {
    count: docs.length,
    total: sumMoney(docs.map((d) => d.amount ?? 0)),
    withFile,
    missingFile: docs.length - withFile,
    byKind,
    oldest: dates[0] ?? null,
    newest: dates[dates.length - 1] ?? null,
  };
}

/**
 * 電子取引のデータが保存されていない書類（保存義務があるのにファイルが無い）。
 * 契約書とレシートは紙で受け取ることもあるため「確認してください」という案内にとどめる。
 */
export function missingFileDocs(docs: RecordDoc[]): RecordDoc[] {
  return docs.filter((d) => !d.hasFile).sort(compareRecords);
}

/** 検索条件を日本語 1 行にする（画面と CSV の見出しに使う） */
export function describeFilter(filter: RecordFilter): string {
  const parts: string[] = [];
  if (filter.from || filter.to) parts.push(`取引年月日 ${filter.from || "指定なし"} 〜 ${filter.to || "指定なし"}`);
  if (filter.minAmount != null || filter.maxAmount != null) {
    parts.push(`取引金額 ${filter.minAmount != null ? filter.minAmount.toLocaleString("ja-JP") : "指定なし"} 〜 ${filter.maxAmount != null ? filter.maxAmount.toLocaleString("ja-JP") : "指定なし"}`);
  }
  if (filter.q) parts.push(`取引先・件名「${filter.q}」`);
  if (filter.kinds && filter.kinds.length > 0 && filter.kinds.length < RECORD_KINDS.length) {
    parts.push(`種類 ${filter.kinds.map((k) => RECORD_KIND_LABELS[k]).join("・")}`);
  }
  if (filter.missingFileOnly) parts.push("ファイル未保存のみ");
  return parts.length > 0 ? parts.join(" / ") : "すべての書類";
}
