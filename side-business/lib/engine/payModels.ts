/**
 * 支払の形（業種ごとの報酬の決め方）の純関数。1 行ぶんの金額と、取引条件明示書の「算定方法」に書ける文を返す。
 *
 *  - unit        数量 × 単価（個・日・コマ・字・ページ・点・カット）
 *  - commission  売上の区分ごと × 率（率を掛ける売上が税込か税抜か）
 *  - tiered      段階歩合（全額スライド／超過累進）
 *  - guarantee   最低保証 max(歩合, 保証の日額 × 日数)。労働者性の注意つき
 *  - settlement  精算幅（固定・上下割・中間割・時間単価、時間の丸め、単価の端数、営業日の日割り）
 *  - threshold   しきい値つきの加算 max(0, 人数 − 基準) × 単価
 *  - fixed       定額（月額・一式）
 *  - contractFee 契約で決めた差し引き（管理費・ロイヤリティ・材料費。報酬そのものを減らすもの。マイナスの行）
 *  - chairRental 面貸しの精算（報酬ではなく、預かった売上の精算。消費税・源泉の対象から外す）
 *
 * 金額は整数の円。端数は既定で切り捨て（floor）。
 * どの形も、労働者性や法令への適合を判定しない（注意を出すだけ）。
 */
import { roundYen } from "@/lib/payroll/money";
import {
  DEFAULT_CONSUMPTION_TAX_RATE,
  LABOR_RISK_TEXT,
  REDUCTION_RISK_TEXT,
  clean,
  en,
  isFiniteNumber,
  num,
  percent,
  type EngineWarning,
  type Rounding,
} from "./types";

export type ModelResult = {
  /** この行の金額（税抜。contractFee はマイナス） */
  amount: number;
  /** 算定方法（取引条件明示書に書ける文。今月の数字は入れない） */
  formulaText: string;
  /** 今月の計算（数字を入れた式） */
  detail: string;
  warnings: EngineWarning[];
  /** 注意ではない補足（面貸しの精算である旨など） */
  notes: string[];
};

const ROUNDING_TEXT: Record<Rounding, string> = {
  floor: "1円未満切り捨て",
  round: "1円未満四捨五入",
  ceil: "1円未満切り上げ",
};

function invalid(message: string): EngineWarning {
  return { code: "invalid_input", level: "warning", message };
}

function finite(value: number | undefined, fallback = 0): number {
  return isFiniteNumber(value) ? value : fallback;
}

/* ───────────── (a) 数量 × 単価 ───────────── */

export type UnitInput = {
  qty: number;
  /** 単価（税抜。1字 2.0円 のような小数も可） */
  rate: number;
  /** 数量の単位（字・個・日・コマ） */
  unitLabel?: string;
  /** 数量 × 単価の端数（既定：切り捨て） */
  rounding?: Rounding;
};

export function calcUnit(input: UnitInput): ModelResult {
  const warnings: EngineWarning[] = [];
  const qty = finite(input.qty);
  const rate = finite(input.rate);
  if (!isFiniteNumber(input.qty) || !isFiniteNumber(input.rate)) warnings.push(invalid("数量と単価を数字で入れてください"));
  if (qty < 0 || rate < 0) warnings.push(invalid("数量と単価は0以上で入れてください"));
  const rounding = input.rounding ?? "floor";
  const unit = input.unitLabel ?? "単位";
  const amount = roundYen(qty * rate, rounding);
  const fractional = !Number.isInteger(clean(qty * rate));
  return {
    amount,
    formulaText: `1${unit}あたり ${num(rate)}円 × ${unit}数${fractional ? `（${ROUNDING_TEXT[rounding]}）` : ""}`,
    detail: `${num(qty)}${unit} × ${num(rate)}円 = ${en(amount)}`,
    warnings,
    notes: [],
  };
}

/* ───────────── (b) 売上 × 率 ───────────── */

export type SalesCategory = {
  /** フリー・指名・店販・オプション など */
  label: string;
  sales: number;
  /** 0.45 = 45% */
  rate: number;
};

export type CommissionInput = {
  categories: SalesCategory[];
  /** 入れた売上が税込か（既定：税抜） */
  salesInputIncludesTax?: boolean;
  /** 率を掛ける売上（既定：入れた売上と同じ） */
  rateAppliesTo?: "excl" | "incl";
  /** 税込 ↔ 税抜の換算に使う消費税率（既定 DEFAULT_CONSUMPTION_TAX_RATE） */
  taxRate?: number;
  /** 区分ごとの売上 × 率の端数（既定：切り捨て） */
  rounding?: Rounding;
};

function taxPercent(taxRate: number | undefined): number {
  return Math.round(finite(taxRate, DEFAULT_CONSUMPTION_TAX_RATE) * 100);
}

/** 率を掛ける売上へ直す（税込 → 税抜は 1円未満切り捨て） */
export function salesForRate(sales: number, input: CommissionInput): number {
  const inIncl = input.salesInputIncludesTax === true;
  const applyTo = input.rateAppliesTo ?? (inIncl ? "incl" : "excl");
  const p = taxPercent(input.taxRate);
  if (inIncl && applyTo === "excl") return Math.floor((sales * 100) / (100 + p));
  if (!inIncl && applyTo === "incl") return sales + Math.floor((sales * p) / 100);
  return sales;
}

export function calcCommission(input: CommissionInput): ModelResult {
  const warnings: EngineWarning[] = [];
  const rounding = input.rounding ?? "floor";
  const applyTo = input.rateAppliesTo ?? (input.salesInputIncludesTax ? "incl" : "excl");
  const basisText = applyTo === "incl" ? "税込" : "税抜";
  const parts: string[] = [];
  const details: string[] = [];
  let amount = 0;
  for (const c of input.categories) {
    const sales = finite(c.sales);
    const rate = finite(c.rate);
    if (sales < 0 || rate < 0 || rate > 1) warnings.push(invalid(`「${c.label}」の売上と率を確かめてください（率は0〜100%）`));
    const base = salesForRate(sales, input);
    const part = roundYen(base * rate, rounding);
    amount += part;
    parts.push(`${c.label}の売上（${basisText}）× ${percent(rate)}`);
    details.push(`${c.label} ${en(base)} × ${percent(rate)} = ${en(part)}`);
  }
  if (input.categories.length === 0) warnings.push(invalid("売上の区分を1つ以上入れてください"));
  const converted =
    (input.salesInputIncludesTax === true) !== (applyTo === "incl")
      ? `（入力した売上を${basisText}に直してから掛ける）`
      : "";
  return {
    amount,
    formulaText: `${parts.join(" ＋ ")}${converted}。区分ごとに${ROUNDING_TEXT[rounding]}`,
    detail: `${details.join("、")} → 合計 ${en(amount)}`,
    warnings,
    notes: [],
  };
}

/* ───────────── (c) 段階歩合 ───────────── */

export type Tier = {
  /** この段階の上限（この額を含む）。最後の段階は null */
  upTo: number | null;
  rate: number;
};

export type TieredInput = {
  sales: number;
  tiers: Tier[];
  /** slide = 全額スライド（売上全体 × その売上が入る段階の率）、progressive = 超過累進（段階ごとの部分 × 率の合計） */
  mode: "slide" | "progressive";
  /** 売上の呼び方（技術売上 など） */
  salesLabel?: string;
  rounding?: Rounding;
};

function tierRangeText(tiers: Tier[]): string {
  let prev = 0;
  return tiers
    .map((t) => {
      const text = t.upTo === null ? `${en(prev)}を超える部分` : `${prev === 0 ? "" : `${en(prev)}を超え`}${en(t.upTo)}まで`;
      prev = t.upTo ?? prev;
      return `${text} ${percent(t.rate)}`;
    })
    .join("／");
}

export function calcTiered(input: TieredInput): ModelResult {
  const warnings: EngineWarning[] = [];
  const rounding = input.rounding ?? "floor";
  const label = input.salesLabel ?? "売上";
  const sales = Math.max(0, finite(input.sales));
  const tiers = input.tiers;
  const ordered =
    tiers.length > 0 &&
    tiers[tiers.length - 1].upTo === null &&
    tiers.every((t, i) => i === tiers.length - 1 || (t.upTo !== null && (i === 0 || t.upTo > (tiers[i - 1].upTo ?? 0))));
  if (!ordered) {
    warnings.push(invalid("段階は上限の小さい順に並べ、最後の段階は上限なしにしてください"));
    return { amount: 0, formulaText: "", detail: "", warnings, notes: [] };
  }

  if (input.mode === "slide") {
    const tier = tiers.find((t) => t.upTo === null || sales <= t.upTo) ?? tiers[tiers.length - 1];
    const amount = roundYen(sales * tier.rate, rounding);
    return {
      amount,
      formulaText: `全額スライド：${label}の全額 × その${label}が入る段階の率（${tierRangeText(tiers)}）。${ROUNDING_TEXT[rounding]}`,
      detail: `${label} ${en(sales)} × ${percent(tier.rate)} = ${en(amount)}`,
      warnings,
      notes: [],
    };
  }

  let prev = 0;
  let raw = 0;
  const details: string[] = [];
  for (const t of tiers) {
    const top = t.upTo === null ? sales : Math.min(sales, t.upTo);
    const portion = Math.max(0, top - prev);
    if (portion > 0) {
      raw += portion * t.rate;
      details.push(`${en(portion)} × ${percent(t.rate)} = ${en(clean(portion * t.rate))}`);
    }
    if (t.upTo === null || sales <= t.upTo) break;
    prev = t.upTo;
  }
  const amount = roundYen(raw, rounding);
  return {
    amount,
    formulaText: `超過累進：${label}を段階に分け、段階ごとの部分 × 率を合計（${tierRangeText(tiers)}）。${ROUNDING_TEXT[rounding]}`,
    detail: `${details.join(" ＋ ")} → ${en(amount)}`,
    warnings,
    notes: [],
  };
}

/* ───────────── (d) 最低保証 ───────────── */

export type GuaranteeInput = {
  commission: CommissionInput;
  /** 保証の日額 */
  dailyGuarantee: number;
  days: number;
};

export function calcGuarantee(input: GuaranteeInput): ModelResult {
  const c = calcCommission(input.commission);
  const daily = Math.max(0, finite(input.dailyGuarantee));
  const days = Math.max(0, finite(input.days));
  const guaranteed = roundYen(daily * days, "floor");
  const amount = Math.max(c.amount, guaranteed);
  const used = c.amount >= guaranteed ? "歩合" : "保証";
  return {
    amount,
    formulaText: `歩合（${c.formulaText}）と、保証の日額 ${en(daily)} × 稼働日数 の多いほう`,
    detail: `max(歩合 ${en(c.amount)}, ${en(daily)} × ${num(days)}日 = ${en(guaranteed)}) = ${en(amount)}（${used}を採用）`,
    warnings: [
      ...c.warnings,
      {
        code: "labor_risk_guarantee",
        level: "caution",
        message: `日数に結びついた最低保証は、時間や日で払う給与に近く見えることがあります。${LABOR_RISK_TEXT}`,
      },
    ],
    notes: [],
  };
}

/* ───────────── (e) 精算幅 ───────────── */

export type SettlementMode = "fixed" | "updown" | "middle" | "hourly";

export const SETTLEMENT_MODE_LABELS: Record<SettlementMode, string> = {
  fixed: "固定（精算なし）",
  updown: "上下割",
  middle: "中間割",
  hourly: "時間単価",
};

export type SettlementInput = {
  mode: SettlementMode;
  /** 月額（fixed / updown / middle） */
  monthly?: number;
  /** 時間単価（hourly） */
  hourlyRate?: number;
  /** 精算幅の下限・上限（時間） */
  lower?: number;
  upper?: number;
  /** 実働時間 */
  actualHours: number;
  /** 実働の丸め（分。既定 1 = 丸めない）。単位に満たない分は切り捨て */
  timeUnitMinutes?: 1 | 15 | 30 | 60;
  /** 超過・控除の単価の端数（1・10・100円未満を切り捨て。既定 1） */
  unitPriceStep?: 1 | 10 | 100;
  /** 月の途中で入る・抜けるときの日割り（営業日） */
  proration?: { workedDays: number; businessDays: number };
  /** 日割りの額と、単価 × 時間の端数（既定：切り捨て） */
  rounding?: Rounding;
};

export type SettlementDetail = {
  /** 丸めたあとの実働（時間） */
  countedHours: number;
  /** 日割りしたあとの基本の額 */
  base: number;
  /** 日割りしたあとの精算幅 */
  lower: number | null;
  upper: number | null;
  excessUnitPrice: number | null;
  shortUnitPrice: number | null;
  /** 超過（＋）・控除（−）の額 */
  adjustment: number;
};

export type SettlementResult = ModelResult & { settlement: SettlementDetail };

/** 単価の端数：step 円未満を切り捨て */
export function floorToStep(value: number, step: number): number {
  return Math.floor(clean(value) / step) * step;
}

/** 実働（時間）を unit 分単位に切り捨てて、分で返す */
export function countedMinutes(hours: number, unit: number): number {
  const minutes = Math.round(clean(hours * 60) * 1000) / 1000;
  return Math.floor(minutes / unit) * unit;
}

export function calcSettlement(input: SettlementInput): SettlementResult {
  const warnings: EngineWarning[] = [];
  const rounding = input.rounding ?? "floor";
  const unit = input.timeUnitMinutes ?? 1;
  const step = input.unitPriceStep ?? 1;
  const minutes = countedMinutes(Math.max(0, finite(input.actualHours)), unit);
  const countedHours = minutes / 60;
  const unitText = unit === 1 ? "1分単位" : `${unit}分単位（未満は切り捨て）`;
  const stepText = step === 1 ? "1円未満切り捨て" : `${step}円未満切り捨て`;

  if (input.mode === "hourly") {
    const rate = Math.max(0, finite(input.hourlyRate));
    const amount = roundYen((rate * minutes) / 60, rounding);
    return {
      amount,
      formulaText: `時間単価 ${en(rate)} × 実働時間（${unitText}）`,
      detail: `${en(rate)} × ${num(countedHours)}時間 = ${en(amount)}`,
      warnings,
      notes: [],
      settlement: {
        countedHours,
        base: amount,
        lower: null,
        upper: null,
        excessUnitPrice: null,
        shortUnitPrice: null,
        adjustment: 0,
      },
    };
  }

  const P = Math.max(0, finite(input.monthly));
  const pr = input.proration;
  let ratioNum = 1;
  let ratioDen = 1;
  if (pr) {
    if (!(pr.businessDays > 0) || pr.workedDays < 0 || pr.workedDays > pr.businessDays) {
      warnings.push(invalid("日割りの営業日を確かめてください（稼働日 ≦ その月の営業日）"));
    } else {
      ratioNum = pr.workedDays;
      ratioDen = pr.businessDays;
    }
  }
  const prorated = ratioNum !== ratioDen;
  const base = prorated ? roundYen((P * ratioNum) / ratioDen, rounding) : P;
  const prorateText = prorated
    ? `月の途中の参画・終了は、月額と精算幅を営業日で日割り（稼働した営業日 ÷ その月の営業日。${ROUNDING_TEXT[rounding]}）。`
    : "";
  const prorateDetail = prorated ? `${en(P)} × ${ratioNum}/${ratioDen}営業日 = ${en(base)}` : `${en(P)}`;

  if (input.mode === "fixed") {
    return {
      amount: base,
      formulaText: `月額 ${en(P)}（時間による精算なし）。${prorateText}`,
      detail: prorateDetail,
      warnings,
      notes: [],
      settlement: {
        countedHours,
        base,
        lower: null,
        upper: null,
        excessUnitPrice: null,
        shortUnitPrice: null,
        adjustment: 0,
      },
    };
  }

  const lower = finite(input.lower);
  const upper = finite(input.upper);
  if (!(lower > 0) || !(upper > lower)) {
    warnings.push(invalid("精算幅は 下限 < 上限 の時間で入れてください"));
    return {
      amount: base,
      formulaText: "",
      detail: prorateDetail,
      warnings,
      notes: [],
      settlement: {
        countedHours,
        base,
        lower: null,
        upper: null,
        excessUnitPrice: null,
        shortUnitPrice: null,
        adjustment: 0,
      },
    };
  }

  // 単価は日割り前の月額と精算幅で出す（日割りしても比は同じ）。精算幅は日割りで縮める
  let excessUnit: number;
  let shortUnit: number;
  let unitFormula: string;
  if (input.mode === "middle") {
    const mid = (upper + lower) / 2;
    excessUnit = floorToStep(P / mid, step);
    shortUnit = excessUnit;
    unitFormula = `超過・控除とも 1時間 ${en(excessUnit)}（月額 ÷ 精算幅の中間 ${num(mid)}時間、${stepText}）`;
  } else {
    excessUnit = floorToStep(P / upper, step);
    shortUnit = floorToStep(P / lower, step);
    unitFormula = `超過は 1時間 ${en(excessUnit)}（月額 ÷ 上限、${stepText}）、控除は 1時間 ${en(shortUnit)}（月額 ÷ 下限、${stepText}）`;
  }
  const lowerEff = (lower * ratioNum) / ratioDen;
  const upperEff = (upper * ratioNum) / ratioDen;
  // 分で比べる（整数に近い形で誤差を減らす）
  const lowerMin = (lower * 60 * ratioNum) / ratioDen;
  const upperMin = (upper * 60 * ratioNum) / ratioDen;
  let adjustment = 0;
  let adjustDetail = "精算幅の中なので精算なし";
  if (minutes > upperMin) {
    const overMin = minutes - upperMin;
    adjustment = roundYen((excessUnit * overMin) / 60, rounding);
    adjustDetail = `上限 ${num(upperEff)}時間を ${num(overMin / 60)}時間超過 → ${en(excessUnit)} × ${num(overMin / 60)}時間 = ${en(adjustment)}`;
  } else if (minutes < lowerMin) {
    const shortMin = lowerMin - minutes;
    adjustment = -roundYen((shortUnit * shortMin) / 60, rounding);
    adjustDetail = `下限 ${num(lowerEff)}時間に ${num(shortMin / 60)}時間不足 → ${en(shortUnit)} × ${num(shortMin / 60)}時間 = ${en(-adjustment)}を控除`;
  }
  const amount = Math.max(0, base + adjustment);
  return {
    amount,
    formulaText:
      `月額 ${en(P)}、精算幅 ${num(lower)}〜${num(upper)}時間（${SETTLEMENT_MODE_LABELS[input.mode]}）。` +
      `${unitFormula}。実働は${unitText}。${prorateText}`,
    detail: `${prorateDetail}、実働 ${num(countedHours)}時間：${adjustDetail} → ${en(amount)}`,
    warnings,
    notes: [],
    settlement: {
      countedHours,
      base,
      lower: lowerEff,
      upper: upperEff,
      excessUnitPrice: excessUnit,
      shortUnitPrice: shortUnit,
      adjustment,
    },
  };
}

/* ───────────── (f) しきい値つきの加算 ───────────── */

export type ThresholdInput = {
  /** 人数（回ごとに数えるなら配列） */
  counts: number | number[];
  /** 基準の人数（これを超えた分に加算） */
  base: number;
  unitPrice: number;
  countLabel?: string;
};

export function calcThreshold(input: ThresholdInput): ModelResult {
  const counts = Array.isArray(input.counts) ? input.counts : [input.counts];
  const base = Math.max(0, finite(input.base));
  const unitPrice = Math.max(0, finite(input.unitPrice));
  const label = input.countLabel ?? "人";
  const excess = counts.reduce((a, n) => a + Math.max(0, finite(n) - base), 0);
  const amount = roundYen(excess * unitPrice, "floor");
  const per = counts.length > 1 ? "回ごとに" : "";
  return {
    amount,
    formulaText: `${per}基準の${num(base)}${label}を超えた${label}数 × ${en(unitPrice)}`,
    detail: `超えた${label}数 ${num(excess)}${label} × ${en(unitPrice)} = ${en(amount)}`,
    warnings: counts.some((n) => !isFiniteNumber(n) || n < 0) ? [invalid("人数は0以上の数字で入れてください")] : [],
    notes: [],
  };
}

/* ───────────── 定額 ───────────── */

export type FixedInput = {
  amount: number;
  /** 何の定額か（月額・一式 など） */
  text?: string;
  /** 固定給のように働いた時間や勤怠と結びつく定額か（労働者性の注意を出す） */
  fixedSalaryLike?: boolean;
};

export function calcFixed(input: FixedInput): ModelResult {
  const amount = Math.floor(finite(input.amount));
  const text = input.text ?? "定額";
  const warnings: EngineWarning[] = [];
  if (amount < 0) warnings.push(invalid("定額は0以上で入れてください"));
  if (input.fixedSalaryLike) {
    warnings.push({
      code: "labor_risk_fixed_pay",
      level: "caution",
      message: `勤怠や時間と結びついた固定の支払は、給与に近く見えることがあります。${LABOR_RISK_TEXT}`,
    });
  }
  return { amount, formulaText: `${text} ${en(amount)}`, detail: `${text} ${en(amount)}`, warnings, notes: [] };
}

/* ───────────── 契約で決めた差し引き ───────────── */

export type ContractFeeInput = {
  mode: "fixed" | "rate";
  /** fixed のときの額（正の数で入れる。行はマイナスになる） */
  amount?: number;
  /** rate のときの元の額と率 */
  base?: number;
  rate?: number;
  /** 元の額の呼び方（委託料・技術売上 など） */
  baseLabel?: string;
  /** 取引条件の明示（契約書）に書いてあるか */
  agreedInWriting: boolean;
  /** 根拠（基本契約○条 など） */
  basis?: string;
  rounding?: Rounding;
};

export function calcContractFee(input: ContractFeeInput): ModelResult {
  const warnings: EngineWarning[] = [];
  const rounding = input.rounding ?? "floor";
  let value: number;
  let formula: string;
  let detail: string;
  if (input.mode === "rate") {
    const base = Math.max(0, finite(input.base));
    const rate = Math.max(0, finite(input.rate));
    value = roundYen(base * rate, rounding);
    const baseLabel = input.baseLabel ?? "元の額";
    formula = `${baseLabel} × ${percent(rate)}を差し引く（${ROUNDING_TEXT[rounding]}）`;
    detail = `${en(base)} × ${percent(rate)} = ${en(value)}を差し引く`;
  } else {
    value = Math.max(0, Math.floor(finite(input.amount)));
    formula = `${en(value)}を差し引く`;
    detail = formula;
  }
  if (input.basis) formula += `（根拠：${input.basis}）`;
  if (!input.agreedInWriting) {
    warnings.push({ code: "reduction_risk", level: "warning", message: REDUCTION_RISK_TEXT });
  }
  return { amount: -value, formulaText: formula, detail, warnings, notes: [] };
}

/* ───────────── 面貸しの精算 ───────────── */

export type ChairRentalInput = {
  /** サロンが預かった売上（その人のお客様の売上） */
  salesCollected: number;
  /** 場所代 */
  rent: { mode: "rate"; rate: number } | { mode: "fixed"; amount: number };
  /** 決済手数料（額か、売上に対する率） */
  cardFee?: { mode: "fixed"; amount: number } | { mode: "rate"; rate: number };
  /** サロンから買った材料 */
  materials?: number;
  rounding?: Rounding;
};

export const CHAIR_RENTAL_NOTE =
  "面貸しは報酬の支払ではなく、預かった売上の精算として別に計算しています（消費税・源泉徴収の計算に入れません）。" +
  "場所代はサロンの売上になります。フリーランス法の業務委託にあたるかは契約の形しだいで、この道具は判断しません。";

export function calcChairRental(input: ChairRentalInput): ModelResult {
  const rounding = input.rounding ?? "floor";
  const sales = Math.max(0, finite(input.salesCollected));
  const rent =
    input.rent.mode === "rate" ? roundYen(sales * finite(input.rent.rate), rounding) : Math.floor(finite(input.rent.amount));
  const fee = !input.cardFee
    ? 0
    : input.cardFee.mode === "rate"
      ? roundYen(sales * finite(input.cardFee.rate), rounding)
      : Math.floor(finite(input.cardFee.amount));
  const materials = Math.max(0, Math.floor(finite(input.materials)));
  const amount = sales - rent - fee - materials;
  const rentText = input.rent.mode === "rate" ? `預かった売上 × ${percent(input.rent.rate)}` : en(rent);
  const feeText = !input.cardFee ? "" : input.cardFee.mode === "rate" ? ` − 決済手数料（売上 × ${percent(input.cardFee.rate)}）` : " − 決済手数料";
  const parts = [`預かった売上 ${en(sales)}`, `場所代 ${en(rent)}`];
  if (fee) parts.push(`決済手数料 ${en(fee)}`);
  if (materials) parts.push(`材料 ${en(materials)}`);
  return {
    amount,
    formulaText: `預かった売上 − 場所代（${rentText}）${feeText}${materials ? " − サロンから買った材料" : ""}`,
    detail: `${parts.join(" − ")} = ${en(amount)}`,
    warnings: amount < 0 ? [invalid("精算額がマイナスです。場所代と手数料を確かめてください")] : [],
    notes: [CHAIR_RENTAL_NOTE],
  };
}

/* ───────────── 行の種類でまとめて呼ぶ ───────────── */

export type LineSpec =
  | { model: "unit"; input: UnitInput }
  | { model: "commission"; input: CommissionInput }
  | { model: "tiered"; input: TieredInput }
  | { model: "guarantee"; input: GuaranteeInput }
  | { model: "settlement"; input: SettlementInput }
  | { model: "threshold"; input: ThresholdInput }
  | { model: "fixed"; input: FixedInput }
  | { model: "contractFee"; input: ContractFeeInput }
  | { model: "chairRental"; input: ChairRentalInput };

export type PayModel = LineSpec["model"];

export const PAY_MODEL_LABELS: Record<PayModel, string> = {
  unit: "数量 × 単価",
  commission: "売上 × 率",
  tiered: "段階歩合",
  guarantee: "最低保証つきの歩合",
  settlement: "月額と精算幅",
  threshold: "基準を超えた人数の加算",
  fixed: "定額",
  contractFee: "契約で決めた差し引き",
  chairRental: "面貸しの精算",
};

/** 消費税の対象に入る行か（面貸しの精算は入れない） */
export function isTaxableModel(model: PayModel): boolean {
  return model !== "chairRental";
}

export function calcModel(spec: LineSpec): ModelResult {
  switch (spec.model) {
    case "unit":
      return calcUnit(spec.input);
    case "commission":
      return calcCommission(spec.input);
    case "tiered":
      return calcTiered(spec.input);
    case "guarantee":
      return calcGuarantee(spec.input);
    case "settlement":
      return calcSettlement(spec.input);
    case "threshold":
      return calcThreshold(spec.input);
    case "fixed":
      return calcFixed(spec.input);
    case "contractFee":
      return calcContractFee(spec.input);
    case "chairRental":
      return calcChairRental(spec.input);
  }
}
