/**
 * 報酬・料金の源泉徴収（所得税法204条1項）の計算。純関数。
 *
 * - 金額は整数の円、率は万分率の整数（10.21% = 1021）で持ち、浮動小数を使わない。
 *   税額 = floor(元 × 1021 / 10000)。1円未満は切り捨て（四捨五入しない）。
 * - 100万円の段階（20.42%）は「同一人に対する1回の支払」で、源泉の区分が同じ行を合計した額に当てる。
 *   年の合計にも、行ごとにも当てない（calcPaymentWithholding がまとめる）。
 * - 司法書士・土地家屋調査士・海事代理士、外交員には20.42%の段階は無い。
 * - 4号のうちモデル料など（外交員を除く）は、1号と同じ出し方（10.21%、1回の支払で100万円を超える部分は20.42%。控除額なし）。
 * - 支払先が法人なら、区分にかかわらず0（ここで扱うのは個人に払う報酬の源泉）。
 * - 元は原則として消費税を含めた額。請求書等で消費税がはっきり分けて書いてあれば、報酬の額だけでよい。
 *
 * 出典（2026年9月時点）：国税庁 No.2792・No.2795・No.2798・No.2801・No.2804・No.2810・No.7431、
 * 『復興特別所得税（源泉徴収関係）Q&A』、『インボイス制度開始後の報酬・料金等に対する源泉徴収』。
 * 区分の最終判断は税理士へ（この道具は個別の税務判断をしない）。
 */
import { bpText, en, num } from "./types";

export type WithholdingCategory = "none" | "ko1" | "ko2_shigyo" | "ko2_shihoshoshi" | "ko4_standard" | "ko4_gaikoin";

export const WITHHOLDING_CATEGORY_ORDER: WithholdingCategory[] = [
  "none",
  "ko1",
  "ko2_shigyo",
  "ko2_shihoshoshi",
  "ko4_standard",
  "ko4_gaikoin",
];

export type WithholdingCategoryInfo = {
  label: string;
  /** 明細などで使う短い名前 */
  short: string;
  examples: string;
  /** 税額の出し方 */
  method: "none" | "two_tier" | "minus_10000" | "gaikoin";
  /** 支払調書を出す対象になる年の支払の合計（これを「超えたら」）。無ければ null */
  paymentReportOver: number | null;
};

export const WITHHOLDING_CATEGORIES: Record<WithholdingCategory, WithholdingCategoryInfo> = {
  none: {
    label: "源泉徴収なし",
    short: "なし",
    examples: "運送・システム開発・美容の施術など、所得税法204条1項に挙げられていない報酬",
    method: "none",
    paymentReportOver: null,
  },
  ko1: {
    label: "1号（原稿・写真・挿絵・デザイン・翻訳・講演・教授料・印税など）",
    short: "1号",
    examples: "原稿料・撮影料・挿絵料・デザイン料・翻訳料・講演料・技芸やスポーツや知識の教授料・著作権の使用料（印税）",
    method: "two_tier",
    paymentReportOver: 50_000,
  },
  ko2_shigyo: {
    label: "2号（弁護士・税理士・建築士・測量士など）",
    short: "2号",
    examples: "弁護士・税理士・社会保険労務士・建築士・測量士などへの報酬",
    method: "two_tier",
    paymentReportOver: 50_000,
  },
  ko2_shihoshoshi: {
    label: "2号（司法書士・土地家屋調査士・海事代理士）",
    short: "2号（司法書士など）",
    examples: "司法書士・土地家屋調査士・海事代理士への報酬",
    method: "minus_10000",
    paymentReportOver: 50_000,
  },
  ko4_standard: {
    label: "4号（モデル料など）",
    short: "4号（モデル料）",
    examples: "ヘアモデル・広告のモデルなどへのモデル料（所得税法204条1項4号。税額の出し方は1号と同じで、12万円の控除は無い）",
    method: "two_tier",
    paymentReportOver: 50_000,
  },
  ko4_gaikoin: {
    label: "4号（外交員）",
    short: "4号（外交員）",
    examples: "外交員・集金人などへの報酬（外交員にあたるかは契約しだいで、個別の判断が要る）",
    method: "gaikoin",
    paymentReportOver: 500_000,
  },
};

/**
 * 源泉の税率の表（効力の始まる日つき）。コードに率を直書きしない。
 * 2027年1月から防衛特別所得税（1%）が加わり、復興特別所得税は1.1%に下がる改正は成立済み（令和8年度改正）。
 * 源泉徴収の合計の率は10.21%のまま変わらない見込み（合計の率は見込みとしてデータで持つ。status = "expected"）。
 * 出典：国税庁「防衛特別所得税及び復興特別所得税の源泉徴収のあらまし」
 * https://www.nta.go.jp/publication/pamph/pdf/0026005-024_02.pdf
 */
export type WithholdingRateRow = {
  from: string;
  to: string | null;
  /** 基本の税率（万分率。1021 = 10.21%） */
  basicBp: number;
  /** 100万円を超える部分の税率（万分率） */
  upperBp: number;
  /** 段階の境目（1回の支払） */
  stepThreshold: number;
  /** 司法書士・土地家屋調査士・海事代理士の控除額（1回の支払） */
  shihoshoshiDeduction: number;
  /** 外交員の控除額（1か月） */
  gaikoinMonthlyDeduction: number;
  status: "enacted" | "expected";
  note: string;
};

export const WITHHOLDING_RATES: WithholdingRateRow[] = [
  {
    from: "2013-01-01",
    to: "2026-12-31",
    basicBp: 1021,
    upperBp: 2042,
    stepThreshold: 1_000_000,
    shihoshoshiDeduction: 10_000,
    gaikoinMonthlyDeduction: 120_000,
    status: "enacted",
    note: "所得税10%（100万円を超える部分は20%）＋ 復興特別所得税（所得税の2.1%）",
  },
  {
    from: "2027-01-01",
    to: null,
    basicBp: 1021,
    upperBp: 2042,
    stepThreshold: 1_000_000,
    shihoshoshiDeduction: 10_000,
    gaikoinMonthlyDeduction: 120_000,
    status: "expected",
    note: "2027年1月から防衛特別所得税（1%）が加わり、復興特別所得税は1.1%に下がる（改正は成立済み。令和8年度改正）。源泉徴収の合計の率は10.21%のまま変わらない見込み",
  },
];

/** 支払日（YYYY-MM-DD）の税率の行。省略したときや表より前の日は、施行済みの最初の行 */
export function withholdingRateFor(date?: string): WithholdingRateRow {
  if (date) {
    for (const row of WITHHOLDING_RATES) {
      if (date >= row.from && (row.to === null || date <= row.to)) return row;
    }
  }
  return WITHHOLDING_RATES.find((row) => row.status === "enacted") ?? WITHHOLDING_RATES[0];
}

/** floor(amount × bp / 10000)。整数の割り算で、1円未満は切り捨て */
export function applyBp(amount: number, bp: number): number {
  return Math.floor((amount * bp) / 10_000);
}

export type WithholdingOptions = {
  /** 支払先が法人なら 0 */
  payeeIsCorporation?: boolean;
  /** 外交員：同じ月に払う給与（固定の部分）。控除額 = max(0, 12万円 − 給与) */
  monthlySalaryForGaikoin?: number;
  /** 外交員：計算期間の月数（既定 1）。控除額は12万円 × 月数 */
  gaikoinMonths?: number;
  /** 支払日（税率の表を引く）。省略すると施行済みの率 */
  date?: string;
};

export type WithholdingStep = {
  label: string;
  /** その段階にかかる額 */
  amount: number;
  bp: number;
  tax: number;
};

export type WithholdingResult = {
  category: WithholdingCategory;
  /** 源泉の元（1回の支払で、この区分の行の合計） */
  base: number;
  /** 控除額（司法書士の1万円・外交員の12万円 − 給与）。無ければ 0 */
  deduction: number;
  tax: number;
  steps: WithholdingStep[];
  /** 「84,000円 × 10.21% = 8,576円（1円未満切り捨て）」 */
  formulaText: string;
  /** 税額が 0 になった理由（法人・区分なしなど） */
  zeroReason: string | null;
};

function toBase(value: number): number {
  if (!Number.isFinite(value) || value <= 0) return 0;
  return Math.floor(value);
}

/**
 * 1回の支払・1つの区分の源泉税。base はその区分の行の合計（税抜か税込かは呼ぶ側で決める）。
 */
export function calcWithholding(
  category: WithholdingCategory,
  base: number,
  opts: WithholdingOptions = {},
): WithholdingResult {
  const A = toBase(base);
  const rate = withholdingRateFor(opts.date);
  const info = WITHHOLDING_CATEGORIES[category];
  const zero = (reason: string): WithholdingResult => ({
    category,
    base: A,
    deduction: 0,
    tax: 0,
    steps: [],
    formulaText: reason,
    zeroReason: reason,
  });

  if (info.method === "none") return zero("源泉徴収の対象として挙げられていない報酬なので、源泉徴収はしません");
  if (opts.payeeIsCorporation) return zero("支払先が法人なので、源泉徴収はしません");
  if (A === 0) return zero("源泉の元が0円なので、源泉税も0円です");

  const basic = bpText(rate.basicBp);

  if (info.method === "two_tier") {
    const T = rate.stepThreshold;
    if (A <= T) {
      const tax = applyBp(A, rate.basicBp);
      return {
        category,
        base: A,
        deduction: 0,
        tax,
        steps: [{ label: `${basic}`, amount: A, bp: rate.basicBp, tax }],
        formulaText: `${en(A)} × ${basic} = ${en(tax)}（1円未満切り捨て）`,
        zeroReason: null,
      };
    }
    const lowTax = applyBp(T, rate.basicBp);
    const over = A - T;
    const highTax = applyBp(over, rate.upperBp);
    const upper = bpText(rate.upperBp);
    const tax = highTax + lowTax;
    return {
      category,
      base: A,
      deduction: 0,
      tax,
      steps: [
        { label: `${num(T / 10_000)}万円までの部分 ${basic}`, amount: T, bp: rate.basicBp, tax: lowTax },
        { label: `${num(T / 10_000)}万円を超える部分 ${upper}`, amount: over, bp: rate.upperBp, tax: highTax },
      ],
      formulaText:
        `（${en(A)} − ${en(T)}）× ${upper} ＋ ${en(lowTax)} = ${en(tax)}` +
        `（1回の支払で${num(T / 10_000)}万円を超える部分だけ${upper}。1円未満切り捨て）`,
      zeroReason: null,
    };
  }

  if (info.method === "minus_10000") {
    const D = rate.shihoshoshiDeduction;
    const taxable = Math.max(0, A - D);
    const tax = applyBp(taxable, rate.basicBp);
    return {
      category,
      base: A,
      deduction: Math.min(A, D),
      tax,
      steps: taxable > 0 ? [{ label: basic, amount: taxable, bp: rate.basicBp, tax }] : [],
      formulaText: `（${en(A)} − ${en(D)}）× ${basic} = ${en(tax)}（1回の支払から${en(D)}を引く。1円未満切り捨て）`,
      zeroReason: taxable > 0 ? null : `1回の支払が${en(D)}以下なので、源泉税は0円です`,
    };
  }

  // 外交員
  const months = opts.gaikoinMonths && opts.gaikoinMonths > 0 ? opts.gaikoinMonths : 1;
  const allowance = rate.gaikoinMonthlyDeduction * months;
  const salary = toBase(opts.monthlySalaryForGaikoin ?? 0);
  const D = Math.max(0, allowance - salary);
  const taxable = Math.max(0, A - D);
  const tax = applyBp(taxable, rate.basicBp);
  const deductionText =
    salary > 0 ? `控除額（${en(allowance)} − 給与 ${en(salary)}）${en(D)}` : `控除額 ${en(D)}`;
  return {
    category,
    base: A,
    deduction: Math.min(A, D),
    tax,
    steps: taxable > 0 ? [{ label: basic, amount: taxable, bp: rate.basicBp, tax }] : [],
    formulaText: `（${en(A)} − ${deductionText}）× ${basic} = ${en(tax)}（1円未満切り捨て）`,
    zeroReason: taxable > 0 ? null : "報酬が控除額以下なので、源泉税は0円です",
  };
}

/* ───────────── 源泉の元（税抜か税込か） ───────────── */

/**
 * excl_tax_separated：消費税がはっきり分けて書いてあるので税抜の額
 * incl_tax：分けて書かれていない（分からない）ので税込の額（原則）
 * no_tax_added：消費税（相当額）を上乗せしていないので、支払う報酬の額がそのまま元（税抜・税込の区別が無い）
 */
export type WithholdingBaseRule = "excl_tax_separated" | "incl_tax" | "no_tax_added";

export const BASE_RULE_LABELS: Record<WithholdingBaseRule, string> = {
  excl_tax_separated: "税抜の額（請求書等で消費税がはっきり分けて書いてあるため）",
  incl_tax: "税込の額（消費税が分けて書かれていないため。原則の扱い）",
  no_tax_added: "支払う報酬の額（消費税・消費税相当額を上乗せしていないため、支払う額がそのまま元）",
};

/**
 * 源泉の元の決め方。原則は税込。請求書等で消費税がはっきり分けて書いてあるときだけ税抜でよい。
 * 分けて書いてあるかが分からない（未指定）なら、税込として扱う。
 */
export function withholdingBaseRule(taxShownSeparately: boolean | undefined): Exclude<WithholdingBaseRule, "no_tax_added"> {
  return taxShownSeparately === true ? "excl_tax_separated" : "incl_tax";
}

/* ───────────── 1回の支払のまとめ ───────────── */

export type WithholdingItem = {
  category: WithholdingCategory;
  /** 税抜の額（立替は不課税の額） */
  amount: number;
  /** この項目にかかる消費税（相当額）。税込を元にするときに足す */
  tax?: number;
};

export type WithholdingGroup = WithholdingResult & {
  /** 税抜の合計 */
  amountExclTax: number;
  /** 元に足した消費税（税込を元にするとき） */
  taxIncluded: number;
};

export type PaymentWithholding = {
  rule: Exclude<WithholdingBaseRule, "no_tax_added">;
  groups: WithholdingGroup[];
  /** 区分の元の合計（none を除く） */
  base: number;
  tax: number;
};

/**
 * 同一人に対する1回の支払で、区分が同じ項目を合計してから税額を出す（100万円の段階は合計に当てる）。
 * none の項目は groups に入れない。
 */
export function calcPaymentWithholding(
  items: WithholdingItem[],
  opts: WithholdingOptions & { taxShownSeparately?: boolean } = {},
): PaymentWithholding {
  const rule = withholdingBaseRule(opts.taxShownSeparately);
  const sums = new Map<WithholdingCategory, { amount: number; tax: number }>();
  for (const item of items) {
    if (item.category === "none") continue;
    const s = sums.get(item.category) ?? { amount: 0, tax: 0 };
    s.amount += Math.floor(item.amount);
    s.tax += Math.floor(item.tax ?? 0);
    sums.set(item.category, s);
  }
  const groups: WithholdingGroup[] = [];
  for (const category of WITHHOLDING_CATEGORY_ORDER) {
    const s = sums.get(category);
    if (!s) continue;
    const taxIncluded = rule === "incl_tax" ? s.tax : 0;
    const result = calcWithholding(category, s.amount + taxIncluded, opts);
    groups.push({ ...result, amountExclTax: s.amount, taxIncluded });
  }
  return {
    rule,
    groups,
    base: groups.reduce((a, g) => a + g.base, 0),
    tax: groups.reduce((a, g) => a + g.tax, 0),
  };
}

/* ───────────── 支払調書・納付 ───────────── */

/**
 * 同じ人への年の支払の合計が基準を超えたら、支払調書（翌年1月31日まで）の対象。
 * 1号・2号・4号のモデル料などは5万円超、外交員は50万円超（国税庁 No.7431）。
 */
export function paymentReportRequired(category: WithholdingCategory, annualTotal: number): boolean {
  const over = WITHHOLDING_CATEGORIES[category].paymentReportOver;
  return over !== null && annualTotal > over;
}

/**
 * 源泉税の納付期限（支払った月の翌月10日）。土日祝日なら翌営業日になる（ここでは動かさない）。
 * 納期の特例（半年ごと）は給与や2号の士業の報酬などだけで、1号の原稿料・デザイン料・教授料は対象外。
 */
export function withholdingPaymentDue(payDate: string): string {
  const [y, m] = payDate.split("-").map(Number);
  const ny = m === 12 ? y + 1 : y;
  const nm = m === 12 ? 1 : m + 1;
  return `${ny}-${String(nm).padStart(2, "0")}-10`;
}
