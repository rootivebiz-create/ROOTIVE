/**
 * 会社の控え（純関数。DB に触らない）。明細の写し（StatementDraft）から、会社だけが見る数字を拾う。
 * ドライバーの画面・ドライバーの PDF には出さない（DriverStatementView とは別の形にして、混ざらないようにする）。
 *
 * - 登録の無い方への支払で、会社が控除できずに負担する消費税（経過措置）。締めの期間が段の境目をまたぐときは、
 *   稼働の日ごとに分けた内訳（burdenParts）と、日付の無い稼働があったか（undatedAcrossStep）
 * 古い写しには burdenParts・undatedAcrossStep が無いことがある（無ければ「内訳なし」として扱う）
 */
import { yen } from "@/lib/payroll/money";
import { nonDeductibleTax, TRANSITIONAL_STEPS } from "@/lib/payroll/tax";
import { TAX_RATE, type StatementDraft } from "~/server/calc/statement";

export type BurdenPart = {
  /** その割合の段のうち、締めの期間に入る日（例：9/21〜9/30） */
  spanFrom: string;
  spanTo: string;
  /** その段で稼働のあった最初と最後の日 */
  from: string;
  to: string;
  /** 支払（税込）のうち、その段の分 */
  base: number;
  /** 会社が負担する消費税 */
  burden: number;
  ratePercent: number;
  /** 「9/21〜9/30」 */
  label: string;
};

export type CompanyCopy = {
  /** 登録番号の無い方か（経過措置の負担の欄を出すか） */
  unregistered: boolean;
  /** 控除できずに会社が負担する消費税 */
  invoiceBurden: number;
  /** 仕入税額控除できる割合（%。期間の末日で判定。写しに無ければ null） */
  deductibleRatePercent: number | null;
  /** 期間が段の境目をまたぐときの内訳（またがなければ空） */
  parts: BurdenPart[];
  /** 「9/21〜9/30 ¥X（前の段の割合%）／10/1〜10/20 ¥Y（次の段の割合%）」の形の 1 行（内訳が無ければ null） */
  partsText: string | null;
  /** 日付の無い稼働があり、期間の末日の割合で数えた */
  undatedAcrossStep: boolean;
  /**
   * 期間全体を末日の割合で数えた場合の負担（内訳があるときだけ。無ければ null）。
   * 日ごとに分けた数え方（invoiceBurden）と、期間全体を末日の割合で数える考え方（国税庁の Q&A の役務の例）の
   * どちらで扱うかは税理士が決めるので、両方を出す。会計ソフト向けの仕訳の税区分は、期間の末日の割合
   */
  periodEndBurden: number | null;
};

/** 割合（0〜1）→ %（割合は写しの値から作る。直書きしない） */
export function ratePercent(rate: number): number {
  return Math.round(rate * 1000) / 10;
}

/** 2026-09-21 → 9/21 */
export function shortMonthDay(date: string): string {
  const m = /^\d{4}-(\d{2})-(\d{2})$/.exec(date);
  return m ? `${Number(m[1])}/${Number(m[2])}` : date;
}

/**
 * 稼働の日が入る経過措置の段を、締めの期間で切った範囲（例：9/21〜10/20 の期間で 9/25 の稼働 → 9/21〜9/30）。
 * 段が見つからなければ、稼働のあった日の範囲のまま
 */
export function stepSpan(date: string, period: { from: string; to: string }, fallbackTo = date): { from: string; to: string } {
  const step = TRANSITIONAL_STEPS.find((x) => date >= x.from && (x.to === null || date <= x.to));
  if (!step) return { from: date, to: fallbackTo };
  return { from: step.from > period.from ? step.from : period.from, to: step.to !== null && step.to < period.to ? step.to : period.to };
}

export function companyCopy(draft: StatementDraft): CompanyCopy {
  const rawParts = Array.isArray(draft.burdenParts) ? draft.burdenParts : [];
  const parts: BurdenPart[] = rawParts.map((p) => {
    const span = draft.period ? stepSpan(p.from, draft.period, p.to) : { from: p.from, to: p.to };
    return {
      spanFrom: span.from,
      spanTo: span.to,
      from: p.from,
      to: p.to,
      base: p.base,
      burden: p.burden,
      ratePercent: ratePercent(p.rate),
      label: `${shortMonthDay(span.from)}〜${shortMonthDay(span.to)}`,
    };
  });
  return {
    unregistered: !draft.driver.invoiceRegistered,
    invoiceBurden: draft.invoiceBurden ?? 0,
    deductibleRatePercent: typeof draft.deductibleRate === "number" ? ratePercent(draft.deductibleRate) : null,
    parts,
    partsText: parts.length > 0 ? parts.map((p) => `${p.label} ${yen(p.burden)}（${p.ratePercent}%）`).join("／") : null,
    undatedAcrossStep: draft.undatedAcrossStep === true,
    periodEndBurden: parts.length > 0 ? periodEndBurdenOf(draft) : null,
  };
}

/** 期間全体を、期間の末日の割合で数えた負担（支払（税込）＝ 委託料 ＋ 消費税（相当額）。写しの数字から） */
export function periodEndBurdenOf(draft: Pick<StatementDraft, "subtotal" | "tax" | "period">): number | null {
  if (!draft.period?.to || typeof draft.subtotal !== "number") return null;
  return nonDeductibleTax(draft.subtotal + (draft.tax ?? 0), draft.period.to, TAX_RATE);
}
