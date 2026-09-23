/**
 * 1人・1回の支払の明細を組み立てる純関数（業種をまたいで使う）。
 *
 * 計算の順序（この順を変えない）：
 *   1. 税抜の報酬（行ごとに支払の形で計算して合計。契約で決めた差し引きはマイナスの行）
 *   2. 消費税（登録済みの方には消費税、免税の方には上乗せするなら消費税相当額）
 *   3. 源泉の元（区分ごとに合計。消費税がはっきり分けて書いてあれば税抜、そうでなければ税込。
 *      報酬と一緒に払う交通費などの立替は元に入る。発注者が直接払ったものは入らない）
 *   4. 源泉税（同一人に対する1回の支払で、区分が同じ行の合計に100万円の段階を当てる）
 *   5. 相殺・合意した控除（源泉の元は減らさない。契約で決めた差し引き（contractFee の行）も源泉の元からは引かない）
 *   6. 振込額 = 税抜の報酬 + 消費税 + 精算 + 報酬と一緒に払う立替 − 源泉税 − 控除
 *
 * 労働者性・偽装請負は判定しない（注意だけ出す）。免税の方への支払を下げるよう勧めない。
 */
import { jpDate } from "@/lib/format";
import { roundYen } from "@/lib/payroll/money";
import { deductibleRateForExempt, nonDeductibleTax } from "@/lib/payroll/tax";
import { addDays, dayInMonth, daysInMonth, sixtyDayLimit, type DeadlineStatus } from "@/lib/tools/torihiki-joken";
import { calcModel, isTaxableModel, PAY_MODEL_LABELS, type LineSpec, type PayModel } from "./payModels";
import {
  DEFAULT_CONSUMPTION_TAX_RATE,
  LABOR_RISK_TEXT,
  REDUCTION_RISK_TEXT,
  en,
  percent,
  type EngineWarning,
  type Rounding,
} from "./types";
import {
  BASE_RULE_LABELS,
  WITHHOLDING_CATEGORIES,
  calcPaymentWithholding,
  withholdingPaymentDue,
  type WithholdingBaseRule,
  type WithholdingCategory,
  type WithholdingGroup,
  type WithholdingItem,
} from "./withholding";

export type Payee = {
  name: string;
  /** 適格請求書発行事業者（インボイス登録済み）か */
  invoiceRegistered: boolean;
  /** 法人か（法人なら源泉徴収しない） */
  isCorporation: boolean;
  /** 消費税（免税の方には消費税相当額）を上乗せして払うか */
  paysTaxOnTop: boolean;
};

export type PayoutLine = LineSpec & {
  label: string;
  /** 源泉の区分（既定：none） */
  withholding?: WithholdingCategory;
  /** 区分の判断に迷う行（「要確認」の印を出す） */
  withholdingNeedsReview?: boolean;
};

export type Reimbursement = {
  label: string;
  amount: number;
  /**
   * true = 報酬と一緒に本人へ払う（源泉の元に入る。所得税基本通達204-4）
   * false = 発注者が交通機関・宿などへ直接払った（源泉の元にも振込額にも入らない。参考として出す）
   */
  paidWithFee: boolean;
  /** 源泉の元に入れる区分（既定：行のうち最初の源泉ありの区分） */
  withholding?: WithholdingCategory;
};

export type DeductionKind = "fee" | "material" | "penalty" | "transfer_fee" | "other";

export type Deduction = {
  label: string;
  /** 差し引く額（正の数） */
  amount: number;
  /** 取引条件の明示（契約書）に書いてあり、合意しているか */
  agreedInWriting: boolean;
  /** 根拠（基本契約○条 など） */
  basis?: string;
  kind?: DeductionKind;
};

export type OrderSideTaxMethod = "general" | "simplified" | "exempt";

export type PaymentTerms = {
  /** 給付を受け取った日（役務の提供を受けた日。月単位で締めるならその締切日。60日は締め期間の最初の日から数える） */
  receivedOn: string;
  /** 支払日 */
  payOn: string;
  /** 月単位で締めてまとめて払うことを合意し、明示書に書いているか（60日を2か月として数える） */
  monthlyClosing?: boolean;
  /**
   * 月単位で締めるときの、締め期間の初日。省略すると receivedOn（締め日）の前月の同じ締め日の翌日
   * （末日締めなら月の1日）とみなす。
   */
  periodStart?: string;
  /** 「請求書を受け取った月の翌月末」のように、請求書の受け取りを起点にした期日か */
  basedOnInvoiceReceipt?: boolean;
};

export type PayoutInput = {
  payee: Payee;
  lines: PayoutLine[];
  reimbursements?: Reimbursement[];
  deductions?: Deduction[];
  /** 役務の提供を受けた日（課税仕入れの日。経過措置の割合はこの日で決まる） */
  serviceDate: string;
  /** 消費税率（既定 DEFAULT_CONSUMPTION_TAX_RATE） */
  taxRate?: number;
  /** 消費税の端数（既定：切り捨て） */
  taxRounding?: Rounding;
  /** 発注する側の消費税の計算方法。原則課税のときだけ、免税の方への支払で控除できない負担が出る */
  orderSideTaxMethod: OrderSideTaxMethod;
  /** 請求書等で消費税がはっきり分けて書いてあるか（既定 true。false なら源泉の元は税込） */
  taxShownSeparately?: boolean;
  /** 外交員：同じ月に払う給与（固定の部分） */
  gaikoinMonthlySalary?: number;
  paymentTerms?: PaymentTerms;
};

export type PayoutLineResult = {
  label: string;
  model: PayModel;
  modelLabel: string;
  amount: number;
  taxable: boolean;
  withholding: WithholdingCategory;
  withholdingNeedsReview: boolean;
  formulaText: string;
  detail: string;
};

export type PayoutResult = {
  payee: Payee;
  lines: PayoutLineResult[];
  /** 税抜の報酬（消費税の対象の行の合計） */
  subtotal: number;
  /** 面貸しなど、報酬ではない精算の合計（消費税・源泉の対象外） */
  settlementsTotal: number;
  /** 消費税（または消費税相当額） */
  tax: number;
  taxLabel: "消費税" | "消費税相当額" | null;
  withholdingRule: WithholdingBaseRule;
  withholdingGroups: WithholdingGroup[];
  /** 源泉の元の合計 */
  withholdingBase: number;
  withholding: number;
  /** 報酬と一緒に払う立替 */
  reimbursementsPaid: number;
  /** 発注者が直接払った立替（参考。振込額に入らない） */
  reimbursementsDirect: number;
  deductionsTotal: number;
  payout: number;
  /** 免税の方への支払で、発注する側が控除できずに負担する消費税（原則課税のときだけ） */
  invoiceBurden: number;
  /** 経過措置で控除できる割合（役務の提供を受けた日で決まる。登録済みなら 1） */
  deductibleRate: number;
  /** 源泉税の納付期限（支払日の翌月10日）。支払日が分からなければ null */
  withholdingDue: string | null;
  /** 支払期日の60日の判定（paymentTermsCheck と同じ）。支払の条件が無ければ null */
  dueStatus: DeadlineStatus | null;
  warnings: EngineWarning[];
  notes: string[];
  explanation: string[];
};

export const FEE_WITHHOLDING_NOTE =
  "契約で決めた差し引き（管理費・材料費など）は、源泉の元から引きません（源泉は差し引く前の報酬にかけます）。";

/**
 * 月単位で締めるときの締め期間の初日。締め日（YYYY-MM-DD）の前月の同じ締め日の翌日。
 * 締め日が月末なら「末日締め」とみなし、その月の1日。日付の数え方は lib/tools/torihiki-joken の関数を使う。
 */
export function closingPeriodStart(closingDate: string): string {
  const [y, m, d] = closingDate.split("-").map(Number);
  const closingDay = d === daysInMonth(y, m) ? "末" : d;
  const prevY = m === 1 ? y - 1 : y;
  const prevM = m === 1 ? 12 : m - 1;
  return addDays(dayInMonth(prevY, prevM, closingDay), 1);
}

export type PaymentTermsCheck = {
  status: DeadlineStatus;
  /** 数え始めの日（月単位の締めなら締め期間の初日） */
  countFrom: string;
  /** 数え始めの日からの期限 */
  limit: string;
  /** 月単位の締めで、締め日から数えた期限（条件つき）。締めないなら null */
  limitFromClosing: string | null;
};

/**
 * 支払期日の60日の判定。lib/tools/torihiki-joken の paymentDeadlineCheck と同じ決まりで数える（実装は1つ）。
 *  - 月単位で締めない：給付を受け取った日を1日目として60日目まで（addDays(受け取った日, 59)）。超えたら ng
 *  - 月単位で締める：締め期間の初日から数えて期限内（sixtyDayLimit）なら ok、
 *    締め日から数えてはじめて期限内なら caution（締め日から数えてよい条件つき）、締め日から数えても超えるなら ng
 */
export function paymentTermsCheck(terms: PaymentTerms): PaymentTermsCheck {
  if (!terms.monthlyClosing) {
    const limit = addDays(terms.receivedOn, 59);
    return { status: terms.payOn <= limit ? "ok" : "ng", countFrom: terms.receivedOn, limit, limitFromClosing: null };
  }
  const countFrom = terms.periodStart ?? closingPeriodStart(terms.receivedOn);
  const limit = sixtyDayLimit(countFrom);
  const limitFromClosing = sixtyDayLimit(terms.receivedOn);
  const status: DeadlineStatus = terms.payOn <= limit ? "ok" : terms.payOn <= limitFromClosing ? "caution" : "ng";
  return { status, countFrom, limit, limitFromClosing };
}

function sumOf(values: number[]): number {
  return values.reduce((a, b) => a + b, 0);
}

export function buildPayout(input: PayoutInput): PayoutResult {
  const { payee } = input;
  const taxRate = input.taxRate ?? DEFAULT_CONSUMPTION_TAX_RATE;
  const taxRounding = input.taxRounding ?? "floor";
  const warnings: EngineWarning[] = [];
  const notes: string[] = [];

  // 1. 行ごとの報酬
  const lines: PayoutLineResult[] = input.lines.map((line) => {
    const r = calcModel(line);
    for (const w of r.warnings) warnings.push({ ...w, source: w.source ?? line.label });
    for (const n of r.notes) if (!notes.includes(n)) notes.push(n);
    // 契約で決めた差し引き（管理費・材料費など）は相殺と同じで、源泉の元を減らさない（区分は持たせない）
    const isFee = line.model === "contractFee";
    if (isFee && line.withholding && line.withholding !== "none" && !notes.includes(FEE_WITHHOLDING_NOTE)) {
      notes.push(FEE_WITHHOLDING_NOTE);
    }
    const withholding = isFee ? "none" : (line.withholding ?? "none");
    const needsReview = line.withholdingNeedsReview === true;
    if (needsReview) {
      warnings.push({
        code: "withholding_needs_review",
        level: "caution",
        message: `源泉の区分は要確認です（いまは「${WITHHOLDING_CATEGORIES[withholding].short}」で計算）。最終の判断は税理士へ。`,
        source: line.label,
      });
    }
    return {
      label: line.label,
      model: line.model,
      modelLabel: PAY_MODEL_LABELS[line.model],
      amount: r.amount,
      taxable: isTaxableModel(line.model),
      withholding,
      withholdingNeedsReview: needsReview,
      formulaText: r.formulaText,
      detail: r.detail,
    };
  });
  const taxableLines = lines.filter((l) => l.taxable);
  const subtotal = sumOf(taxableLines.map((l) => l.amount));
  const settlementsTotal = sumOf(lines.filter((l) => !l.taxable).map((l) => l.amount));

  // 2. 消費税
  const tax = payee.paysTaxOnTop && subtotal > 0 ? roundYen(subtotal * taxRate, taxRounding) : 0;
  const taxLabel = !payee.paysTaxOnTop || subtotal <= 0 ? null : payee.invoiceRegistered ? "消費税" : "消費税相当額";
  if (!payee.paysTaxOnTop && subtotal > 0) {
    if (payee.invoiceRegistered) {
      warnings.push({
        code: "tax_not_added",
        level: "caution",
        message: "登録済みの方に消費税を上乗せしていません。単価をはじめから税込で決めているかを確かめてください。",
      });
    } else {
      warnings.push({
        code: "exempt_no_tax_equivalent",
        level: "caution",
        message:
          "免税の方に消費税相当額を上乗せしていません。はじめから総額で決めて明示・合意した条件か確かめてください。" +
          "免税であることを理由に報酬や消費税相当額を一方的に下げると、フリーランス法の減額・買いたたきなどの問題になりえます。",
      });
    }
  }

  // 3. 源泉の元（区分ごと。税込を元にするときは、区分ごとの行の額にかかる消費税を足す）
  const reimbursements = input.reimbursements ?? [];
  const firstWithholding = lines.find((l) => l.withholding !== "none")?.withholding ?? "none";
  const byCategory = new Map<WithholdingCategory, number>();
  for (const l of taxableLines) byCategory.set(l.withholding, (byCategory.get(l.withholding) ?? 0) + l.amount);
  const items: WithholdingItem[] = [];
  // 区分ごとの消費税の割り当ての合計が、実際の消費税を超えないようにする（端数の設定が四捨五入・切り上げのとき）
  let taxLeft = tax;
  for (const [category, amount] of byCategory) {
    if (category === "none") continue;
    const share = tax > 0 && amount > 0 ? Math.min(taxLeft, roundYen(amount * taxRate, taxRounding)) : 0;
    taxLeft -= share;
    items.push({ category, amount, tax: share });
  }
  for (const r of reimbursements) {
    if (!(r.amount >= 0)) {
      warnings.push({ code: "invalid_input", level: "warning", message: "立替の額は0以上で入れてください", source: r.label });
      continue;
    }
    if (!r.paidWithFee) continue;
    items.push({ category: r.withholding ?? firstWithholding, amount: r.amount, tax: 0 });
  }
  // 税込を元にしなければならないのは、消費税を上乗せしているのに分けて書いていないとき
  const taxShownSeparately = input.taxShownSeparately ?? true;
  const pw = calcPaymentWithholding(items, {
    taxShownSeparately: tax === 0 ? true : taxShownSeparately,
    payeeIsCorporation: payee.isCorporation,
    monthlySalaryForGaikoin: input.gaikoinMonthlySalary,
    date: input.paymentTerms?.payOn ?? input.serviceDate,
  });
  const withholding = pw.tax;
  const withholdingRule: WithholdingBaseRule = tax === 0 ? "no_tax_added" : pw.rule;
  if ((input.gaikoinMonthlySalary ?? 0) > 0 && pw.groups.some((g) => g.category === "ko4_gaikoin")) {
    warnings.push({
      code: "gaikoin_salary_part",
      level: "info",
      message: "外交員の固定の部分は給与として扱い、報酬の源泉からは外しています（給与の源泉は別に計算してください）。",
    });
  }

  // 4. 立替
  const validReimbursements = reimbursements.filter((r) => r.amount >= 0);
  const reimbursementsPaid = sumOf(validReimbursements.filter((r) => r.paidWithFee).map((r) => Math.floor(r.amount)));
  const reimbursementsDirect = sumOf(validReimbursements.filter((r) => !r.paidWithFee).map((r) => Math.floor(r.amount)));

  // 5. 控除（源泉の元を減らさない）
  const deductions = input.deductions ?? [];
  for (const d of deductions) {
    if (!(d.amount >= 0)) {
      warnings.push({ code: "invalid_input", level: "warning", message: "控除の額は0以上で入れてください（増やす額は行に入れる）", source: d.label });
    }
    if (d.kind === "penalty") {
      warnings.push({ code: "reduction_risk", level: "warning", message: `罰金の差し引きです。${REDUCTION_RISK_TEXT}`, source: d.label });
      warnings.push({
        code: "labor_risk_penalty",
        level: "caution",
        message: `遅刻などの罰金は、指揮命令や勤怠の管理を示す設定に見えることがあります。${LABOR_RISK_TEXT}`,
        source: d.label,
      });
      continue;
    }
    if (d.kind === "transfer_fee") {
      warnings.push({
        code: "transfer_fee_deducted",
        level: "warning",
        message:
          "振込手数料は、支払う側が負担するのが安全です。取適法（旧・下請法）の運用では、合意があっても報酬から差し引くと減額とされうるとされ、フリーランス法でも問題になりえます。判断は専門家へ。",
        source: d.label,
      });
    }
    if (!d.agreedInWriting) {
      warnings.push({ code: "reduction_risk", level: "warning", message: REDUCTION_RISK_TEXT, source: d.label });
    }
  }
  const deductionsTotal = sumOf(deductions.filter((d) => d.amount >= 0).map((d) => Math.floor(d.amount)));

  // 6. 振込額
  const payout = subtotal + tax + settlementsTotal + reimbursementsPaid - withholding - deductionsTotal;
  if (payout < 0) {
    warnings.push({ code: "negative_payout", level: "warning", message: "振込額がマイナスです。控除の額を確かめてください。" });
  }

  // 免税の方への支払で、発注する側が控除できない消費税
  const deductibleRate = payee.invoiceRegistered ? 1 : deductibleRateForExempt(input.serviceDate);
  const invoiceBurden =
    !payee.invoiceRegistered && input.orderSideTaxMethod === "general" && subtotal > 0
      ? nonDeductibleTax(subtotal + tax, input.serviceDate, taxRate)
      : 0;

  // 支払期日（フリーランス法4条：給付を受け取った日から起算して60日以内）
  const terms = input.paymentTerms;
  const dueCheck = terms ? paymentTermsCheck(terms) : null;
  if (terms && dueCheck) {
    if (terms.basedOnInvoiceReceipt) {
      warnings.push({
        code: "due_from_invoice_receipt",
        level: "warning",
        message:
          "支払期日は、請求書を受け取った日ではなく、給付を受け取った日から数えます。月単位で締めるなら、締め期間の最初の日から数えるのが安全です（60日は2か月として数えます）。請求書の受け取りを起点にすると60日を超えるおそれがあります。",
      });
    }
    const check = dueCheck;
    if (check.status === "ng") {
      const limit = check.limitFromClosing ?? check.limit;
      warnings.push({
        code: "over_60_days",
        level: "warning",
        message: terms.monthlyClosing
          ? `支払日（${terms.payOn}）が、締め日（${terms.receivedOn}）から数えても60日（2か月）の期限（${limit}）を過ぎています。`
          : `支払日（${terms.payOn}）が、給付を受け取った日（${terms.receivedOn}）から数えて60日の期限（${limit}）を過ぎています。`,
      });
    } else if (check.status === "caution") {
      warnings.push({
        code: "over_60_days_from_period_start",
        level: "caution",
        message:
          `締め期間の最初の日（${check.countFrom}）から数えると、支払日（${terms.payOn}）は60日（2か月）の期限（${check.limit}）を過ぎます。` +
          "締め日から数えてよいのは、同じ種類の業務が続き、締めてまとめて払うことと報酬の額（算定方法）を明示書に書いている場合です。あてはまるか確かめてください。",
      });
    }
  }
  const dueStatus = dueCheck?.status ?? null;
  const withholdingDue = withholding > 0 && terms ? withholdingPaymentDue(terms.payOn) : null;

  const explanation = explain({
    input,
    lines,
    subtotal,
    settlementsTotal,
    tax,
    taxRate,
    taxLabel,
    withholdingRule,
    groups: pw.groups,
    withholding,
    reimbursements,
    reimbursementsPaid,
    deductions,
    deductionsTotal,
    payout,
    invoiceBurden,
    deductibleRate,
    withholdingDue,
  });

  return {
    payee,
    lines,
    subtotal,
    settlementsTotal,
    tax,
    taxLabel,
    withholdingRule,
    withholdingGroups: pw.groups,
    withholdingBase: pw.base,
    withholding,
    reimbursementsPaid,
    reimbursementsDirect,
    deductionsTotal,
    payout,
    invoiceBurden,
    deductibleRate,
    withholdingDue,
    dueStatus,
    warnings,
    notes,
    explanation,
  };
}

function explain(p: {
  input: PayoutInput;
  lines: PayoutLineResult[];
  subtotal: number;
  settlementsTotal: number;
  tax: number;
  taxRate: number;
  taxLabel: PayoutResult["taxLabel"];
  withholdingRule: WithholdingBaseRule;
  groups: WithholdingGroup[];
  withholding: number;
  reimbursements: Reimbursement[];
  reimbursementsPaid: number;
  deductions: Deduction[];
  deductionsTotal: number;
  payout: number;
  invoiceBurden: number;
  deductibleRate: number;
  withholdingDue: string | null;
}): string[] {
  const out: string[] = [];
  const { payee } = p.input;
  const taxable = p.lines.filter((l) => l.taxable);
  if (taxable.length > 0) {
    out.push(`① 報酬（税抜）：${taxable.map((l) => `${l.label} ${en(l.amount)}`).join(" ＋ ")} = ${en(p.subtotal)}`);
  }
  const settlements = p.lines.filter((l) => !l.taxable);
  if (settlements.length > 0) {
    out.push(`① 精算（報酬ではない）：${settlements.map((l) => `${l.label} ${l.detail}`).join("、")}`);
  }

  if (p.taxLabel) {
    out.push(`② ${p.taxLabel}：${en(p.subtotal)} × ${percent(p.taxRate)} = ${en(p.tax)}`);
  } else if (p.subtotal > 0) {
    out.push(`② 消費税：上乗せしない（${payee.invoiceRegistered ? "単価が税込の決め方" : "免税の方で、消費税相当額を上乗せしない条件"}）`);
  }

  const hasWithholdingLines = p.lines.some((l) => l.withholding !== "none");
  if (p.groups.length === 0) {
    out.push("③ 源泉の元：源泉徴収の対象の行はありません");
    out.push("④ 源泉税：0円");
  } else if (payee.isCorporation) {
    out.push("③ 源泉の元：支払先が法人なので、源泉徴収はしません");
    out.push("④ 源泉税：0円");
  } else {
    const ruleText = BASE_RULE_LABELS[p.withholdingRule];
    const withReimb = p.reimbursements.some((r) => r.paidWithFee && r.amount > 0) ? "。報酬と一緒に払う交通費なども入れる" : "";
    const withFee = p.lines.some((l) => l.model === "contractFee") ? "。契約で決めた差し引きは元から引かない" : "";
    out.push(
      `③ 源泉の元：${p.groups.map((g) => `${WITHHOLDING_CATEGORIES[g.category].short} ${en(g.base)}`).join("、")}（${ruleText}${withReimb}${withFee}。1回の支払で、区分が同じ行を合計）`,
    );
    out.push(
      `④ 源泉税：${p.groups.map((g) => g.formulaText).join("、")}${p.groups.length > 1 ? ` → 合計 ${en(p.withholding)}` : ""}`,
    );
  }
  if (!hasWithholdingLines && p.groups.length > 0) out.push("（立替の分だけ源泉の元に入っています）");

  const minus: string[] = [];
  if (p.deductions.length > 0) {
    minus.push(...p.deductions.map((d) => `${d.label} ${en(d.amount)}${d.agreedInWriting ? "（合意済み）" : "（合意なし）"}`));
    out.push(`⑤ 控除：${minus.join("、")} = ${en(p.deductionsTotal)}（源泉の元は減らさない）`);
  } else {
    out.push("⑤ 控除：なし");
  }

  const terms: string[] = [];
  if (p.subtotal || !p.settlementsTotal) terms.push(en(p.subtotal));
  if (p.tax) terms.push(`＋ ${en(p.tax)}`);
  if (p.settlementsTotal) terms.push(terms.length ? `＋ 精算 ${en(p.settlementsTotal)}` : `精算 ${en(p.settlementsTotal)}`);
  if (p.reimbursementsPaid) terms.push(`＋ 立替 ${en(p.reimbursementsPaid)}`);
  if (p.withholding) terms.push(`− 源泉税 ${en(p.withholding)}`);
  if (p.deductionsTotal) terms.push(`− 控除 ${en(p.deductionsTotal)}`);
  out.push(`⑥ 振込額：${terms.join(" ")} = ${en(p.payout)}`);

  if (p.withholdingDue) out.push(`源泉税の納付：${jpDate(p.withholdingDue)}まで（支払った月の翌月10日。土日祝日なら翌営業日）`);

  if (!payee.invoiceRegistered && p.subtotal > 0) {
    if (p.input.orderSideTaxMethod === "general") {
      out.push(
        `控除できない消費税（発注する側の負担）：${en(p.invoiceBurden)}。役務の提供を受けた日（${jpDate(p.input.serviceDate)}）の経過措置で、控除できるのは${percent(p.deductibleRate)}`,
      );
    } else {
      out.push("控除できない消費税（発注する側の負担）：0円（発注する側が簡易課税・免税のため）");
    }
  }
  return out;
}
