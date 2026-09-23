/**
 * 取引条件の明示書の「中身」と「書き方」（純関数。DB に触らない）。
 *
 * - 保存する写し（terms_records.content）は terms-content.ts の TermsContent に、控除ごとの消費税の扱いと「委託した日」を足した形
 * - 画面（会社・ドライバー）と PDF は、どちらも termsSections() の並びと文だけを使う（書いてあることがそろう）
 * - 法令の結論は書かない。書くのは「何を明示したか」だけ
 */
import { num } from "@/lib/engine/types";
import { jpDate } from "@/lib/format";
import { TAX_RATE } from "~/server/calc/statement";
import { stableStringify } from "~/server/statements-core";
import { sha256 } from "~/server/tokens";
import { compareTermsContent, type TermsChange, type TermsContent, type TermsDeduction } from "~/server/features/terms-content";

export const TERMS_TITLE = "取引条件の明示書（業務委託）";
export const TEMPLATE_NOTE = "このひな形の内容は、必要に応じて弁護士などの専門家に確認してください。";

/** 公的な出典（確かめ済みの URL だけ） */
export const TERMS_SOURCES = {
  flQa: "https://www.jftc.go.jp/fllaw_limited/fllaw_qa.html",
  flLaw: "https://laws.e-gov.go.jp/law/505AC0000000025",
  flGuide: "https://www.jftc.go.jp/file/fl_jftcmhlwguidelines.pdf",
  flKankoku: "https://www.jftc.go.jp/FL/FLkankoku/index.html",
  ntaQa: "https://www.nta.go.jp/taxes/shiraberu/zeimokubetsu/shohi/keigenzeiritsu/pdf/qa/113-3.pdf",
} as const;

/** 控除：消費税の扱い（台帳の控除のルールから写す。古い写しには無い） */
export type StoredTermsDeduction = TermsDeduction & { taxable?: boolean };

/** 保存する写しの形（TermsContent として比べられる） */
export type StoredTermsContent = Omit<TermsContent, "deductions"> & {
  deductions: StoredTermsDeduction[];
  /** 委託した日（この条件で仕事を頼んだ日）。無ければ明示した日 */
  commissionedOn?: string | null;
};

export type TermsSubcontract = { isSubcontract?: boolean; originalClient?: string; originalPayDate?: string };

/** 明示書 1 通（1 つの版）を書くのに要るものすべて */
export type TermsDocument = {
  recordId: string;
  version: number;
  issuedOn: string;
  company: { name: string; registrationNo: string | null };
  driver: { name: string; code: string | null };
  /** 中身の写し。手で入れた記録などで写しが無ければ null */
  content: StoredTermsContent | null;
  subcontract: TermsSubcontract | null;
  documentName: string | null;
  hash: string;
  hashShort: string;
};

/** 保存した写しを読む。形が足りなければ null（手で入れた記録・古い記録） */
export function readTermsContent(raw: unknown): StoredTermsContent | null {
  if (!raw || typeof raw !== "object") return null;
  const c = raw as Partial<StoredTermsContent>;
  if (!Array.isArray(c.services) || !Array.isArray(c.deductions)) return null;
  if (!c.payment || typeof c.payment !== "object" || typeof c.payment.text !== "string") return null;
  return {
    serviceDescription: typeof c.serviceDescription === "string" ? c.serviceDescription : "",
    services: c.services,
    taxNote: typeof c.taxNote === "string" ? c.taxNote : "",
    payment: c.payment,
    feeBearer: c.feeBearer === "driver" ? "driver" : "company",
    deductions: c.deductions,
    place: typeof c.place === "string" ? c.place : "",
    period: c.period && typeof c.period === "object" ? { from: String(c.period.from ?? ""), to: c.period.to ? String(c.period.to) : null } : { from: "", to: null },
    receipt: typeof c.receipt === "string" ? c.receipt : "",
    deemedClause: typeof c.deemedClause === "string" && c.deemedClause ? c.deemedClause : null,
    other: typeof c.other === "string" ? c.other : "",
    commissionedOn: typeof c.commissionedOn === "string" && c.commissionedOn ? c.commissionedOn : null,
  };
}

export function readSubcontract(raw: unknown): TermsSubcontract | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as TermsSubcontract;
  if (!r.isSubcontract && !r.originalClient && !r.originalPayDate) return null;
  return { isSubcontract: !!r.isSubcontract, originalClient: r.originalClient ?? "", originalPayDate: r.originalPayDate ?? "" };
}

/**
 * 明示書の目印（ハッシュ）：明示した中身・再委託の 3 項目・書面の名前・明示した日から作る。
 * 同じ中身なら必ず同じ値（キーの順を固定した JSON）。版の番号・送った日時は入れない
 */
export function termsHash(rec: { content: unknown; subcontract?: unknown; documentName?: string | null; issuedOn: string }): string {
  return sha256(
    stableStringify({
      content: rec.content ?? null,
      subcontract: readSubcontract(rec.subcontract) ?? null,
      documentName: rec.documentName?.trim() || null,
      issuedOn: rec.issuedOn,
    }),
  );
}

export function shortTermsHash(hash: string): string {
  return hash ? hash.slice(0, 12) : "—";
}

/** 支払期日の文に「まで」「以内」が入っていないか（公取委の Q&A は、これを具体的な期日と認めていない）。入っていた言葉を返す */
export function paymentWordingProblem(text: string): string[] {
  return ["まで", "以内"].filter((w) => text.includes(w));
}

/** 1 円未満も出す単価（152.5円） */
export function rateText(value: number): string {
  return `${value < 0 ? "−" : ""}${num(Math.abs(value))}円`;
}

const FEE_WHO = { company: "会社", driver: "ドライバー" } as const;

function taxRatePercent(): number {
  return Math.round(TAX_RATE * 100);
}

/** 控除 1 つの書き方（名前：式（消費税の扱い）） */
export function deductionText(d: StoredTermsDeduction): string {
  const tax = d.taxable === undefined ? "" : d.taxable ? `（税抜。消費税 ${taxRatePercent()}% を加えて差し引きます）` : "（消費税の対象外として扱います）";
  return `${d.name}：${d.how}${tax}`;
}

// ---------------------------------------------------------------- 明示書の並び

export type TermsSection = {
  key: string;
  /** 見出し（明示する事項の名前） */
  label: string;
  paragraphs: string[];
  table?: { head: string[]; rows: string[][] };
  /** 目立たせたい（ドライバーが負担する振込手数料など） */
  emphasis?: boolean;
};

/**
 * 明示書の中身を、明示する事項ごとに並べる（フリーランス法 第3条で明示する事項に合わせた順）。
 * 画面・ドライバーのページ・PDF は、これだけを使う。
 */
export function termsSections(doc: Pick<TermsDocument, "content" | "subcontract" | "documentName" | "issuedOn">): TermsSection[] {
  const c = doc.content;
  if (!c) {
    return [
      {
        key: "missing",
        label: "中身の写し",
        paragraphs: ["この版には、明示した中身の写しがありません（明示した日だけを記録した版です）。"],
      },
    ];
  }
  const out: TermsSection[] = [];
  out.push({ key: "service", label: "給付の内容（業務の内容）", paragraphs: [c.serviceDescription || "（未記入）"] });
  out.push({
    key: "pay",
    label: "報酬の額・算定方法",
    paragraphs: [
      c.services.length ? "報酬は、下の案件ごとの単価（税抜）× 数量で計算します。" : "（報酬の単価が記録されていません）",
      c.taxNote,
    ].filter(Boolean),
    table: c.services.length
      ? { head: ["案件", "元請", "単価（税抜）", "単位"], rows: c.services.map((x) => [x.name, x.client ?? "—", rateText(x.payRate), `1${x.unit}あたり`]) }
      : undefined,
  });
  out.push({
    key: "payment",
    label: "支払期日",
    paragraphs: [`${c.payment.text}`, `締めの期間：${c.payment.periodText}`, "支払の方法：銀行振込"],
  });
  out.push(
    c.feeBearer === "driver"
      ? {
          key: "fee",
          label: "振込手数料",
          paragraphs: ["振込手数料は、受託者（ドライバー）の負担として、振込額から差し引きます。"],
          emphasis: true,
        }
      : { key: "fee", label: "振込手数料", paragraphs: ["振込手数料は、委託者（会社）が負担します。"] },
  );
  out.push({
    key: "deductions",
    label: "報酬から差し引くもの（控除）",
    paragraphs: c.deductions.length ? c.deductions.map(deductionText) : ["報酬から差し引くものはありません。"],
  });
  out.push({ key: "commissioned", label: "委託した日", paragraphs: [jpDate(c.commissionedOn || doc.issuedOn)] });
  out.push({
    key: "period",
    label: "業務の期間",
    paragraphs: [c.period.from ? `${jpDate(c.period.from)}から${c.period.to ? `${jpDate(c.period.to)}まで` : "（終わりの日は定めていません）"}` : "（未記入）"],
  });
  out.push({ key: "receipt", label: "給付を受け取る日・期間", paragraphs: [c.receipt || "（未記入）"] });
  out.push({ key: "place", label: "給付を受け取る場所", paragraphs: [c.place || "（未記入）"] });
  if (c.deemedClause) out.push({ key: "deemed", label: "支払明細の確認のしかた", paragraphs: [c.deemedClause] });
  const sub = readSubcontract(doc.subcontract);
  if (sub?.isSubcontract) {
    out.push({
      key: "subcontract",
      label: "再委託であること",
      paragraphs: [
        "この業務は、委託者が元委託者から受けた業務の再委託です。",
        `元委託者：${sub.originalClient || "（未記入）"}`,
        `元委託の支払期日：${sub.originalPayDate || "（未記入）"}`,
      ],
    });
  }
  if (doc.documentName?.trim()) {
    out.push({
      key: "document",
      label: "明示した書面",
      paragraphs: [`この取引条件は「${doc.documentName.trim()}」で明示しています。この書面は、その内容を台帳からまとめたものです。`],
    });
  }
  if (c.other.trim()) out.push({ key: "other", label: "その他", paragraphs: [c.other.trim()] });
  return out;
}

// ---------------------------------------------------------------- 変わったところ

/** 見張り番と同じ比べ方（単価・控除・支払期日・振込手数料）の 1 行の文 */
export function changeText(ch: TermsChange): string {
  switch (ch.kind) {
    case "rate":
      return `「${ch.label}」の単価：${ch.before} → ${ch.after}`;
    case "deduction_added":
      return `控除「${ch.label}」が増えました：${ch.after}`;
    case "deduction_removed":
      return `控除「${ch.label}」がなくなりました（前は ${ch.before}）`;
    case "deduction_changed":
      return `控除「${ch.label}」：${ch.before} → ${ch.after}`;
    case "payment":
      return `支払期日：${ch.before} → ${ch.after}`;
    case "fee":
      return `振込手数料の負担：${FEE_WHO[ch.before as "company" | "driver"] ?? ch.before} → ${FEE_WHO[ch.after as "company" | "driver"] ?? ch.after}`;
    case "service_added":
      return `案件「${ch.label}」が増えました`;
    case "service_removed":
      return `案件「${ch.label}」がなくなりました`;
  }
}

type VersionSide = { content: StoredTermsContent | null; subcontract: unknown; documentName: string | null; issuedOn: string };

/**
 * 版と版のあいだで変わったところ（履歴に出す）。単価・控除・支払期日・振込手数料は compareTermsContent と同じ比べ方、
 * それに加えて、案件の増減・文で書いた事項・みなし確認の条項・再委託・書面の名前も出す
 */
export function describeVersionChanges(prev: VersionSide, cur: VersionSide): string[] {
  if (!prev.content || !cur.content) return prev.content === cur.content ? [] : ["中身の写しが無い版との比べはできません"];
  const a = prev.content;
  const b = cur.content;
  const out = compareTermsContent(a, b).map(changeText);
  const before = new Map(a.services.map((x) => [x.projectId, x]));
  const after = new Map(b.services.map((x) => [x.projectId, x]));
  for (const [id, x] of after) if (!before.has(id)) out.push(`案件を追加：${x.name}（${rateText(x.payRate)}／${x.unit}）`);
  for (const [id, x] of before) if (!after.has(id)) out.push(`案件を外しました：${x.name}`);
  const text = (label: string, x: string, y: string) => {
    if (x.trim() !== y.trim()) out.push(`${label}：「${short(x)}」→「${short(y)}」`);
  };
  text("給付の内容", a.serviceDescription, b.serviceDescription);
  text("場所", a.place, b.place);
  text("給付を受け取る日", a.receipt, b.receipt);
  text("その他", a.other, b.other);
  const period = (c: StoredTermsContent) => `${c.period.from ? jpDate(c.period.from) : "—"}〜${c.period.to ? jpDate(c.period.to) : "定めなし"}`;
  if (period(a) !== period(b)) out.push(`業務の期間：${period(a)} → ${period(b)}`);
  const commissioned = (c: StoredTermsContent, issued: string) => jpDate(c.commissionedOn || issued);
  if (commissioned(a, prev.issuedOn) !== commissioned(b, cur.issuedOn) && (a.commissionedOn || b.commissionedOn)) {
    out.push(`委託した日：${commissioned(a, prev.issuedOn)} → ${commissioned(b, cur.issuedOn)}`);
  }
  if (!!a.deemedClause !== !!b.deemedClause) out.push(b.deemedClause ? "明細のみなし確認の条項を入れました" : "明細のみなし確認の条項を外しました");
  const sa = readSubcontract(prev.subcontract);
  const sb = readSubcontract(cur.subcontract);
  if (stableStringify(sa) !== stableStringify(sb)) {
    out.push(sb?.isSubcontract ? `再委託の項目：元委託者「${sb.originalClient}」・元委託の支払期日「${sb.originalPayDate}」` : "再委託の項目を外しました");
  }
  if ((prev.documentName ?? "").trim() !== (cur.documentName ?? "").trim()) {
    out.push(cur.documentName?.trim() ? `明示した書面：「${cur.documentName.trim()}」` : "明示した書面の名前を外しました");
  }
  return out;
}

function short(v: string): string {
  const t = v.trim().replace(/\s+/g, " ");
  if (!t) return "（空）";
  return t.length > 40 ? `${t.slice(0, 40)}…` : t;
}
