/**
 * 銀行明細の補助的な純関数（摘要の正規化・取り込みの要約・請求書の候補）
 * 合計は lib/calc の sumMoney を使う（独自の丸めは書かない）。
 */
import { sumMoney } from "@/lib/calc";
import type { ParsedTxn } from "./formats";

// ---------------------------------------------------------------------------
// 文字列の正規化
// ---------------------------------------------------------------------------

/**
 * 摘要の正規化：全角→半角（NFKC）、半角カナ→全角カナ、空白の圧縮。
 * 銀行によって "ﾌﾘｺﾐ ｶ)ﾛｰﾃｨﾌﾞ" のように半角カナで来るので、指紋・照合はこの形で行う。
 */
export function normalizeDescription(raw: string | null | undefined): string {
  if (raw == null) return "";
  return raw
    .normalize("NFKC")
    .replace(/[\u0000-\u001f]/g, " ")
    .replace(/[\s　]+/g, " ")
    .trim();
}

/** ひらがな → カタカナ */
function toKatakana(s: string): string {
  return s.replace(/[ぁ-ゖ]/g, (c) => String.fromCharCode(c.charCodeAt(0) + 0x60));
}

/**
 * 照合用のキー：正規化 ＋ 空白・記号を落とす ＋ ひらがなをカタカナへ ＋ 大文字化。
 * 摘要と取引先名を突き合わせるときに使う。
 */
export function matchKey(raw: string | null | undefined): string {
  return toKatakana(normalizeDescription(raw))
    .replace(/[\s.,・･'"()（）\-‐―ー/\\]/g, "")
    .toUpperCase();
}

/** 会社の種別（株式会社・(株) など）を落とした取引先名の照合キー */
export function clientKey(name: string | null | undefined): string {
  const stripped = normalizeDescription(name)
    .replace(/(株式会社|有限会社|合同会社|合資会社|合名会社|一般社団法人|公益社団法人|医療法人)/g, "")
    .replace(/\((株|有|同|社|財|医)\)/g, "")
    .replace(/[㈱㈲]/g, "");
  return matchKey(stripped);
}

// ---------------------------------------------------------------------------
// 取り込みの要約
// ---------------------------------------------------------------------------

export interface ImportSummary {
  /** 明細の件数 */
  count: number;
  /** 期間の開始日 "YYYY-MM-DD"（0 件なら null） */
  from: string | null;
  /** 期間の終了日 "YYYY-MM-DD"（0 件なら null） */
  to: string | null;
  /** 入金の合計（＋） */
  inflow: number;
  /** 出金の合計（＋の値で返す） */
  outflow: number;
  /** 差引（入金 − 出金） */
  net: number;
}

/** 解析した明細の件数・期間・入出金の合計 */
export function summarizeImport(rows: ParsedTxn[]): ImportSummary {
  const dates = rows.map((r) => r.txnDate).filter((d) => d !== "").sort();
  const inflow = sumMoney(rows.filter((r) => r.amount > 0).map((r) => r.amount));
  const outflow = sumMoney(rows.filter((r) => r.amount < 0).map((r) => -r.amount));
  return {
    count: rows.length,
    from: dates[0] ?? null,
    to: dates[dates.length - 1] ?? null,
    inflow,
    outflow,
    net: sumMoney([inflow, -outflow]),
  };
}

// ---------------------------------------------------------------------------
// 請求書の候補
// ---------------------------------------------------------------------------

/** 消し込み先の候補にする請求書（v_invoice_list から必要な列だけ） */
export interface InvoiceCandidate {
  id: string;
  invoiceNo: string;
  clientName: string;
  /** 請求金額（税込） */
  total: number;
  status: string;
  /** 稼動月 "YYYY-MM"（表示用） */
  month: string;
  issueDate: string | null;
  dueDate: string | null;
}

/** 消し込み先の候補（スコアが高い順） */
export interface InvoiceSuggestion {
  invoice: InvoiceCandidate;
  score: number;
  /** なぜ候補になったか（画面に出す短い理由） */
  reasons: string[];
}

/** 照合に使う銀行明細の最小限の形 */
export interface MatchableTxn {
  txnDate: string;
  description: string;
  amount: number;
}

/** スコアの内訳（テストと画面の説明で使う） */
export const MATCH_SCORES = {
  /** 金額が完全に一致 */
  exactAmount: 100,
  /** 取引先名が摘要に含まれる */
  clientInDescription: 50,
  /** 取引先名の先頭（3 文字以上）が摘要に含まれる（銀行の摘要はカナだけのことが多い） */
  clientPrefixInDescription: 25,
  /** 金額がほぼ一致（差が 1% 以内かつ 1,000 円以内。振込手数料の差など） */
  nearAmount: 20,
  /** 入金予定日・発行日が近い（60 日以内） */
  nearDate: 5,
} as const;

function daysApart(a: string, b: string): number {
  const ta = Date.parse(`${a}T00:00:00Z`);
  const tb = Date.parse(`${b}T00:00:00Z`);
  if (!Number.isFinite(ta) || !Number.isFinite(tb)) return Number.POSITIVE_INFINITY;
  return Math.abs(ta - tb) / 86_400_000;
}

/**
 * 入金明細に対する請求書の候補（純関数）。
 * 金額の完全一致を最優先し、次に取引先名が摘要に含まれるもの。スコア順に最大 limit 件。
 */
export function suggestInvoiceMatches(txn: MatchableTxn, invoices: InvoiceCandidate[], limit = 5): InvoiceSuggestion[] {
  const key = matchKey(txn.description);
  const amount = Math.abs(txn.amount);

  const scored: InvoiceSuggestion[] = [];
  for (const invoice of invoices) {
    const reasons: string[] = [];
    let score = 0;

    const diff = Math.abs(invoice.total - amount);
    if (diff < 0.005) {
      score += MATCH_SCORES.exactAmount;
      reasons.push("金額が一致");
    } else if (invoice.total > 0 && diff <= 1000 && diff / invoice.total <= 0.01) {
      score += MATCH_SCORES.nearAmount;
      reasons.push("金額がほぼ一致");
    }

    const client = clientKey(invoice.clientName);
    if (client.length >= 2 && key.includes(client)) {
      score += MATCH_SCORES.clientInDescription;
      reasons.push("取引先名が摘要に含まれる");
    } else if (client.length >= 3 && key.includes(client.slice(0, 3))) {
      // 「株式会社タナカ商事」→ 摘要は「ﾌﾘｺﾐ ｶ)ﾀﾅｶｼｮｳｼﾞ」のようにカナだけのことが多い
      score += MATCH_SCORES.clientPrefixInDescription;
      reasons.push("取引先名の一部が摘要に含まれる");
    }

    if (score > 0) {
      const ref = invoice.dueDate ?? invoice.issueDate;
      if (ref && daysApart(txn.txnDate, ref) <= 60) {
        score += MATCH_SCORES.nearDate;
        reasons.push("入金予定日が近い");
      }
      scored.push({ invoice, score, reasons });
    }
  }

  scored.sort((a, b) => b.score - a.score || Math.abs(a.invoice.total - amount) - Math.abs(b.invoice.total - amount) || a.invoice.invoiceNo.localeCompare(b.invoice.invoiceNo));
  return scored.slice(0, limit);
}
