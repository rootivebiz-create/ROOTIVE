/**
 * /tools/payout の入力の持ち方と、lib/engine への受け渡し（純関数。React にも画面にも依存しない）。
 *  - 見本（lib/engine/presets）→ 入力欄の文字（formFromSample）
 *  - 入力欄の文字 → buildPayout の入力（toPayoutInput。読めない数字は 0 として扱い、errors に入れる）
 *  - 取引条件明示書に書ける「算定方法」の文（methodText）
 *  - 経過措置の前後の負担（burdenRows。buildPayout を日付を変えて呼ぶだけ）
 * 金額・税額・率はここで計算しない（lib/engine と lib/payroll/tax の表に任せる）。
 */
import {
  PAY_MODEL_LABELS,
  calcModel,
  type CommissionInput,
  type PayModel,
  type SettlementInput,
  type SettlementMode,
  type Tier,
} from "@/lib/engine/payModels";
import { PRESET_IDS, getPreset, type IndustryPreset, type PresetId, type PresetSample } from "@/lib/engine/presets";
import {
  buildPayout,
  type DeductionKind,
  type OrderSideTaxMethod,
  type PaymentTerms,
  type PayoutInput,
  type PayoutLine,
  type PayoutResult,
} from "@/lib/engine/statement";
import { DEFAULT_CONSUMPTION_TAX_RATE, bpText, clean, en, isFiniteNumber, num, percent } from "@/lib/engine/types";
import {
  WITHHOLDING_CATEGORIES,
  WITHHOLDING_CATEGORY_ORDER,
  withholdingRateFor,
  type WithholdingCategory,
} from "@/lib/engine/withholding";
import { parseAmount } from "@/lib/payroll/money";
import { TRANSITIONAL_STEPS, monthEnd } from "@/lib/payroll/tax";
import { isDateString } from "@/lib/tools/torihiki-joken";

/* ───────────── 選択肢と説明 ───────────── */

export const DEFAULT_PRESET: PresetId = "trucking";

/** 行の計算の形（上の6つが主。下の3つは見本で使う） */
export const MODEL_ORDER: PayModel[] = [
  "unit",
  "commission",
  "tiered",
  "guarantee",
  "settlement",
  "threshold",
  "fixed",
  "contractFee",
  "chairRental",
];

export const MODEL_HINTS: Record<PayModel, string> = {
  unit: "個・日・コマ・字・ページ・点など、数 × 単価",
  commission: "売上の区分ごとに率を掛ける（歩合・印税など）",
  tiered: "売上の段階で率が変わる歩合",
  guarantee: "歩合と「保証の日額 × 日数」の多いほう",
  settlement: "月額と精算幅（上下割・中間割）、または時間単価",
  threshold: "参加人数などが基準を超えた分だけ加算",
  fixed: "月額・一式などの決まった額",
  contractFee: "管理費・ロイヤリティ・材料費など、契約で決めて報酬から差し引くもの",
  chairRental: "面貸し：預かった売上から場所代などを引いて返す精算（報酬ではない）",
};

export const WITHHOLDING_HELP = "原稿・写真・デザイン・講師料などは源泉徴収が必要なことが多い（最終判断は税理士へ）";

export const DEDUCTION_KIND_LABELS: Record<DeductionKind, string> = {
  fee: "使用料・手数料など",
  material: "材料・備品の代金",
  other: "その他",
  transfer_fee: "振込手数料",
  penalty: "罰金・ペナルティ",
};

export const DEDUCTION_KIND_ORDER: DeductionKind[] = ["fee", "material", "other", "transfer_fee", "penalty"];

export const ORDER_SIDE_METHODS: { value: OrderSideTaxMethod; label: string; note: string }[] = [
  { value: "general", label: "原則課税", note: "仕入れの消費税を、実際の額で差し引く" },
  { value: "simplified", label: "簡易課税・2割特例", note: "売上の消費税をもとに、決まった割合で計算する" },
  { value: "exempt", label: "免税事業者", note: "発注する側が消費税を納めていない" },
];

export const TIME_UNITS: { value: 1 | 15 | 30 | 60; label: string }[] = [
  { value: 1, label: "丸めない（1分単位）" },
  { value: 15, label: "15分単位（未満は切り捨て）" },
  { value: 30, label: "30分単位（未満は切り捨て）" },
  { value: 60, label: "1時間単位（未満は切り捨て）" },
];

export const PRICE_STEPS: { value: 1 | 10 | 100; label: string }[] = [
  { value: 1, label: "1円未満を切り捨て" },
  { value: 10, label: "10円未満を切り捨て" },
  { value: 100, label: "100円未満を切り捨て" },
];

/** 役務の提供を受けた月の選択肢（経過措置の表の最初の年から、最後の段階の翌年まで） */
export const YEAR_CHOICES: number[] = (() => {
  const first = Number(TRANSITIONAL_STEPS[0].from.slice(0, 4));
  const last = Number(TRANSITIONAL_STEPS[TRANSITIONAL_STEPS.length - 1].from.slice(0, 4)) + 1;
  return Array.from({ length: last - first + 1 }, (_, i) => first + i);
})();

/* ───────────── 入力の形（入力欄の文字のまま持つ） ───────────── */

export type CategoryForm = { id: number; label: string; sales: string; ratePct: string };
/** 最後の段階の upTo は使わない（上限なし） */
export type TierForm = { id: number; upTo: string; ratePct: string };

/** 1行ぶん。計算の形を切り替えても入れた値が残るよう、どの形の欄も持つ */
export type LineForm = {
  id: number;
  label: string;
  model: PayModel;
  withholding: WithholdingCategory;
  needsReview: boolean;
  // 数量 × 単価
  qty: string;
  unitRate: string;
  unitLabel: string;
  // 売上 × 率・最低保証
  categories: CategoryForm[];
  salesIncludeTax: boolean;
  rateAppliesTo: "excl" | "incl";
  dailyGuarantee: string;
  guaranteeDays: string;
  // 段階歩合
  tierSales: string;
  tierSalesLabel: string;
  tierMode: "slide" | "progressive";
  tiers: TierForm[];
  // 精算幅
  settleMode: SettlementMode;
  monthly: string;
  hourlyRate: string;
  lower: string;
  upper: string;
  actualHours: string;
  timeUnit: 1 | 15 | 30 | 60;
  priceStep: 1 | 10 | 100;
  prorate: boolean;
  workedDays: string;
  businessDays: string;
  // 人数の加算
  counts: string;
  countBase: string;
  countUnitPrice: string;
  countLabel: string;
  // 定額
  fixedAmount: string;
  fixedText: string;
  fixedSalaryLike: boolean;
  // 契約で決めた差し引き
  feeMode: "fixed" | "rate";
  feeAmount: string;
  /** 元の額を「上の行の報酬の合計」にする */
  feeBaseAuto: boolean;
  feeBase: string;
  feeRatePct: string;
  feeBaseLabel: string;
  feeAgreed: boolean;
  feeBasis: string;
  // 面貸しの精算
  chairSales: string;
  rentMode: "rate" | "fixed";
  rentRatePct: string;
  rentAmount: string;
  cardFeeMode: "none" | "fixed" | "rate";
  cardFeeAmount: string;
  cardFeeRatePct: string;
  materials: string;
};

export type PayeeForm = {
  name: string;
  invoiceRegistered: boolean;
  isCorporation: boolean;
  paysTaxOnTop: boolean;
  /** 請求書（支払明細）で消費税をはっきり分けて書くか。分けなければ源泉の元は税込 */
  taxShownSeparately: boolean;
};

export type ReimbursementForm = { id: number; label: string; amount: string; paidWithFee: boolean };

export type DeductionForm = { id: number; label: string; amount: string; kind: DeductionKind; agreed: boolean; basis: string };

export type TermsForm = {
  enabled: boolean;
  receivedOn: string;
  payOn: string;
  monthlyClosing: boolean;
  basedOnInvoiceReceipt: boolean;
};

export type PayoutForm = {
  presetId: PresetId;
  sampleId: string;
  payee: PayeeForm;
  lines: LineForm[];
  reimbursements: ReimbursementForm[];
  deductions: DeductionForm[];
  /** 役務の提供を受けた月（YYYY-MM）。経過措置の割合はこの月で決まる */
  serviceMonth: string;
  orderSideTaxMethod: OrderSideTaxMethod;
  terms: TermsForm;
  /** 外交員：同じ月に払う給与（固定の部分） */
  gaikoinSalary: string;
  /** 次に使う行の id */
  nextId: number;
};

/* ───────────── 文字と数の行き来 ───────────── */

const numberText = new Intl.NumberFormat("ja-JP", { maximumFractionDigits: 6 });

/** 42000 → "42,000"、186.5 → "186.5"。数でなければ空 */
export function toText(value: number | null | undefined): string {
  return isFiniteNumber(value) ? numberText.format(clean(value)) : "";
}

/** 0.45 → "45" */
export function pctText(rate: number | null | undefined): string {
  return isFiniteNumber(rate) ? numberText.format(clean(rate * 100)) : "";
}

/**
 * 入力欄の数字を読む。全角・カンマ・円・%・「万」を受け付ける。
 * 空なら null、読めなければ NaN。
 */
export function readNumber(text: string): number | null {
  const t = text.trim().replace(/[%％]$/, "").trim();
  if (t === "") return null;
  const man = t.match(/^(.+?)万円?$/);
  const value = parseAmount(man ? man[1] : t);
  if (value === null) return Number.NaN;
  return man ? clean(value * 10_000) : value;
}

/** "45" → 0.45（空は null、読めなければ NaN） */
export function readPercent(text: string): number | null {
  const v = readNumber(text);
  return v === null || Number.isNaN(v) ? v : clean(v / 100);
}

type Reader = {
  num: (text: string, what: string) => number;
  pct: (text: string, what: string) => number;
};

function makeReader(errors: string[]): Reader {
  const fail = (what: string) => {
    const message = `${what}を数字で入れてください`;
    if (!errors.includes(message)) errors.push(message);
  };
  const read = (v: number | null, what: string) => {
    if (v === null) return 0;
    if (Number.isNaN(v)) {
      fail(what);
      return 0;
    }
    return v;
  };
  return {
    num: (text, what) => read(readNumber(text), what),
    pct: (text, what) => read(readPercent(text), what),
  };
}

/* ───────────── 月 ───────────── */

export function isMonth(value: string): boolean {
  return /^\d{4}-(0[1-9]|1[0-2])$/.test(value);
}

/** "2026-12" → "2027-01" */
export function nextMonth(month: string): string {
  const [y, m] = month.split("-").map(Number);
  return m === 12 ? `${y + 1}-01` : `${y}-${String(m + 1).padStart(2, "0")}`;
}

/** 2026-10 → 2026年10月 */
export function monthText(month: string): string {
  const [y, m] = month.split("-").map(Number);
  return `${y}年${m}月`;
}

/* ───────────── 見本 → 入力欄 ───────────── */

/** URL の ?preset= を読む（知らない値は既定の軽貨物） */
export function parsePresetParam(value: string | string[] | undefined): PresetId {
  const v = Array.isArray(value) ? value[0] : value;
  return PRESET_IDS.find((id) => id === v) ?? DEFAULT_PRESET;
}

/** location.search（"?preset=beauty" など）から見本を読む。戻るボタンで戻ったときも、表示を URL に合わせるために使う */
export function presetFromSearch(search: string): PresetId {
  return parsePresetParam(new URLSearchParams(search).get("preset") ?? undefined);
}

/** 結果のまとめの「報酬」と「消費税」の行の見出しと注記（金額は buildPayout の結果をそのまま出す） */
export function summaryTaxRows(
  input: PayoutInput,
  result: PayoutResult,
): { feeLabel: string; feeNote?: string; taxLabel: string; taxNote: string } {
  if (!input.payee.paysTaxOnTop) {
    return {
      feeLabel: "報酬",
      feeNote: "消費税（相当額）を別に足さない総額",
      taxLabel: "消費税",
      taxNote: "上乗せしない",
    };
  }
  const rate = percent(input.taxRate ?? DEFAULT_CONSUMPTION_TAX_RATE);
  return {
    feeLabel: "報酬（税抜）",
    taxLabel: result.taxLabel ?? (input.payee.invoiceRegistered ? "消費税" : "消費税相当額"),
    taxNote:
      result.subtotal > 0
        ? `報酬（税抜）× ${rate}（1円未満切り捨て）`
        : `消費税をかける報酬がないので0円（報酬 × ${rate}）`,
  };
}

/** 報酬の行（差し引きと面貸しの精算を除く） */
export function isEarningModel(model: PayModel): boolean {
  return model !== "contractFee" && model !== "chairRental";
}

/** その業種で「数量 × 単価」の単位の既定（見本の最初の単位。無ければ「件」） */
export function defaultUnitLabel(preset: IndustryPreset): string {
  for (const sample of preset.samples) {
    for (const line of sample.input.lines) {
      if (line.model === "unit" && line.input.unitLabel) return line.input.unitLabel;
    }
  }
  return "件";
}

type Ids = () => number;

function counter(start: number): Ids {
  let n = start;
  return () => n++;
}

export function blankCategory(id: number): CategoryForm {
  return { id, label: "", sales: "", ratePct: "" };
}

export function blankTier(id: number): TierForm {
  return { id, upTo: "", ratePct: "" };
}

/** 新しく足す行。源泉の区分はその業種の既定 */
export function blankLine(preset: IndustryPreset, ids: Ids): LineForm {
  return {
    id: ids(),
    label: "",
    model: "unit",
    withholding: preset.defaultWithholding,
    needsReview: false,
    qty: "",
    unitRate: "",
    unitLabel: defaultUnitLabel(preset),
    categories: [{ ...blankCategory(ids()), label: "売上" }],
    salesIncludeTax: false,
    rateAppliesTo: "excl",
    dailyGuarantee: "",
    guaranteeDays: "",
    tierSales: "",
    tierSalesLabel: "売上",
    tierMode: "progressive",
    tiers: [blankTier(ids()), blankTier(ids())],
    settleMode: "updown",
    monthly: "",
    hourlyRate: "",
    lower: "",
    upper: "",
    actualHours: "",
    timeUnit: 1,
    priceStep: 1,
    prorate: false,
    workedDays: "",
    businessDays: "",
    counts: "",
    countBase: "",
    countUnitPrice: "",
    countLabel: "人",
    fixedAmount: "",
    fixedText: "月額",
    fixedSalaryLike: false,
    feeMode: "fixed",
    feeAmount: "",
    feeBaseAuto: true,
    feeBase: "",
    feeRatePct: "",
    feeBaseLabel: "",
    feeAgreed: false,
    feeBasis: "",
    chairSales: "",
    rentMode: "rate",
    rentRatePct: "",
    rentAmount: "",
    cardFeeMode: "none",
    cardFeeAmount: "",
    cardFeeRatePct: "",
    materials: "",
  };
}

function commissionFields(input: CommissionInput, ids: Ids): Partial<LineForm> {
  return {
    categories: input.categories.map((c) => ({ id: ids(), label: c.label, sales: toText(c.sales), ratePct: pctText(c.rate) })),
    salesIncludeTax: input.salesInputIncludesTax === true,
    rateAppliesTo: input.rateAppliesTo ?? (input.salesInputIncludesTax ? "incl" : "excl"),
  };
}

/** 見本の1行を入力欄にする。precedingTotal は、この行より上の報酬の行の合計（差し引きの元の額が自動か見分ける） */
function lineFromSpec(spec: PayoutLine, preset: IndustryPreset, ids: Ids, precedingTotal: number): LineForm {
  const line: LineForm = {
    ...blankLine(preset, ids),
    label: spec.label,
    model: spec.model,
    withholding: spec.withholding ?? "none",
    needsReview: spec.withholdingNeedsReview === true,
  };
  switch (spec.model) {
    case "unit":
      return {
        ...line,
        qty: toText(spec.input.qty),
        unitRate: toText(spec.input.rate),
        unitLabel: spec.input.unitLabel ?? line.unitLabel,
      };
    case "commission":
      return { ...line, ...commissionFields(spec.input, ids) };
    case "guarantee":
      return {
        ...line,
        ...commissionFields(spec.input.commission, ids),
        dailyGuarantee: toText(spec.input.dailyGuarantee),
        guaranteeDays: toText(spec.input.days),
      };
    case "tiered":
      return {
        ...line,
        tierSales: toText(spec.input.sales),
        tierSalesLabel: spec.input.salesLabel ?? "売上",
        tierMode: spec.input.mode,
        tiers: spec.input.tiers.map((t) => ({ id: ids(), upTo: t.upTo === null ? "" : toText(t.upTo), ratePct: pctText(t.rate) })),
      };
    case "settlement": {
      const s = spec.input;
      return {
        ...line,
        settleMode: s.mode,
        monthly: toText(s.monthly),
        hourlyRate: toText(s.hourlyRate),
        lower: toText(s.lower),
        upper: toText(s.upper),
        actualHours: toText(s.actualHours),
        timeUnit: s.timeUnitMinutes ?? 1,
        priceStep: s.unitPriceStep ?? 1,
        prorate: s.proration !== undefined,
        workedDays: toText(s.proration?.workedDays),
        businessDays: toText(s.proration?.businessDays),
      };
    }
    case "threshold": {
      const c = spec.input.counts;
      return {
        ...line,
        counts: Array.isArray(c) ? c.map((n) => String(n)).join("、") : String(c),
        countBase: toText(spec.input.base),
        countUnitPrice: toText(spec.input.unitPrice),
        countLabel: spec.input.countLabel ?? "人",
      };
    }
    case "fixed":
      return {
        ...line,
        fixedAmount: toText(spec.input.amount),
        fixedText: spec.input.text ?? "定額",
        fixedSalaryLike: spec.input.fixedSalaryLike === true,
      };
    case "contractFee": {
      const f = spec.input;
      return {
        ...line,
        feeMode: f.mode,
        feeAmount: toText(f.amount),
        feeBaseAuto: f.mode === "rate" && precedingTotal > 0 && f.base === precedingTotal,
        feeBase: toText(f.base),
        feeRatePct: pctText(f.rate),
        feeBaseLabel: f.baseLabel ?? "",
        feeAgreed: f.agreedInWriting,
        feeBasis: f.basis ?? "",
      };
    }
    case "chairRental": {
      const c = spec.input;
      return {
        ...line,
        chairSales: toText(c.salesCollected),
        rentMode: c.rent.mode,
        rentRatePct: c.rent.mode === "rate" ? pctText(c.rent.rate) : "",
        rentAmount: c.rent.mode === "fixed" ? toText(c.rent.amount) : "",
        cardFeeMode: c.cardFee ? c.cardFee.mode : "none",
        cardFeeAmount: c.cardFee?.mode === "fixed" ? toText(c.cardFee.amount) : "",
        cardFeeRatePct: c.cardFee?.mode === "rate" ? pctText(c.cardFee.rate) : "",
        materials: toText(c.materials),
      };
    }
  }
}

export function defaultTerms(serviceMonth: string): TermsForm {
  const ok = isMonth(serviceMonth);
  return {
    enabled: false,
    receivedOn: ok ? monthEnd(serviceMonth) : "",
    payOn: ok ? monthEnd(nextMonth(serviceMonth)) : "",
    monthlyClosing: true,
    basedOnInvoiceReceipt: false,
  };
}

/** 見本（架空）を入力欄に読み込む */
export function formFromSample(preset: IndustryPreset, sample: PresetSample): PayoutForm {
  const ids = counter(1);
  const input = sample.input;
  let running = 0;
  const lines = input.lines.map((spec) => {
    const line = lineFromSpec(spec, preset, ids, running);
    if (isEarningModel(spec.model)) running += calcModel(spec).amount;
    return line;
  });
  const serviceMonth = input.serviceDate.slice(0, 7);
  const terms: PaymentTerms | undefined = input.paymentTerms;
  return {
    presetId: preset.id,
    sampleId: sample.id,
    payee: {
      name: input.payee.name,
      invoiceRegistered: input.payee.invoiceRegistered,
      isCorporation: input.payee.isCorporation,
      paysTaxOnTop: input.payee.paysTaxOnTop,
      taxShownSeparately: input.taxShownSeparately ?? true,
    },
    lines,
    reimbursements: (input.reimbursements ?? []).map((r) => ({
      id: ids(),
      label: r.label,
      amount: toText(r.amount),
      paidWithFee: r.paidWithFee,
    })),
    deductions: (input.deductions ?? []).map((d) => ({
      id: ids(),
      label: d.label,
      amount: toText(d.amount),
      kind: d.kind ?? "other",
      agreed: d.agreedInWriting,
      basis: d.basis ?? "",
    })),
    serviceMonth,
    orderSideTaxMethod: input.orderSideTaxMethod,
    terms: terms
      ? {
          enabled: true,
          receivedOn: terms.receivedOn,
          payOn: terms.payOn,
          monthlyClosing: terms.monthlyClosing === true,
          basedOnInvoiceReceipt: terms.basedOnInvoiceReceipt === true,
        }
      : defaultTerms(serviceMonth),
    gaikoinSalary: toText(input.gaikoinMonthlySalary),
    nextId: ids(),
  };
}

/** その業種の見本（id が無ければ最初の見本） */
export function formForPreset(presetId: PresetId, sampleId?: string): PayoutForm {
  const preset = getPreset(presetId);
  const sample = preset.samples.find((s) => s.id === sampleId) ?? preset.samples[0];
  return formFromSample(preset, sample);
}

/**
 * 役務の提供を受けた月を変える。受け取った日・支払日が両方とも月から決めた既定（その月の末日・翌月末）のままなら、
 * いっしょに動かす。どちらかを自分で入れていたら、どちらも動かさない。
 */
export function withServiceMonth(form: PayoutForm, month: string): PayoutForm {
  if (!isMonth(form.serviceMonth) || !isMonth(month)) return { ...form, serviceMonth: month };
  const { receivedOn, payOn } = form.terms;
  const followsMonth = receivedOn === monthEnd(form.serviceMonth) && payOn === monthEnd(nextMonth(form.serviceMonth));
  if (!followsMonth) return { ...form, serviceMonth: month };
  return {
    ...form,
    serviceMonth: month,
    terms: { ...form.terms, receivedOn: monthEnd(month), payOn: monthEnd(nextMonth(month)) },
  };
}

/* ───────────── 入力欄 → buildPayout の入力 ───────────── */

function commissionOf(line: LineForm, r: Reader, at: (what: string) => string): CommissionInput {
  return {
    categories: line.categories.map((c, i) => {
      const name = c.label.trim() || `区分${i + 1}`;
      return { label: name, sales: r.num(c.sales, at(`${name}の売上`)), rate: r.pct(c.ratePct, at(`${name}の率`)) };
    }),
    salesInputIncludesTax: line.salesIncludeTax,
    rateAppliesTo: line.rateAppliesTo,
  };
}

function lineToSpec(line: LineForm, index: number, r: Reader, precedingTotal: number): PayoutLine {
  const name = line.label.trim() || `${index + 1}行目`;
  const at = (what: string) => `「${name}」の${what}`;
  const earning = isEarningModel(line.model);
  const base = {
    label: line.label.trim() || PAY_MODEL_LABELS[line.model],
    // 差し引きと面貸しの精算は源泉の元に入れない（区分を持たせない）
    withholding: earning ? line.withholding : ("none" as WithholdingCategory),
    withholdingNeedsReview: earning && line.needsReview,
  };
  switch (line.model) {
    case "unit":
      return {
        ...base,
        model: "unit",
        input: { qty: r.num(line.qty, at("数量")), rate: r.num(line.unitRate, at("単価")), unitLabel: line.unitLabel.trim() || "単位" },
      };
    case "commission":
      return { ...base, model: "commission", input: commissionOf(line, r, at) };
    case "guarantee":
      return {
        ...base,
        model: "guarantee",
        input: {
          commission: commissionOf(line, r, at),
          dailyGuarantee: r.num(line.dailyGuarantee, at("保証の日額")),
          days: r.num(line.guaranteeDays, at("稼働日数")),
        },
      };
    case "tiered": {
      const last = line.tiers.length - 1;
      const tiers: Tier[] = line.tiers.map((t, i) => ({
        upTo: i === last ? null : r.num(t.upTo, at(`段階${i + 1}の上限`)),
        rate: r.pct(t.ratePct, at(`段階${i + 1}の率`)),
      }));
      return {
        ...base,
        model: "tiered",
        input: {
          sales: r.num(line.tierSales, at("売上")),
          salesLabel: line.tierSalesLabel.trim() || "売上",
          mode: line.tierMode,
          tiers,
        },
      };
    }
    case "settlement": {
      const mode = line.settleMode;
      const input: SettlementInput = {
        mode,
        actualHours: mode === "fixed" ? 0 : r.num(line.actualHours, at("実働時間")),
        timeUnitMinutes: line.timeUnit,
      };
      if (mode === "hourly") input.hourlyRate = r.num(line.hourlyRate, at("時間単価"));
      else input.monthly = r.num(line.monthly, at("月額"));
      if (mode === "updown" || mode === "middle") {
        input.lower = r.num(line.lower, at("精算幅の下限"));
        input.upper = r.num(line.upper, at("精算幅の上限"));
        input.unitPriceStep = line.priceStep;
      }
      if (mode !== "hourly" && line.prorate) {
        input.proration = {
          workedDays: r.num(line.workedDays, at("稼働した営業日")),
          businessDays: r.num(line.businessDays, at("その月の営業日")),
        };
      }
      return { ...base, model: "settlement", input };
    }
    case "threshold": {
      const parts = line.counts.split(/[\s,，、・]+/).filter(Boolean);
      const counts = parts.map((p, i) => r.num(p, at(parts.length > 1 ? `人数（${i + 1}つ目）` : "人数")));
      return {
        ...base,
        model: "threshold",
        input: {
          counts: counts.length === 1 ? counts[0] : counts.length === 0 ? 0 : counts,
          base: r.num(line.countBase, at("基準の人数")),
          unitPrice: r.num(line.countUnitPrice, at("加算の単価")),
          countLabel: line.countLabel.trim() || "人",
        },
      };
    }
    case "fixed":
      return {
        ...base,
        model: "fixed",
        input: {
          amount: r.num(line.fixedAmount, at("金額")),
          text: line.fixedText.trim() || "定額",
          fixedSalaryLike: line.fixedSalaryLike,
        },
      };
    case "contractFee": {
      const basis = line.feeBasis.trim() || undefined;
      if (line.feeMode === "rate") {
        return {
          ...base,
          model: "contractFee",
          input: {
            mode: "rate",
            base: line.feeBaseAuto ? precedingTotal : r.num(line.feeBase, at("元の額")),
            rate: r.pct(line.feeRatePct, at("率")),
            baseLabel: line.feeBaseLabel.trim() || (line.feeBaseAuto ? "報酬" : undefined),
            agreedInWriting: line.feeAgreed,
            basis,
          },
        };
      }
      return {
        ...base,
        model: "contractFee",
        input: { mode: "fixed", amount: r.num(line.feeAmount, at("金額")), agreedInWriting: line.feeAgreed, basis },
      };
    }
    case "chairRental":
      return {
        ...base,
        model: "chairRental",
        input: {
          salesCollected: r.num(line.chairSales, at("預かった売上")),
          rent:
            line.rentMode === "rate"
              ? { mode: "rate", rate: r.pct(line.rentRatePct, at("場所代の率")) }
              : { mode: "fixed", amount: r.num(line.rentAmount, at("場所代")) },
          cardFee:
            line.cardFeeMode === "none"
              ? undefined
              : line.cardFeeMode === "rate"
                ? { mode: "rate", rate: r.pct(line.cardFeeRatePct, at("決済手数料の率")) }
                : { mode: "fixed", amount: r.num(line.cardFeeAmount, at("決済手数料")) },
          materials: r.num(line.materials, at("材料")),
        },
      };
  }
}

/** 入力欄から buildPayout の入力を作る。読めない数字は 0 として計算し、errors に入れる */
export function toPayoutInput(form: PayoutForm): { input: PayoutInput; errors: string[] } {
  const errors: string[] = [];
  const r = makeReader(errors);

  const lines: PayoutLine[] = [];
  let running = 0;
  form.lines.forEach((line, i) => {
    const spec = lineToSpec(line, i, r, running);
    lines.push(spec);
    if (isEarningModel(spec.model)) running += calcModel(spec).amount;
  });

  const reimbursements = form.reimbursements.map((x, i) => {
    const label = x.label.trim() || `立替${i + 1}`;
    return { label, amount: r.num(x.amount, `「${label}」の額`), paidWithFee: x.paidWithFee };
  });
  const deductions = form.deductions.map((x, i) => {
    const label = x.label.trim() || `控除${i + 1}`;
    return {
      label,
      amount: r.num(x.amount, `「${label}」の額`),
      agreedInWriting: x.agreed,
      basis: x.basis.trim() || undefined,
      kind: x.kind,
    };
  });

  let serviceDate: string;
  if (isMonth(form.serviceMonth)) {
    serviceDate = monthEnd(form.serviceMonth);
  } else {
    errors.push("役務の提供を受けた月を選んでください");
    serviceDate = getPreset(form.presetId).serviceDate;
  }

  let paymentTerms: PaymentTerms | undefined;
  if (form.terms.enabled) {
    if (isDateString(form.terms.receivedOn) && isDateString(form.terms.payOn)) {
      paymentTerms = {
        receivedOn: form.terms.receivedOn,
        payOn: form.terms.payOn,
        monthlyClosing: form.terms.monthlyClosing,
        basedOnInvoiceReceipt: form.terms.basedOnInvoiceReceipt,
      };
    } else {
      errors.push("給付を受け取った日と支払日を、日付で入れてください");
    }
  }

  const hasGaikoin = lines.some((l) => l.withholding === "ko4_gaikoin");

  const input: PayoutInput = {
    payee: {
      name: form.payee.name.trim() || "支払先",
      invoiceRegistered: form.payee.invoiceRegistered,
      isCorporation: form.payee.isCorporation,
      paysTaxOnTop: form.payee.paysTaxOnTop,
    },
    lines,
    reimbursements,
    deductions,
    serviceDate,
    orderSideTaxMethod: form.orderSideTaxMethod,
    taxShownSeparately: form.payee.taxShownSeparately,
    gaikoinMonthlySalary: hasGaikoin ? r.num(form.gaikoinSalary, "外交員に同じ月に払う給与") : undefined,
    paymentTerms,
  };
  return { input, errors };
}

/* ───────────── 算定方法の文（取引条件明示書に書ける形） ───────────── */

const BASE_RULE_METHOD: Record<PayoutResult["withholdingRule"], string> = {
  excl_tax_separated: "請求書等で消費税を分けて書くので、税抜の報酬の額にかける",
  incl_tax: "消費税を含めた額にかける",
  no_tax_added: "支払う報酬の額にかける",
};

/**
 * 取引条件明示書の「報酬の額（算定方法）」に貼れる文。今月の数字は入れない（式と率だけ）。
 * 源泉の率は支払日（無ければ役務の提供を受けた日）の表から引く。罰金・振込手数料の差し引きは文に入れない。
 */
export function methodText(input: PayoutInput, result: PayoutResult): string {
  const out: string[] = [];
  const earning = result.lines.filter((l) => l.taxable);
  const settlements = result.lines.filter((l) => !l.taxable);

  if (earning.length > 0) {
    out.push("■ 報酬の額（算定方法）");
    for (const l of earning) out.push(`・${l.label}：${l.formulaText || "（入力を確かめてください）"}`);
  }
  if (settlements.length > 0) {
    out.push("■ 精算（報酬の支払ではない）");
    for (const l of settlements) out.push(`・${l.label}：${l.formulaText || "（入力を確かめてください）"}`);
  }

  if (earning.length > 0) {
    const rate = percent(input.taxRate ?? DEFAULT_CONSUMPTION_TAX_RATE);
    const rounding = !input.taxRounding || input.taxRounding === "floor" ? "1円未満切り捨て" : "端数は別に定める";
    out.push(
      input.payee.paysTaxOnTop
        ? `■ 消費税：上記の報酬（税抜）に、${input.payee.invoiceRegistered ? "消費税" : "消費税相当額"}（${rate}。${rounding}）を加えて支払う`
        : "■ 消費税：上記の報酬は消費税（相当額）を含む総額とし、別に加えない",
    );
  }

  const categories = WITHHOLDING_CATEGORY_ORDER.filter((c) => c !== "none" && earning.some((l) => l.withholding === c));
  if (categories.length > 0 && !input.payee.isCorporation) {
    const rate = withholdingRateFor(input.paymentTerms?.payOn ?? input.serviceDate);
    const basic = bpText(rate.basicBp);
    const parts = categories.map((c) => {
      const info = WITHHOLDING_CATEGORIES[c];
      const names = earning
        .filter((l) => l.withholding === c)
        .map((l) => l.label)
        .join("・");
      let how: string;
      if (info.method === "two_tier") {
        how = `1回の支払ごとに、この区分の合計 × ${basic}（${num(rate.stepThreshold / 10_000)}万円を超える部分は ${bpText(rate.upperBp)}）`;
      } else if (info.method === "minus_10000") {
        how = `（1回の支払額 − ${en(rate.shihoshoshiDeduction)}）× ${basic}`;
      } else {
        how = `（その月の報酬 − ${en(rate.gaikoinMonthlyDeduction)}。同じ月に給与を払うときは、${en(rate.gaikoinMonthlyDeduction)}から給与を引いた額を引く）× ${basic}`;
      }
      return `${names}（${info.short}）は、${how}`;
    });
    const extras: string[] = [BASE_RULE_METHOD[result.withholdingRule]];
    if (result.reimbursementsPaid > 0) extras.push("報酬と一緒に支払う交通費などを含める");
    if (result.lines.some((l) => l.model === "contractFee")) extras.push("契約で決めた差し引きの前の額にかける");
    out.push(`■ 源泉徴収税額：${parts.join("／")}。1円未満切り捨て。${extras.join("。")}`);
  }

  const reimbursements = (input.reimbursements ?? []).filter((r) => r.amount >= 0);
  if (reimbursements.length > 0) {
    out.push(
      `■ 立替：${reimbursements.map((r) => `${r.label}は${r.paidWithFee ? "実費を報酬と一緒に支払う" : "発注者が直接支払う"}`).join("、")}`,
    );
  }

  const deductions = input.deductions ?? [];
  const listed = deductions.filter((d) => d.amount >= 0 && d.kind !== "penalty" && d.kind !== "transfer_fee");
  if (listed.length > 0) {
    out.push(
      `■ 報酬から差し引くもの：${listed.map((d) => `${d.label} ${en(d.amount)}${d.basis ? `（根拠：${d.basis}）` : ""}`).join("、")}`,
    );
  }
  if (deductions.some((d) => d.kind === "penalty" || d.kind === "transfer_fee")) {
    out.push("（罰金・振込手数料の差し引きは、この文に入れていません）");
  }
  return out.join("\n");
}

/* ───────────── 経過措置の前後 ───────────── */

export type BurdenRow = {
  from: string;
  to: string | null;
  /** 控除できる割合 */
  rate: number;
  /** 原則課税のときに発注する側が負担する消費税 */
  burden: number;
  current: boolean;
};

/**
 * 役務の提供を受けた日の段階と、その前後の段階で、原則課税なら負担がいくらかを並べる。
 * 計算は buildPayout に日付を変えて渡すだけ（割合は lib/payroll/tax の表）。
 */
export function burdenRows(input: PayoutInput): BurdenRow[] {
  const index = TRANSITIONAL_STEPS.findIndex(
    (s) => input.serviceDate >= s.from && (s.to === null || input.serviceDate <= s.to),
  );
  if (index < 0) return [];
  return [index - 1, index, index + 1]
    .filter((i) => i >= 0 && i < TRANSITIONAL_STEPS.length)
    .map((i) => {
      const step = TRANSITIONAL_STEPS[i];
      const r = buildPayout({ ...input, serviceDate: step.from, orderSideTaxMethod: "general", paymentTerms: undefined });
      return { from: step.from, to: step.to, rate: step.rate, burden: r.invoiceBurden, current: i === index };
    });
}
