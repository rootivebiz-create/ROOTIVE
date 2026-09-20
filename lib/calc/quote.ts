/**
 * 受注単価の見極め（見積シミュレーター。/projects?tab=quote で使う純関数）
 *
 * ■ 何をする関数か
 * 元請から提示された単価で「この案件を受けたら月いくら残るか」をその場で判断し、
 * 逆に「目標の利益率を出すには、いくら以上で受けるべきか」を逆算する。
 *
 * ■ 計算の組み立て（独自の計算はしない）
 * 1 人のドライバーが 1 か月 qty ぶん働く稼働行を作り、必要なドライバー数だけ並べて
 * calcEntry / calcDriverMonth / calcCompanyMonth に通す（§2.6 と同じ結果になる）。
 *   売上     bill          = 受注単価 × 数量 × 人数
 *   支払     pay           = 支払単価 × 数量 × 人数
 *   単価差   margin        = bill − pay
 *   ロイヤリティ royalty   = 端数処理(pay × 率)（行ごとに丸める）
 *   管理費   mgmtFeeTotal  = 管理費 × 人数（数量 0 の月は計上されない）
 *   会社利益 grossProfit   = margin + royalty + mgmtFeeTotal   ← calcCompanyMonth().profit
 * ここから、この案件に直課できる月額の費用（車両 × 人数 ＋ その他）を引いたものを営業利益とする。
 *   直課の費用 directCost      = 車両の月額 × 人数 + その他の月額
 *   営業利益   operatingProfit = grossProfit − directCost
 *   営業利益率 operatingMargin = operatingProfit ÷ bill
 * ※ 会社全体の固定費（事務所・システムなど）は案件に按分しない（v_project_pl と同じ考え方）。
 *
 * ■ 逆算（二分探索ではなく式で解く）
 * 受注単価 b 以外の項目は b に依存しないため、営業利益は b の一次式になる。
 *   必要売上 requiredBill = pay − royalty − mgmtFeeTotal + directCost   … 以下 K
 *   operatingProfit(b) = 数量 × 人数 × b − K
 *   ① 営業利益 0 になる受注単価        b0 = K ÷ (数量 × 人数)
 *   ② 目標利益率 t を満たす最低の受注単価  b1 = K ÷ (数量 × 人数 × (1 − t))
 *      （数量 × 人数 × b × (1 − t) ≧ K を b について解いたもの。t ≧ 1 は解なし）
 *   ③ 受注単価を動かせないときの支払単価の上限
 *      手残りの上限 A = bill × (1 − t) + mgmtFeeTotal − directCost
 *      人数 × (p × 数量 − ロイヤリティ) ≦ A  →  p1 = A ÷ (数量 × 人数 × (1 − ロイヤリティ率))
 *      （ロイヤリティの端数処理で 1 円未満ずれるため、最後に実際の計算で検算して 0.01 円ずつ寄せる）
 * 割り算は BigInt で行い、単価は DB と同じ小数 2 桁へ丸める（①②は切り上げ、③は切り捨て＝安全側）。
 */
import { pct, yen } from "@/lib/format";
import { calcCompanyMonth, calcDriverMonth } from "./month";
import { fromS4, mulMoney, subMoney, sumMoney, toS4 } from "./money";
import { changedRate, clampRoyaltyRate, roundRate } from "./simulate";
import type { EntryInput, RoundingMode } from "./types";

// ---------------------------------------------------------------------------
// 型
// ---------------------------------------------------------------------------

/** 見積の条件（金額はすべて税抜・月額） */
export interface QuoteInput {
  /** 受注単価（税抜） */
  billRate: number;
  /** ドライバーへの支払単価（税抜） */
  payRate: number;
  /** 1 か月の数量（日数・個数）。ドライバー 1 人あたり */
  qty: number;
  /** ロイヤリティ率（0.1 = 10%） */
  royaltyRate: number;
  /** 管理費（月額。ドライバー 1 人あたり） */
  mgmtFee: number;
  /** 必要なドライバー数 */
  driverCount: number;
  /** 車両にかかる月額（リース・保険・燃料などの見込み。1 台あたり＝ドライバー 1 人あたり） */
  vehicleCost: number;
  /** その他の月額（案件全体にかかる分。人数では掛けない） */
  otherCost: number;
  /** 端数処理（ロイヤリティに適用） */
  roundingMode: RoundingMode;
}

/** DB に保存できる値へ丸めた後の条件（実際に計算した値） */
export type QuoteNormalized = QuoteInput;

/** ドライバー 1 人あたり */
export interface QuotePerDriver {
  /** 1 人あたりの売上 */
  bill: number;
  /** 1 人あたりの会社利益（単価差 ＋ ロイヤリティ ＋ 管理費） */
  grossProfit: number;
  /** 1 人あたりの直課の費用（車両 ＋ その他を人数で割ったもの） */
  directCost: number;
  /** 1 人あたりの営業利益 */
  operatingProfit: number;
}

/** 逆算の答え。rate が null なら解なし（reason に日本語の理由） */
export interface RateSolution {
  /** 単価（円。小数 2 桁）。null = 解なし */
  rate: number | null;
  /** 今の単価との差（上げ幅・下げ幅。rate が null なら 0） */
  diff: number;
  /** 日本語の説明（解があるときは補足、無いときは理由） */
  reason: string;
}

export type QuoteVerdictLevel = "good" | "thin" | "loss";

export const QUOTE_VERDICT_LABELS: Record<QuoteVerdictLevel, string> = {
  good: "受けてよい単価です",
  thin: "薄利です",
  loss: "赤字です",
};

export interface QuoteVerdict {
  level: QuoteVerdictLevel;
  /** 短い見出し */
  label: string;
  /** 日本語 1 行の説明 */
  message: string;
}

export interface QuoteResult {
  /** 実際に計算に使った条件（小数 2 桁へ丸めた後） */
  normalized: QuoteNormalized;
  driverCount: number;
  /** 会社売上 */
  bill: number;
  /** ドライバー支払（税抜。ロイヤリティ・管理費を引く前） */
  pay: number;
  /** 単価差 ＝ 売上 − 支払 */
  margin: number;
  royalty: number;
  /** 管理費の合計（数量 0 の月は 0） */
  mgmtFeeTotal: number;
  /** 会社利益 ＝ 単価差 ＋ ロイヤリティ ＋ 管理費 */
  grossProfit: number;
  /** 直課の費用 ＝ 車両 × 人数 ＋ その他 */
  directCost: number;
  /** 営業利益 ＝ 会社利益 − 直課の費用 */
  operatingProfit: number;
  /** 営業利益率 ＝ 営業利益 ÷ 売上（売上 0 なら 0） */
  operatingMargin: number;
  /** 営業利益が 0 になる売上（＝ 支払 − ロイヤリティ − 管理費 ＋ 直課の費用） */
  requiredBill: number;
  perDriver: QuotePerDriver;
  /** 営業利益 0 になる受注単価（数量・人数が 0 なら null） */
  breakEvenBillRate: number | null;
  /** 判定に使った目標利益率 */
  targetMargin: number;
  /** 目標を満たす最低の受注単価 */
  targetBillRate: RateSolution;
  /** 受注単価を動かせないときの支払単価の上限 */
  maxPayRate: RateSolution;
  verdict: QuoteVerdict;
}

// ---------------------------------------------------------------------------
// 入力の正規化（DB の制約に合わせる）
// ---------------------------------------------------------------------------

/** ドライバー数の上限（画面の入力もこの範囲に収める） */
export const QUOTE_MAX_DRIVERS = 999;

function toCount(value: number): number {
  if (!Number.isFinite(value)) return 0;
  const n = Math.round(value);
  if (n <= 0) return 0;
  return n > QUOTE_MAX_DRIVERS ? QUOTE_MAX_DRIVERS : n;
}

/**
 * 単価・数量・金額は numeric(12,2)、率は numeric(6,4) で 0〜1。
 * 保存できる値に丸めてから計算する（roundRate はマイナスを 0 にする）。
 */
export function normalizeQuote(input: QuoteInput): QuoteNormalized {
  return {
    billRate: roundRate(input.billRate),
    payRate: roundRate(input.payRate),
    qty: roundRate(input.qty),
    royaltyRate: clampRoyaltyRate(input.royaltyRate),
    mgmtFee: roundRate(input.mgmtFee),
    driverCount: toCount(input.driverCount),
    vehicleCost: roundRate(input.vehicleCost),
    otherCost: roundRate(input.otherCost),
    roundingMode: input.roundingMode,
  };
}

// ---------------------------------------------------------------------------
// 割り算（lib/calc には割り算のヘルパーが無いため、ここで BigInt で行う）
// ---------------------------------------------------------------------------

/** 丸める向き：up ＝ 切り上げ（最低ライン）／down ＝ 切り捨て（上限） */
type RateDirection = "up" | "down";

/**
 * 分子 ÷ 分母 を「小数 2 桁の単価」として返す（分子・分母は同じ倍率で拡大した BigInt）。
 * 倍率は約分されるので、両方が同じ倍率であれば値は変わらない。分母 0 は null。
 */
function divideToRate(numerator: bigint, denominator: bigint, dir: RateDirection): number | null {
  if (denominator === 0n) return null;
  // 分母を正に揃える（BigInt の剰余は分子の符号に従うため）
  const num = denominator < 0n ? -numerator * 100n : numerator * 100n;
  const den = denominator < 0n ? -denominator : denominator;
  const q = num / den; // 0 方向へ切り捨て
  const r = num % den;
  let cents = q;
  if (r !== 0n) {
    if (dir === "up") cents = r > 0n ? q + 1n : q;
    else cents = r < 0n ? q - 1n : q;
  }
  return Number(cents) / 100;
}

/** 金額を人数で割る（小数 4 桁へ四捨五入）。人数 0 は 0 */
function dividePerDriver(value: number, count: number): number {
  if (!Number.isFinite(value) || count <= 0) return 0;
  const num = toS4(value);
  const den = BigInt(count);
  const q = num / den;
  const r = num % den;
  const abs = r < 0n ? -r : r;
  const adj = abs * 2n >= den ? (r < 0n ? -1n : 1n) : 0n;
  return fromS4(q + adj);
}

/** 数量 × 人数（小数 4 桁精度の BigInt）。0 なら逆算できない */
function qtyTimesDrivers(n: QuoteNormalized): bigint {
  return toS4(n.qty) * BigInt(n.driverCount);
}

/** 率 t に対する (1 − t) を小数 4 桁精度の BigInt で */
function oneMinusRateS4(rate: number): bigint {
  return 10_000n - toS4(rate);
}

/** 営業利益 ≧ 目標利益率 × 売上 か（小数 8 桁精度で誤差なく比べる） */
function meetsTarget(bill: number, operatingProfit: number, target: number): boolean {
  return toS4(operatingProfit) * 10_000n >= toS4(target) * toS4(bill);
}

// ---------------------------------------------------------------------------
// 金額の計算（calcEntry / calcDriverMonth / calcCompanyMonth を通す）
// ---------------------------------------------------------------------------

interface QuoteCore {
  bill: number;
  pay: number;
  margin: number;
  royalty: number;
  mgmtFeeTotal: number;
  grossProfit: number;
  directCost: number;
  operatingProfit: number;
  operatingMargin: number;
  requiredBill: number;
  perDriver: QuotePerDriver;
}

function entryOf(n: QuoteNormalized): EntryInput {
  return { qty: n.qty, billRate: n.billRate, payRate: n.payRate, royaltyRate: n.royaltyRate, roundingMode: n.roundingMode };
}

function quoteCore(n: QuoteNormalized): QuoteCore {
  // 同じ条件のドライバーを人数ぶん並べて、既存の月次計算をそのまま使う
  const one = calcDriverMonth({ entries: [entryOf(n)], mgmtFee: n.mgmtFee, adjustments: [] });
  const company = calcCompanyMonth(Array.from({ length: n.driverCount }, () => one));
  const directCost = sumMoney([mulMoney(n.vehicleCost, n.driverCount), n.otherCost]);
  const grossProfit = company.profit;
  const operatingProfit = subMoney(grossProfit, directCost);
  const requiredBill = sumMoney([company.pay, -company.royalty, -company.mgmtFee, directCost]);
  const perDriverDirect = n.driverCount > 0 ? sumMoney([n.vehicleCost, dividePerDriver(n.otherCost, n.driverCount)]) : 0;
  return {
    bill: company.bill,
    pay: company.pay,
    margin: company.margin,
    royalty: company.royalty,
    mgmtFeeTotal: company.mgmtFee,
    grossProfit,
    directCost,
    operatingProfit,
    operatingMargin: company.bill !== 0 ? operatingProfit / company.bill : 0,
    requiredBill,
    perDriver: {
      bill: n.driverCount > 0 ? one.bill : 0,
      grossProfit: n.driverCount > 0 ? one.driverProfit : 0,
      directCost: perDriverDirect,
      operatingProfit: n.driverCount > 0 ? subMoney(one.driverProfit, perDriverDirect) : 0,
    },
  };
}

// ---------------------------------------------------------------------------
// 逆算
// ---------------------------------------------------------------------------

const NO_QTY_REASON = "数量またはドライバー数が 0 のため、単価を逆算できません。";

function solution(rate: number | null, current: number, reason: string): RateSolution {
  return { rate, diff: rate == null ? 0 : subMoney(rate, current), reason };
}

/** ① 営業利益 0 になる受注単価 ＝ 必要売上 ÷（数量 × 人数） */
function solveBreakEven(n: QuoteNormalized, core: QuoteCore): number | null {
  const denom = qtyTimesDrivers(n);
  if (denom === 0n) return null;
  const rate = divideToRate(toS4(core.requiredBill), denom, "up");
  if (rate == null) return null;
  return rate < 0 ? 0 : rate;
}

/** 目標に対する不足額 ＝ 目標利益率 × 売上 − 営業利益（0 以下なら足りている） */
function shortfall(core: QuoteCore, target: number): number {
  return subMoney(mulMoney(core.bill, target), core.operatingProfit);
}

/** 不足額を埋めるのに必要な単価の幅（1 円未満のずれを 1 回で寄せるための刻み） */
function stepFor(gap: number, denominator: bigint): number {
  if (denominator === 0n) return 0.01;
  const step = divideToRate(toS4(gap) * 10_000n, denominator, "up");
  return step == null || step <= 0 ? 0.01 : step;
}

/**
 * 検算：受注単価を入れ直して目標に届くまで寄せる（最大 5 回）。
 * 受注単価は式どおりに解けるため通常は 1 回目で終わる（端数処理のずれに備えた保険）。
 */
function fitBillRate(n: QuoteNormalized, start: number, target: number): number {
  const denominator = qtyTimesDrivers(n) * oneMinusRateS4(target);
  let rate = start;
  for (let i = 0; i < 5; i += 1) {
    const core = quoteCore({ ...n, billRate: rate });
    if (meetsTarget(core.bill, core.operatingProfit, target)) return rate;
    rate = roundRate(rate + stepFor(shortfall(core, target), denominator));
  }
  return rate;
}

/** 検算：支払単価を入れ直して目標に届くまで下げる（ロイヤリティの端数処理のずれを吸収。最大 5 回） */
function fitPayRate(n: QuoteNormalized, start: number, target: number): number | null {
  const denominator = qtyTimesDrivers(n) * oneMinusRateS4(n.royaltyRate);
  let rate = start;
  for (let i = 0; i < 5; i += 1) {
    const core = quoteCore({ ...n, payRate: rate });
    if (meetsTarget(core.bill, core.operatingProfit, target)) return rate;
    if (rate <= 0) return null;
    const next = roundRate(rate - stepFor(shortfall(core, target), denominator));
    rate = next >= rate ? roundRate(rate - 0.01) : next;
  }
  return null;
}

/** ② 目標利益率を満たす最低の受注単価 */
function solveTargetBillRate(n: QuoteNormalized, core: QuoteCore, target: number): RateSolution {
  const nq = qtyTimesDrivers(n);
  if (nq === 0n) return solution(null, n.billRate, NO_QTY_REASON);
  if (target >= 1) return solution(null, n.billRate, "目標利益率が 100% 以上のため、達成できる受注単価はありません。");
  if (core.requiredBill <= 0) {
    return solution(0, n.billRate, "支払・費用より管理費などの収入が多いため、受注単価がいくらでも目標を満たします。");
  }
  // b ＝ 必要売上 ÷（数量 × 人数 ×（1 − 目標利益率））。分子・分母とも 1e8 倍で揃える
  const rate = divideToRate(toS4(core.requiredBill) * 10_000n, nq * oneMinusRateS4(target), "up");
  if (rate == null) return solution(null, n.billRate, "目標利益率が 100% 以上のため、達成できる受注単価はありません。");
  const fixed = fitBillRate(n, rate < 0 ? 0 : rate, target);
  const reason =
    target === 0
      ? `受注単価 ${yen(fixed)} 以上なら赤字になりません。`
      : `受注単価 ${yen(fixed)} 以上で営業利益率 ${pct(target)} に届きます。`;
  return solution(fixed, n.billRate, reason);
}

/** ③ 受注単価を動かせないときの支払単価の上限 */
function solveMaxPayRate(n: QuoteNormalized, core: QuoteCore, target: number): RateSolution {
  const nq = qtyTimesDrivers(n);
  if (nq === 0n) return solution(null, n.payRate, NO_QTY_REASON);
  if (n.royaltyRate >= 1) {
    return solution(null, n.payRate, "ロイヤリティ率が 100% のため、支払単価を変えても手残りは変わりません。");
  }
  // 手残りの上限 A ＝ 売上 ×（1 − 目標利益率）＋ 管理費 − 直課の費用
  const allowance = sumMoney([mulMoney(core.bill, fromS4(oneMinusRateS4(target))), core.mgmtFeeTotal, -core.directCost]);
  if (allowance < 0) {
    return solution(null, n.payRate, "支払単価を 0 にしても目標に届きません。受注単価か費用の見直しが必要です。");
  }
  const rate = divideToRate(toS4(allowance) * 10_000n, nq * oneMinusRateS4(n.royaltyRate), "down");
  if (rate == null || rate < 0) {
    return solution(null, n.payRate, "支払単価を 0 にしても目標に届きません。受注単価か費用の見直しが必要です。");
  }
  const fixed = fitPayRate(n, rate, target);
  if (fixed == null) {
    return solution(null, n.payRate, "支払単価を 0 にしても目標に届きません。受注単価か費用の見直しが必要です。");
  }
  const reason =
    target === 0
      ? `支払単価 ${yen(fixed)} までなら赤字になりません。`
      : `支払単価 ${yen(fixed)} までなら営業利益率 ${pct(target)} を保てます。`;
  return solution(fixed, n.payRate, reason);
}

// ---------------------------------------------------------------------------
// 判定
// ---------------------------------------------------------------------------

/** 「受注単価を ¥A 上げるか、支払単価を ¥B 下げると…」の一文 */
function buildHint(target: number, bill: RateSolution, pay: RateSolution): string {
  const upBill = bill.rate != null && bill.diff > 0 ? yen(bill.diff) : null;
  const downPay = pay.rate != null && pay.diff < 0 ? yen(-pay.diff) : null;
  const goal = `目標（営業利益率 ${pct(target)}）`;
  if (upBill && downPay) return `受注単価を ${upBill} 上げるか、支払単価を ${downPay} 下げると${goal}に届きます。`;
  if (upBill) return `受注単価を ${upBill} 上げると${goal}に届きます。`;
  if (downPay) return `支払単価を ${downPay} 下げると${goal}に届きます。`;
  if (bill.rate == null && pay.rate == null) return bill.reason;
  return `単価の調整だけでは${goal}に届きません。数量・人数・費用の見直しが必要です。`;
}

function buildVerdict(
  core: QuoteCore,
  target: number,
  breakEven: number | null,
  billSolution: RateSolution,
  paySolution: RateSolution,
): QuoteVerdict {
  if (core.bill === 0 && core.operatingProfit === 0) {
    // 何も入力されていない状態（売上も費用も 0）。良好とは言えないので判断を保留する
    return { level: "thin", label: "まだ試算できません", message: "受注単価・月の数量・必要なドライバー数を入力すると試算できます。" };
  }
  if (core.operatingProfit < 0) {
    const head = `この単価だと月 ${yen(-core.operatingProfit)} の赤字です。`;
    return { level: "loss", label: QUOTE_VERDICT_LABELS.loss, message: `${head}${buildHint(target, billSolution, paySolution)}` };
  }
  if (!meetsTarget(core.bill, core.operatingProfit, target)) {
    const head = `月 ${yen(core.operatingProfit)} の黒字ですが、営業利益率 ${pct(core.operatingMargin)} は目標 ${pct(target)} に届きません。`;
    return { level: "thin", label: QUOTE_VERDICT_LABELS.thin, message: `${head}${buildHint(target, billSolution, paySolution)}` };
  }
  const head = `月 ${yen(core.operatingProfit)} の黒字で、営業利益率 ${pct(core.operatingMargin)} は目標 ${pct(target)} を満たします。`;
  const tail = breakEven != null && breakEven > 0 ? `受注単価が ${yen(breakEven)} を下回ると赤字になります。` : "";
  return { level: "good", label: QUOTE_VERDICT_LABELS.good, message: `${head}${tail}` };
}

// ---------------------------------------------------------------------------
// 入口
// ---------------------------------------------------------------------------

/** 見積の試算一式（目標利益率は 0〜1。省略時は 0 ＝ 赤字かどうかだけ見る） */
export function calcQuote(input: QuoteInput, targetMargin: number = 0): QuoteResult {
  const n = normalizeQuote(input);
  const core = quoteCore(n);
  const target = clampRoyaltyRate(targetMargin); // 目標利益率も 0〜100% の率なので同じ丸めを使う
  const breakEven = solveBreakEven(n, core);
  const billSolution = solveTargetBillRate(n, core, target);
  const paySolution = solveMaxPayRate(n, core, target);
  return {
    normalized: n,
    driverCount: n.driverCount,
    ...core,
    breakEvenBillRate: breakEven,
    targetMargin: target,
    targetBillRate: billSolution,
    maxPayRate: paySolution,
    verdict: buildVerdict(core, target, breakEven, billSolution, paySolution),
  };
}

/** 営業利益 0 になる受注単価（数量・人数が 0 なら null） */
export function breakEvenBillRate(input: QuoteInput): number | null {
  const n = normalizeQuote(input);
  return solveBreakEven(n, quoteCore(n));
}

/** 目標の利益率を満たす最低の受注単価 */
export function targetBillRate(input: QuoteInput, targetMargin: number): RateSolution {
  const n = normalizeQuote(input);
  return solveTargetBillRate(n, quoteCore(n), clampRoyaltyRate(targetMargin));
}

/** 受注単価を動かせないときの支払単価の上限 */
export function maxPayRate(input: QuoteInput, targetMargin: number): RateSolution {
  const n = normalizeQuote(input);
  return solveMaxPayRate(n, quoteCore(n), clampRoyaltyRate(targetMargin));
}

/** 判定（good ／ thin ／ loss と日本語 1 行） */
export function judgeQuote(input: QuoteInput, targetMargin: number = 0): QuoteVerdict {
  return calcQuote(input, targetMargin).verdict;
}

// ---------------------------------------------------------------------------
// 感度（受注単価・支払単価・数量を振ったときの営業利益）
// ---------------------------------------------------------------------------

/** 感度の表で振る項目 */
export type SensitivityField = "billRate" | "payRate" | "qty";

export const SENSITIVITY_FIELD_LABELS: Record<SensitivityField, string> = {
  billRate: "受注単価",
  payRate: "支払単価",
  qty: "月の数量",
};

/** 既定の振れ幅（−5% / −2.5% / 現在 / +2.5% / +5%） */
export const SENSITIVITY_RATIOS = [-0.05, -0.025, 0, 0.025, 0.05];

export interface SensitivityRow {
  /** 振れ幅（0 が「現在」） */
  ratio: number;
  /** 振った後の値（単価または数量） */
  value: number;
  bill: number;
  operatingProfit: number;
  operatingMargin: number;
  level: QuoteVerdictLevel;
  /** 現在の条件の行か */
  current: boolean;
}

/** 1 項目だけを ±% で振ったときの営業利益（計算は calcQuote と同じ経路を通る） */
export function quoteSensitivity(
  input: QuoteInput,
  targetMargin: number,
  field: SensitivityField,
  ratios: number[] = SENSITIVITY_RATIOS,
): SensitivityRow[] {
  const base = normalizeQuote(input);
  const target = clampRoyaltyRate(targetMargin);
  return ratios.map((ratio) => {
    // 単価・数量とも小数 2 桁・マイナスは 0 に丸める（changedRate は単価改定シミュレーションと同じ）
    const value = ratio === 0 ? base[field] : changedRate(base[field], ratio, null);
    const n: QuoteNormalized = { ...base, [field]: value };
    const core = quoteCore(n);
    const level: QuoteVerdictLevel = core.operatingProfit < 0 ? "loss" : meetsTarget(core.bill, core.operatingProfit, target) ? "good" : "thin";
    return {
      ratio,
      value,
      bill: core.bill,
      operatingProfit: core.operatingProfit,
      operatingMargin: core.operatingMargin,
      level,
      current: ratio === 0,
    };
  });
}
