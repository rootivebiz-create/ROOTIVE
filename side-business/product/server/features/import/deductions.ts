/**
 * 取り込み：Excel の控除の列の値から、計算のしかた（ルール）を読み取る（純関数。DB に触らない）。
 * 「あなたの Excel はこう計算しています。合っていますか？」と聞くための下書きを作るだけで、決めるのは会社。
 *
 * - percent：委託料 × 率（率は 0.5% きざみ）
 * - fixed：稼働した人は同じ額（onlyWhenWorked）
 * - per_unit：数量 × 単価（単価は 0.1 円きざみ）
 * いちばん多くの人に合う式を選び、合わない人は「その人だけの式」で説明できるかを見る（1 人だけ 8% など）。
 * 端数は切り捨て・四捨五入・切り上げのどれでも合えば「合う」とする（|値 − 式| < 1 円）。
 */
import { roundYen } from "@/lib/payroll/money";
import type { Rounding } from "@/lib/payroll/types";

export type RuleGuess = { kind: "percent"; rate: number } | { kind: "fixed"; amount: number } | { kind: "per_unit"; rate: number };

export type DeductionObservation = {
  driverId: string;
  name: string;
  /** Excel の控除の額（マイナスで書いてあっても、額として読む） */
  value: number;
  /** 委託料（税抜）。率の元 */
  base: number;
  /** 数量の合計。数量 × 単価の元 */
  qty: number;
};

export type Outlier = {
  driverId: string;
  name: string;
  value: number;
  /** みんなの式で計算した額 */
  expected: number;
  /** その人だけの式（説明できなければ null） */
  own: RuleGuess | null;
};

export type Inference = {
  guess: RuleGuess;
  /** 式が合った人 */
  matched: { driverId: string; name: string }[];
  /** 見た人数（額が 0 の人も含む） */
  total: number;
  outliers: Outlier[];
  /** 合った人すべてで、ぴったり同じになる端数の処理 */
  roundings: Rounding[];
};

export type InferenceResult = { inference: Inference; reason: null } | { inference: null; reason: string };

const ROUNDINGS: Rounding[] = ["floor", "round", "ceil"];

/** 式で出す前の額（端数の処理の前） */
function raw(guess: RuleGuess, o: DeductionObservation): number {
  if (guess.kind === "percent") return o.base * guess.rate;
  if (guess.kind === "per_unit") return o.qty * guess.rate;
  return guess.amount;
}

function fits(guess: RuleGuess, o: DeductionObservation): boolean {
  return Math.abs(Math.abs(o.value) - raw(guess, o)) < 1 - 1e-9;
}

function stepRate(r: number): number {
  return Math.round(r * 200) / 200;
}

function stepUnit(u: number): number {
  return Math.round(u * 10) / 10;
}

/** 候補の中から、合う人がいちばん多いもの（同じなら先に出てきたもの） */
function best(cands: RuleGuess[], obs: DeductionObservation[]): { guess: RuleGuess; n: number } | null {
  let top: { guess: RuleGuess; n: number } | null = null;
  const seen = new Set<string>();
  for (const g of cands) {
    const key = `${g.kind}:${g.kind === "fixed" ? g.amount : g.rate}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const n = obs.filter((o) => fits(g, o)).length;
    if (!top || n > top.n) top = { guess: g, n };
  }
  return top;
}

/** その人だけの式で説明できるか（同じ種類の式で） */
function ownRule(kind: RuleGuess["kind"], o: DeductionObservation): RuleGuess | null {
  const v = Math.abs(o.value);
  if (kind === "fixed") return { kind: "fixed", amount: Math.round(v) };
  if (kind === "percent") {
    if (o.base <= 0) return v === 0 ? { kind: "percent", rate: 0 } : null;
    const g: RuleGuess = { kind: "percent", rate: stepRate(v / o.base) };
    return fits(g, o) ? g : null;
  }
  if (o.qty <= 0) return v === 0 ? { kind: "per_unit", rate: 0 } : null;
  const g: RuleGuess = { kind: "per_unit", rate: stepUnit(v / o.qty) };
  return fits(g, o) ? g : null;
}

/**
 * 控除の列の値から式を読み取る。見た人の半分以上（2 人以上）に合う式が無ければ、理由を返す。
 * 優先：定額 → 率 → 数量 × 単価（同じ人数に合うなら、簡単な式を選ぶ）
 * hint：Excel の数式から読んだ式（=E5*0.1 など）。値と照らして、ほかの式と同じ人数以上に合うときだけ使う（0.5% きざみでない率も読める）
 */
export function inferDeductionRule(observations: DeductionObservation[], hint?: RuleGuess | null): InferenceResult {
  const obs = observations.filter((o) => Number.isFinite(o.value));
  const withValue = obs.filter((o) => Math.abs(o.value) > 0);
  if (withValue.length === 0) return { inference: null, reason: "額が入っている人がいません" };
  if (obs.length < 2) return { inference: null, reason: "1 人分しかないので、式を決められません" };

  const fixed = best(
    withValue.map((o) => ({ kind: "fixed" as const, amount: Math.round(Math.abs(o.value)) })),
    obs,
  );
  const percent = best(
    withValue.filter((o) => o.base > 0).map((o) => ({ kind: "percent" as const, rate: stepRate(Math.abs(o.value) / o.base) })),
    obs,
  );
  const perUnit = best(
    withValue.filter((o) => o.qty > 0).map((o) => ({ kind: "per_unit" as const, rate: stepUnit(Math.abs(o.value) / o.qty) })),
    obs,
  );
  const ranked = [fixed, percent, perUnit].filter((x): x is { guess: RuleGuess; n: number } => !!x && x.n > 0 && !(x.guess.kind !== "fixed" && x.guess.rate <= 0));
  let top = ranked.reduce<{ guess: RuleGuess; n: number } | null>((a, b) => (!a || b.n > a.n ? b : a), null);
  const need = Math.max(2, Math.ceil(obs.length / 2));
  if (hint && !(hint.kind !== "fixed" && hint.rate <= 0)) {
    const n = obs.filter((o) => fits(hint, o)).length;
    if (n >= need && (!top || n >= top.n)) top = { guess: hint, n };
  }
  if (!top || top.n < need) {
    return { inference: null, reason: "人ごとに額が違い、全員に合う決まった式が見つかりませんでした" };
  }

  const matched = obs.filter((o) => fits(top.guess, o));
  const outliers: Outlier[] = obs
    .filter((o) => !fits(top.guess, o))
    .map((o) => ({
      driverId: o.driverId,
      name: o.name,
      value: Math.abs(o.value),
      expected: roundYen(raw(top.guess, o), "round"),
      own: ownRule(top.guess.kind, o),
    }));
  const roundings = ROUNDINGS.filter((mode) => matched.every((o) => roundYen(raw(top.guess, o), mode) === Math.round(Math.abs(o.value))));
  return {
    inference: {
      guess: top.guess,
      matched: matched.map((o) => ({ driverId: o.driverId, name: o.name })),
      total: obs.length,
      outliers: outliers.sort((a, b) => a.name.localeCompare(b.name, "ja")),
      roundings,
    },
    reason: null,
  };
}

/** 式を日本語で（画面・記録に出す） */
export function guessText(g: RuleGuess): string {
  if (g.kind === "percent") return `委託料 × ${formatRate(g.rate)}`;
  if (g.kind === "per_unit") return `数量 × ${g.rate.toLocaleString("ja-JP", { maximumFractionDigits: 1 })}円`;
  return `毎月 ${Math.round(g.amount).toLocaleString("ja-JP")}円（稼働した月だけ）`;
}

export function formatRate(rate: number): string {
  // 10% ・ 8.5% ・ 8.33%（Excel の数式から読んだ半端な率も、丸めずに見せる）
  const v = Math.round(rate * 10000) / 100;
  return `${v.toLocaleString("ja-JP", { maximumFractionDigits: 2 })}%`;
}

export function sameGuess(a: RuleGuess, b: RuleGuess): boolean {
  if (a.kind !== b.kind) return false;
  if (a.kind === "fixed" && b.kind === "fixed") return Math.round(a.amount) === Math.round(b.amount);
  if (a.kind !== "fixed" && b.kind !== "fixed") return Math.abs(a.rate - b.rate) < 1e-9;
  return false;
}
