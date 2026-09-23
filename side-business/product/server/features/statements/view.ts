/**
 * ドライバーに見せる明細の形（純関数。DB に触らない）。
 *
 * - 保存した写し（StatementDraft）から、ドライバーに見せてよい項目だけを 1 つずつ拾って作る。
 *   写しをそのまま広げない（受注の単価・売上・会社の負担が画面や PDF に紛れ込まないように）。
 * - 画面（会社・ドライバー）と PDF は、どちらもこの形とここの行の並びだけを使う（数字がそろう）。
 */
import { WITHHOLDING_CATEGORIES, type WithholdingCategory } from "@/lib/engine/withholding";
import { TAX_RATE, type StatementDraft } from "~/server/calc/statement";

export type ViewLine = { key: string; project: string; client: string | null; unit: string; qty: number; rate: number; amount: number };
export type ViewDeduction = { key: string; name: string; amount: number; taxable: boolean; agreedInWriting: boolean; how: string };
export type ViewAdjustment = { key: string; label: string; amount: number; taxable: boolean; agreedInWriting: boolean };

export type DriverStatementView = {
  title: string;
  month: string;
  period: { from: string; to: string };
  payDate: string;
  company: { name: string; registrationNo: string | null };
  driver: { name: string; code: string | null; registrationNo: string | null; invoiceRegistered: boolean };
  isPurchaseStatement: boolean;
  lines: ViewLine[];
  subtotal: number;
  tax: number;
  taxLabel: "消費税" | "消費税相当額" | null;
  /** 適用する税率（%） */
  taxRatePercent: number;
  deductions: ViewDeduction[];
  deductionTotal: number;
  deductionTax: number;
  adjustments: ViewAdjustment[];
  adjustmentTotal: number;
  adjustmentTax: number;
  withholding: { label: string; amount: number; formula: string } | null;
  total: number;
  note: string;
  version: number;
  hashShort: string;
};

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** 画面から来た id の形を先に確かめる（形が違う値を DB に渡さない） */
export function isUuid(value: string): boolean {
  return UUID_RE.test(value);
}

export const PURCHASE_TITLE = "支払明細書（仕入明細書）";
export const PLAIN_TITLE = "支払明細書";

/** 調整の行の目印（質問の lineKey に使う） */
export function adjustmentKey(index: number): string {
  return `adj:${index}`;
}

export function statementTitle(draft: Pick<StatementDraft, "isPurchaseStatement">): string {
  return draft.isPurchaseStatement ? PURCHASE_TITLE : PLAIN_TITLE;
}

/** ハッシュの頭 12 文字（明細の下に出す「どの中身か」の目印） */
export function shortHash(hash: string): string {
  return hash ? hash.slice(0, 12) : "—";
}

function withholdingLabel(category: string): string {
  const info = WITHHOLDING_CATEGORIES[category as WithholdingCategory];
  return info ? `源泉徴収（${info.short}）` : "源泉徴収";
}

/** 写し → ドライバーに見せる形。項目は 1 つずつ拾う（写しを広げない） */
export function toDriverView(draft: StatementDraft, meta: { version: number; hash: string }): DriverStatementView {
  return {
    title: statementTitle(draft),
    month: draft.month,
    period: { from: draft.period.from, to: draft.period.to },
    payDate: draft.payDate,
    company: { name: draft.company.name, registrationNo: draft.company.registrationNo },
    driver: {
      name: draft.driver.name,
      code: draft.driver.code,
      registrationNo: draft.driver.invoiceRegistered ? draft.driver.registrationNo : null,
      invoiceRegistered: draft.driver.invoiceRegistered,
    },
    isPurchaseStatement: draft.isPurchaseStatement,
    lines: draft.lines.map((l) => ({ key: l.projectId, project: l.project, client: l.client, unit: l.unit, qty: l.qty, rate: l.rate, amount: l.amount })),
    subtotal: draft.subtotal,
    tax: draft.tax,
    taxLabel: draft.taxLabel,
    taxRatePercent: Math.round(TAX_RATE * 100),
    deductions: draft.deductions.map((d) => ({ key: d.ruleId, name: d.name, amount: d.amount, taxable: d.taxable, agreedInWriting: d.agreedInWriting, how: d.how })),
    deductionTotal: draft.deductionTotal,
    deductionTax: draft.deductionTax,
    adjustments: draft.adjustments.map((a, i) => ({ key: adjustmentKey(i), label: a.label, amount: a.amount, taxable: a.taxable, agreedInWriting: a.agreedInWriting })),
    adjustmentTotal: draft.adjustmentTotal,
    adjustmentTax: draft.adjustmentTax,
    withholding: draft.withholding ? { label: withholdingLabel(draft.withholding.category), amount: draft.withholding.amount, formula: draft.withholding.formula } : null,
    total: draft.total,
    note: draft.note,
    version: meta.version,
    hashShort: shortHash(meta.hash),
  };
}

export type SummaryRow = { key: string; label: string; amount: number; hint?: string };

/**
 * 振込額までの足し引きの行（画面と PDF の共通）。すべての amount を足すと振込額になる。
 * 引くものは負の数で持つ。
 */
export function summaryRows(v: DriverStatementView): SummaryRow[] {
  const rows: SummaryRow[] = [{ key: "subtotal", label: `委託料（税抜・${v.taxRatePercent}%対象）`, amount: v.subtotal }];
  if (v.taxLabel) rows.push({ key: "tax", label: `${v.taxLabel}（${v.taxRatePercent}%）`, amount: v.tax });
  if (v.deductions.length > 0) rows.push({ key: "deductions", label: "引かれているもの（税抜）", amount: -v.deductionTotal });
  if (v.deductionTax !== 0) rows.push({ key: "deductionTax", label: `引かれているものの消費税（${v.taxRatePercent}%）`, amount: -v.deductionTax });
  if (v.adjustments.length > 0) rows.push({ key: "adjustments", label: "調整（立替の精算など）", amount: v.adjustmentTotal });
  if (v.adjustmentTax !== 0) rows.push({ key: "adjustmentTax", label: `調整の消費税（${v.taxRatePercent}%）`, amount: v.adjustmentTax });
  if (v.withholding) rows.push({ key: "withholding", label: v.withholding.label, amount: -v.withholding.amount, hint: v.withholding.formula });
  return rows;
}

/** 税率ごとの合計（仕入明細書の記載事項：税率ごとに合計した対価の額・適用税率・消費税額） */
export function taxBreakdown(v: DriverStatementView): { rateLabel: string; base: number; tax: number; taxLabel: string } | null {
  if (!v.taxLabel) return null;
  return { rateLabel: `${v.taxRatePercent}%対象`, base: v.subtotal, tax: v.tax, taxLabel: v.taxLabel };
}

/** 質問の対象になる行の一覧（lineKey と表示名） */
export function lineTargets(v: DriverStatementView): { key: string; label: string; kind: "line" | "deduction" | "adjustment" }[] {
  return [
    ...v.lines.map((l) => ({ key: l.key, label: l.project, kind: "line" as const })),
    ...v.deductions.map((d) => ({ key: d.key, label: d.name, kind: "deduction" as const })),
    ...v.adjustments.map((a) => ({ key: a.key, label: a.label, kind: "adjustment" as const })),
  ];
}

/** lineKey の表示名（全体なら「明細全体」。今の明細に無い行なら「前の版の行」） */
export function lineKeyLabel(v: DriverStatementView, key: string | null): string {
  if (!key) return "明細全体";
  return lineTargets(v).find((t) => t.key === key)?.label ?? "前の版にあった行";
}

export function isLineKeyOf(v: DriverStatementView, key: string): boolean {
  return lineTargets(v).some((t) => t.key === key);
}

// ---------------------------------------------------------------- 送る文面とリンク

/** 送る文面（LINE・SMS・メール共通） */
export function shareMessage(name: string, month: string, url: string): string {
  const [y, m] = month.slice(0, 7).split("-").map(Number);
  return `${name}さん　${y}年${m}月分の支払明細です。内容をご確認のうえ『確認しました』を押してください。${url}`;
}

export function shareSubject(month: string, companyName: string): string {
  const [y, m] = month.slice(0, 7).split("-").map(Number);
  return `${y}年${m}月分の支払明細（${companyName}）`;
}

/** LINE・SMS・メールで送るためのリンク（電話番号・メールがあれば宛先に入れる） */
export function shareLinks(input: { message: string; subject: string; phone?: string | null; email?: string | null }): { line: string; sms: string; mail: string } {
  const body = encodeURIComponent(input.message);
  const phone = (input.phone ?? "").replace(/[^\d+]/g, "");
  const email = (input.email ?? "").trim();
  return {
    line: `https://line.me/R/msg/text/?${body}`,
    sms: `sms:${phone}?&body=${body}`,
    mail: `mailto:${email ? encodeURIComponent(email).replace(/%40/g, "@") : ""}?subject=${encodeURIComponent(input.subject)}&body=${body}`,
  };
}

/** リンクの期限：今日（日本時間）から 120 日後の日の終わり。同じ日に何度作っても同じリンクになる */
export const LINK_DAYS = 120;
const DAY_SEC = 86_400;
const JST_SEC = 9 * 3600;

export function linkExpiresAt(now: Date): number {
  const jstDay = Math.floor((Math.floor(now.getTime() / 1000) + JST_SEC) / DAY_SEC);
  return (jstDay + LINK_DAYS + 1) * DAY_SEC - JST_SEC - 1;
}

// ---------------------------------------------------------------- 口座（下 3 桁だけ）

export type MaskedAccount = { bank: string; branch: string; type: string; last3: string };

export function maskAccount(d: {
  bankNameKana: string | null;
  bankCode: string | null;
  branchNameKana: string | null;
  branchCode: string | null;
  accountType: string;
  accountNumber: string | null;
}): MaskedAccount | null {
  const num = (d.accountNumber ?? "").replace(/\D/g, "");
  if (!num || !(d.bankCode || d.bankNameKana)) return null;
  return {
    bank: d.bankNameKana || d.bankCode || "",
    branch: d.branchNameKana || d.branchCode || "",
    type: d.accountType === "checking" ? "当座" : "普通",
    last3: num.slice(-3),
  };
}

// ---------------------------------------------------------------- 日付の見せ方（日本時間）

const WEEK = ["日", "月", "火", "水", "木", "金", "土"];

function jstParts(date: Date) {
  const t = new Date(date.getTime() + JST_SEC * 1000);
  return { y: t.getUTCFullYear(), m: t.getUTCMonth() + 1, d: t.getUTCDate(), hh: t.getUTCHours(), mm: t.getUTCMinutes() };
}

/** 2026-11-25 → 2026年11月25日（水） */
export function jpDateWithWeekday(date: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  if (!m) return date;
  const w = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]))).getUTCDay();
  return `${Number(m[1])}年${Number(m[2])}月${Number(m[3])}日（${WEEK[w]}）`;
}

/** 10月25日 9:05 */
export function jpShortDateTime(date: Date): string {
  const p = jstParts(date);
  return `${p.m}月${p.d}日 ${p.hh}:${String(p.mm).padStart(2, "0")}`;
}

/** 2026年10月25日 9:05 */
export function jpDateTime(date: Date): string {
  const p = jstParts(date);
  return `${p.y}年${p.m}月${p.d}日 ${p.hh}:${String(p.mm).padStart(2, "0")}`;
}

/** 2026-10-01 → 2026年10月 */
export function jpMonthLabel(month: string): string {
  const [y, m] = month.slice(0, 7).split("-").map(Number);
  return `${y}年${m}月`;
}

/** 数量の見せ方（小数は 2 桁まで） */
export function qtyText(value: number): string {
  return new Intl.NumberFormat("ja-JP", { maximumFractionDigits: 2 }).format(value);
}
