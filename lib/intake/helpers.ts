/**
 * 取り込み（レシート・元請ファイル）の共通の純関数。
 * React・DB・ネットワーク・SDK に依存しない（テストから直接呼ぶ）。
 *
 * - 名前の正規化（全角／半角・空白・カナ）は lib/bank/helpers の normalizeDescription / matchKey を使う
 * - 金額・日付の解釈は全角数字とカンマ・円記号・和暦以外の書式に耐える
 * - AI の応答は壊れた JSON でも読めるところまで拾う（lib/ai/findings.ts と同じ考え方）
 */
import { matchKey, normalizeDescription } from "@/lib/bank/helpers";
import { parseNumberInput } from "@/lib/calc/parse";

// ---------------------------------------------------------------------------
// 名前の正規化
// ---------------------------------------------------------------------------

/** 表示用の正規化（全角→半角・空白の圧縮）。画面と保存に使う */
export function normalizeName(raw: string | null | undefined): string {
  return normalizeDescription(raw);
}

/**
 * 突き合わせ用のキー（正規化 ＋ 空白・記号を落とす ＋ ひらがな→カタカナ ＋ 大文字化）。
 * 「ﾀﾅｶ ﾀﾛｳ」「タナカ　タロウ」「たなかたろう」はすべて同じキーになる。
 */
export function nameKey(raw: string | null | undefined): string {
  return matchKey(raw);
}

/** 案件名と内容名をひとつの表記にまとめる（元請の表記を覚えるときのキー） */
export function itemLabelOf(projectName: string, itemName: string): string {
  const p = normalizeName(projectName);
  const i = normalizeName(itemName);
  if (p && i) return `${p} / ${i}`;
  return p || i;
}

// ---------------------------------------------------------------------------
// 画像の形式
// ---------------------------------------------------------------------------

/** レシートとして受け付ける画像の形式 */
export const RECEIPT_MEDIA_TYPES = ["image/jpeg", "image/png", "image/webp", "image/heic"] as const;
export type ReceiptMediaType = (typeof RECEIPT_MEDIA_TYPES)[number];

/** AI に渡せる形式（HEIC は Claude が読めないので画像の保存だけ行う） */
export const AI_READABLE_MEDIA_TYPES = ["image/jpeg", "image/png", "image/webp"] as const;
export type AiReadableMediaType = (typeof AI_READABLE_MEDIA_TYPES)[number];

export const RECEIPT_MEDIA_TYPE_LABELS: Record<ReceiptMediaType, string> = {
  "image/jpeg": "JPEG",
  "image/png": "PNG",
  "image/webp": "WebP",
  "image/heic": "HEIC",
};

export function isAiReadableMediaType(type: string): type is AiReadableMediaType {
  return (AI_READABLE_MEDIA_TYPES as readonly string[]).includes(type);
}

function ascii(bytes: Uint8Array, from: number, length: number): string {
  let s = "";
  for (let i = from; i < from + length && i < bytes.length; i += 1) s += String.fromCharCode(bytes[i]);
  return s;
}

/** 先頭バイトから画像形式を判定する（拡張子や Content-Type は信用しない） */
export function detectReceiptImageType(bytes: Uint8Array): ReceiptMediaType | null {
  if (bytes.length >= 8 && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47 && bytes[4] === 0x0d && bytes[5] === 0x0a && bytes[6] === 0x1a && bytes[7] === 0x0a) {
    return "image/png";
  }
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return "image/jpeg";
  if (bytes.length >= 12 && ascii(bytes, 0, 4) === "RIFF" && ascii(bytes, 8, 4) === "WEBP") return "image/webp";
  if (bytes.length >= 12 && ascii(bytes, 4, 4) === "ftyp") {
    const brand = ascii(bytes, 8, 4).toLowerCase();
    if (brand === "heic" || brand === "heix" || brand === "heim" || brand === "heis" || brand === "hevc" || brand === "mif1" || brand === "msf1") return "image/heic";
  }
  return null;
}

/** 保存する拡張子 */
export function receiptExtension(type: ReceiptMediaType): string {
  switch (type) {
    case "image/png":
      return "png";
    case "image/webp":
      return "webp";
    case "image/heic":
      return "heic";
    default:
      return "jpg";
  }
}

/** パスの拡張子から Content-Type を推定する（保存時に自前で決めた拡張子だけを想定） */
export function contentTypeFromReceiptPath(path: string): string {
  const lower = path.toLowerCase();
  if (lower.endsWith(".png")) return "image/png";
  if (lower.endsWith(".webp")) return "image/webp";
  if (lower.endsWith(".heic")) return "image/heic";
  return "image/jpeg";
}

/** Storage（receipts バケット）の保存先 `<company_id>/<YYYY-MM>/receipt-<timestamp>-<乱数>.<ext>` */
export function receiptStoragePath(companyId: string, type: ReceiptMediaType, now: Date = new Date(), suffix = ""): string {
  const ts = now.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z");
  const month = now.toISOString().slice(0, 7);
  const rand = suffix || Math.random().toString(36).slice(2, 8);
  return `${companyId}/${month}/receipt-${ts}-${rand}.${receiptExtension(type)}`;
}

/** パスが自社のフォルダ配下か（他社の画像を参照させない） */
export function isOwnedReceiptPath(companyId: string, path: string): boolean {
  return Boolean(companyId) && path.startsWith(`${companyId}/`) && !path.includes("..") && !path.startsWith("/");
}

// ---------------------------------------------------------------------------
// 金額・日付の解釈
// ---------------------------------------------------------------------------

/** レシートの金額（全角数字・カンマ・「¥」「円」つきでも読む）。読めなければ null */
export function parseReceiptAmount(raw: unknown): number | null {
  if (typeof raw === "number") return Number.isFinite(raw) ? Math.round(raw * 100) / 100 : null;
  if (typeof raw !== "string") return null;
  const n = parseNumberInput(raw.replace(/[^0-9０-９.．,，\-ー−－¥￥円\s]/g, ""));
  if (n == null) return null;
  return Math.round(n * 100) / 100;
}

function pad2(n: number): string {
  return String(n).padStart(2, "0");
}

function validDate(y: number, m: number, d: number): string | null {
  if (!Number.isFinite(y) || !Number.isFinite(m) || !Number.isFinite(d)) return null;
  if (y < 2000 || y > 2100 || m < 1 || m > 12 || d < 1 || d > 31) return null;
  const dt = new Date(Date.UTC(y, m - 1, d));
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== m - 1 || dt.getUTCDate() !== d) return null;
  return `${y}-${pad2(m)}-${pad2(d)}`;
}

/**
 * 日付を "YYYY-MM-DD" へ。
 * "2026-09-18" / "2026/9/18" / "2026年9月18日" / "20260918" / 全角数字 に対応する。
 * 年が無い（"9/18"）場合は baseMonth（"YYYY-MM"）の年を補う。読めなければ null。
 */
export function parseReceiptDate(raw: unknown, baseMonth?: string): string | null {
  if (raw == null) return null;
  const s = String(raw)
    .replace(/[０-９]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xfee0))
    .replace(/[年月]/g, "/")
    .replace(/日/g, "")
    .replace(/[.．]/g, "/")
    .replace(/[-－ー−‐]/g, "/")
    .replace(/\s+/g, "")
    .trim();
  if (s === "") return null;

  const ymd = s.match(/^(\d{4})\/(\d{1,2})\/(\d{1,2})\/?$/);
  if (ymd) return validDate(Number(ymd[1]), Number(ymd[2]), Number(ymd[3]));

  const packed = s.match(/^(\d{4})(\d{2})(\d{2})$/);
  if (packed) return validDate(Number(packed[1]), Number(packed[2]), Number(packed[3]));

  const md = s.match(/^(\d{1,2})\/(\d{1,2})\/?$/);
  if (md && baseMonth && /^\d{4}-\d{2}$/.test(baseMonth)) {
    return validDate(Number(baseMonth.slice(0, 4)), Number(md[1]), Number(md[2]));
  }
  return null;
}

/**
 * 税込の金額から税抜の金額を求める（小数 2 桁で四捨五入）。
 * 経費（expenses.amount）はすべて税抜で保存するため、確認画面で「税込」を選んだときに使う。
 */
export function taxExcludedAmount(amountIncl: number, taxRate: number): number {
  if (!Number.isFinite(amountIncl)) return 0;
  const rate = Number.isFinite(taxRate) && taxRate > 0 ? taxRate : 0;
  if (rate === 0) return Math.round(amountIncl * 100) / 100;
  return Math.round((amountIncl / (1 + rate)) * 100) / 100;
}

// ---------------------------------------------------------------------------
// レシートの読み取り結果
// ---------------------------------------------------------------------------

/** AI がレシートから読み取った内容（読めない項目は null） */
export interface ReceiptDraft {
  /** レシートに書かれている金額（tax_included が true なら税込） */
  amount: number | null;
  /** 支払日 "YYYY-MM-DD" */
  incurred_on: string | null;
  /** 支払先（店名） */
  vendor: string;
  /** 経費カテゴリの id（渡した一覧から選ばせる。決められなければ null） */
  category_id: string | null;
  /** 経費の内容（品目のまとめ） */
  label: string;
  /** 金額が税込か（税抜と書かれていれば false、判断できなければ null） */
  tax_included: boolean | null;
  /** 読み取りの自信（0〜1） */
  confidence: number;
  /** モデルの応答そのまま（確認用） */
  raw: string;
}

export function emptyReceiptDraft(raw = ""): ReceiptDraft {
  return { amount: null, incurred_on: null, vendor: "", category_id: null, label: "", tax_included: null, confidence: 0, raw };
}

function asText(v: unknown): string {
  if (typeof v === "string") return v.trim();
  if (typeof v === "number" || typeof v === "boolean") return String(v);
  return "";
}

function asBool(v: unknown): boolean | null {
  if (typeof v === "boolean") return v;
  const s = asText(v).toLowerCase();
  if (s === "true" || s === "yes" || s === "税込" || s === "内税" || s === "1") return true;
  if (s === "false" || s === "no" || s === "税抜" || s === "外税" || s === "0") return false;
  return null;
}

function asConfidence(v: unknown): number {
  const n = typeof v === "number" ? v : parseNumberInput(asText(v));
  if (n == null || !Number.isFinite(n)) return 0;
  const value = n > 1 ? n / 100 : n; // 0〜100 で返してくるモデルにも耐える
  return Math.min(1, Math.max(0, Math.round(value * 100) / 100));
}

/** JSON（オブジェクト）をレシートの読み取り結果へ正規化する */
export function normalizeReceipt(json: unknown, raw = ""): ReceiptDraft {
  const draft = emptyReceiptDraft(raw);
  if (!json || typeof json !== "object" || Array.isArray(json)) return draft;
  const o = json as Record<string, unknown>;
  const source = (o.receipt && typeof o.receipt === "object" ? (o.receipt as Record<string, unknown>) : o) as Record<string, unknown>;

  draft.amount = parseReceiptAmount(source.amount ?? source.total ?? source.total_amount ?? source["金額"] ?? source["合計"]);
  draft.incurred_on = parseReceiptDate(source.incurred_on ?? source.date ?? source.paid_on ?? source["日付"]);
  draft.vendor = normalizeName(asText(source.vendor ?? source.store ?? source.shop ?? source["支払先"] ?? source["店名"])).slice(0, 100);
  const category = asText(source.category_id ?? source.category ?? source["カテゴリ"]);
  draft.category_id = category === "" || category.toLowerCase() === "null" ? null : category;
  draft.label = normalizeName(asText(source.label ?? source.summary ?? source.item ?? source["内容"] ?? source["品目"])).slice(0, 100);
  draft.tax_included = asBool(source.tax_included ?? source.tax_inclusive ?? source["税込"]);
  draft.confidence = asConfidence(source.confidence ?? source.certainty ?? source["信頼度"]);
  return draft;
}

/** 中身があるか（抽出の候補を選ぶのに使う） */
export function hasReceiptContent(d: ReceiptDraft): boolean {
  return d.amount != null || d.incurred_on != null || d.vendor !== "" || d.label !== "";
}

/** JSON らしき候補を前から順に返す（コードフェンス → 全体 → { 〜 } の範囲） */
function jsonCandidates(trimmed: string): string[] {
  const candidates: string[] = [];
  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fenced?.[1]) candidates.push(fenced[1].trim());
  candidates.push(trimmed);
  const start = trimmed.indexOf("{");
  const end = trimmed.lastIndexOf("}");
  if (start >= 0 && end > start) candidates.push(trimmed.slice(start, end + 1));
  return candidates;
}

/** JSON として読めないときに "キー": 値 の形だけを拾う（壊れた JSON への保険） */
function extractByKeys(text: string): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  const keys = ["amount", "total", "incurred_on", "date", "vendor", "store", "category_id", "label", "tax_included", "confidence"];
  for (const key of keys) {
    const m = text.match(new RegExp(`["'‚“”]?${key}["'‚“”]?\\s*[:：]\\s*("([^"\\n]*)"|'([^'\\n]*)'|[^,\\n}]+)`, "i"));
    if (!m) continue;
    const value = (m[2] ?? m[3] ?? m[1] ?? "").trim().replace(/[,、]$/, "");
    if (value !== "") out[key] = value;
  }
  return out;
}

/**
 * モデルの応答テキストからレシートの読み取り結果を取り出す。
 * コードフェンス・前置き・後書きが付いていても JSON を探し、
 * JSON として壊れている場合は "キー": 値 の形だけを拾う。何も読めなければ空の結果（raw だけ）を返す。
 */
export function extractReceipt(text: string): ReceiptDraft {
  const trimmed = (text ?? "").trim();
  if (!trimmed) return emptyReceiptDraft("");
  for (const c of jsonCandidates(trimmed)) {
    try {
      const draft = normalizeReceipt(JSON.parse(c), trimmed);
      if (hasReceiptContent(draft)) return draft;
    } catch {
      // 次の候補を試す
    }
  }
  const fallback = normalizeReceipt(extractByKeys(trimmed), trimmed);
  return fallback;
}

/** 経費カテゴリの候補（id と名前だけ） */
export interface CategoryChoice {
  id: string;
  name: string;
  is_active?: boolean;
}

/**
 * AI が返したカテゴリ（id か名前）を実在するカテゴリの id に解決する。
 * 一致しなければ null（画面で選んでもらう）。
 */
export function resolveCategoryId(value: string | null | undefined, categories: CategoryChoice[]): string | null {
  const raw = (value ?? "").trim();
  if (!raw) return null;
  if (categories.some((c) => c.id === raw)) return raw;
  const key = nameKey(raw);
  if (!key) return null;
  const exact = categories.filter((c) => nameKey(c.name) === key);
  if (exact.length === 1) return exact[0].id;
  if (exact.length > 1) return (exact.find((c) => c.is_active !== false) ?? exact[0]).id;
  const partial = categories.filter((c) => {
    const ck = nameKey(c.name);
    return ck.length >= 2 && (key.includes(ck) || ck.includes(key));
  });
  return partial.length === 1 ? partial[0].id : null;
}
