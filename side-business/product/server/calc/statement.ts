/**
 * 1 か月ぶんの支払明細を作る（純関数。DB に触らない）。
 * 計算の順序：委託料（税抜）→ 消費税 → 控除（会社の売上。課税なら消費税）→ 調整 → 源泉徴収 → 振込額。
 * 端数処理・経過措置・源泉徴収は、サイトと共有する部品（side-business/lib）を使う。独自の丸めを書かない。
 */
import { calcWithholding, type WithholdingCategory } from "@/lib/engine/withholding";
import { roundYen } from "@/lib/payroll/money";
import { deductibleRateForExempt, monthEnd, nonDeductibleTax } from "@/lib/payroll/tax";
import type { Rounding } from "@/lib/payroll/types";

export const TAX_RATE = 0.1;

export type CalcTenant = {
  name: string;
  registrationNo: string | null;
  taxMethod: string;
  payTaxToExempt: boolean;
  taxRounding: Rounding;
  amountRounding: Rounding;
  closingDay: number;
  payMonthOffset: number;
  payDay: number;
  statementNote?: string;
};

export type CalcDriver = {
  id: string;
  name: string;
  code?: string | null;
  invoiceRegistered: boolean;
  registrationNo: string | null;
  isCorporation: boolean;
  withholdingCategory: string;
  active: boolean;
};

export type CalcProject = { id: string; name: string; clientName: string | null; unit: string; billRate: number; payRate: number };
export type CalcOverride = { driverId: string; projectId: string; payRate: number };
export type CalcRule = {
  id: string;
  driverId: string | null;
  name: string;
  kind: "percent" | "fixed" | "per_unit";
  rate: number | null;
  amount: number | null;
  onlyWhenWorked: boolean;
  taxable: boolean;
  agreedInWriting: boolean;
  active: boolean;
  sort: number;
};
export type CalcWork = { driverId: string; projectId: string; qty: number };
export type CalcAdjustment = { driverId: string; label: string; amount: number; taxable: boolean; agreedInWriting: boolean };

export type StatementLine = {
  projectId: string;
  project: string;
  client: string | null;
  unit: string;
  qty: number;
  rate: number;
  amount: number;
  /** 受注の側（利益の計算に使う。明細には出さない） */
  billRate: number;
  sales: number;
};

export type StatementDeduction = { ruleId: string; name: string; amount: number; taxable: boolean; agreedInWriting: boolean; how: string };

export type StatementDraft = {
  driverId: string;
  month: string;
  period: { from: string; to: string };
  payDate: string;
  company: { name: string; registrationNo: string | null };
  driver: { name: string; code: string | null; registrationNo: string | null; invoiceRegistered: boolean };
  lines: StatementLine[];
  /** 委託料（税抜） */
  subtotal: number;
  /** 委託料の消費税（免税の方に払わない設定なら 0） */
  tax: number;
  taxLabel: "消費税" | "消費税相当額" | null;
  deductions: StatementDeduction[];
  deductionTotal: number;
  /** 控除のうち課税分の消費税 */
  deductionTax: number;
  adjustments: { label: string; amount: number; taxable: boolean; agreedInWriting: boolean }[];
  adjustmentTotal: number;
  adjustmentTax: number;
  withholding: { category: string; amount: number; formula: string } | null;
  total: number;
  sales: number;
  /** 免税の方への支払で、会社が控除できずに負担する消費税（原則課税のときだけ） */
  invoiceBurden: number;
  deductibleRate: number;
  hasWork: boolean;
  /** 仕入明細書として使う形か（登録済みの方） */
  isPurchaseStatement: boolean;
  note: string;
};

const DEFAULT_NOTE =
  "記載内容に誤りがある場合は、受け取りから7日以内にご連絡ください。ご連絡がない場合は、内容を確認いただいたものとします。";

/** YYYY-MM-01 → 月末の日付 */
export function periodOf(month: string): { from: string; to: string } {
  const ym = month.slice(0, 7);
  return { from: `${ym}-01`, to: monthEnd(ym) };
}

/** 支払日：締めた月から payMonthOffset か月後の payDay 日（0 は末日。月に無い日は末日） */
export function payDateFor(month: string, t: Pick<CalcTenant, "payMonthOffset" | "payDay">): string {
  const [y, m] = month.slice(0, 7).split("-").map(Number);
  const total = y * 12 + (m - 1) + t.payMonthOffset;
  const py = Math.floor(total / 12);
  const pm = (total % 12) + 1;
  const ym = `${py}-${String(pm).padStart(2, "0")}`;
  const last = Number(monthEnd(ym).slice(8));
  const day = t.payDay <= 0 ? last : Math.min(t.payDay, last);
  return `${ym}-${String(day).padStart(2, "0")}`;
}

function ruleAmount(rule: CalcRule, subtotal: number, qty: number, rounding: Rounding): { amount: number; how: string } {
  if (rule.kind === "percent") {
    const rate = rule.rate ?? 0;
    return { amount: roundYen(subtotal * rate, rounding), how: `委託料 ${subtotal.toLocaleString("ja-JP")}円 × ${Math.round(rate * 10000) / 100}%` };
  }
  if (rule.kind === "per_unit") {
    const unit = rule.rate ?? 0;
    return { amount: roundYen(qty * unit, rounding), how: `数量 ${qty.toLocaleString("ja-JP")} × ${unit.toLocaleString("ja-JP")}円` };
  }
  return { amount: rule.amount ?? 0, how: "毎月の定額" };
}

export type BuildInput = {
  month: string;
  tenant: CalcTenant;
  drivers: CalcDriver[];
  projects: CalcProject[];
  overrides: CalcOverride[];
  rules: CalcRule[];
  work: CalcWork[];
  adjustments: CalcAdjustment[];
};

export function buildStatementDrafts(input: BuildInput): StatementDraft[] {
  const { month, tenant } = input;
  const projects = new Map(input.projects.map((p) => [p.id, p]));
  const overrides = new Map(input.overrides.map((o) => [`${o.driverId}:${o.projectId}`, o.payRate]));
  const judgedOn = monthEnd(month.slice(0, 7));
  const deductibleRate = deductibleRateForExempt(judgedOn);
  const payDate = payDateFor(month, tenant);
  const out: StatementDraft[] = [];

  for (const d of input.drivers) {
    const qtyByProject = new Map<string, number>();
    for (const w of input.work) {
      if (w.driverId !== d.id || !(w.qty > 0) || !projects.has(w.projectId)) continue;
      qtyByProject.set(w.projectId, Math.round(((qtyByProject.get(w.projectId) ?? 0) + w.qty) * 1e6) / 1e6);
    }
    const adjustments = input.adjustments.filter((a) => a.driverId === d.id && a.amount !== 0);
    if (qtyByProject.size === 0 && adjustments.length === 0) continue;

    const lines: StatementLine[] = [...qtyByProject.entries()]
      .map(([projectId, qty]) => {
        const p = projects.get(projectId)!;
        const rate = overrides.get(`${d.id}:${projectId}`) ?? p.payRate;
        return {
          projectId,
          project: p.name,
          client: p.clientName,
          unit: p.unit,
          qty,
          rate,
          amount: roundYen(rate * qty, tenant.amountRounding),
          billRate: p.billRate,
          sales: roundYen(p.billRate * qty, tenant.amountRounding),
        };
      })
      .sort((a, b) => a.project.localeCompare(b.project, "ja"));

    const subtotal = lines.reduce((s, l) => s + l.amount, 0);
    const totalQty = lines.reduce((s, l) => s + l.qty, 0);
    const hasWork = lines.length > 0;
    const payTax = d.invoiceRegistered || tenant.payTaxToExempt;
    const tax = payTax ? roundYen(subtotal * TAX_RATE, tenant.taxRounding) : 0;

    const deductions: StatementDeduction[] = input.rules
      .filter((r) => r.active && (r.driverId === null || r.driverId === d.id) && (hasWork || !r.onlyWhenWorked))
      .sort((a, b) => a.sort - b.sort || a.name.localeCompare(b.name, "ja"))
      .map((r) => {
        const { amount, how } = ruleAmount(r, subtotal, totalQty, tenant.amountRounding);
        return { ruleId: r.id, name: r.name, amount, taxable: r.taxable, agreedInWriting: r.agreedInWriting, how };
      })
      .filter((x) => x.amount !== 0);
    const deductionTotal = deductions.reduce((s, x) => s + x.amount, 0);
    const deductionTax = roundYen(deductions.filter((x) => x.taxable).reduce((s, x) => s + x.amount, 0) * TAX_RATE, tenant.taxRounding);

    const adjustmentTotal = adjustments.reduce((s, a) => s + a.amount, 0);
    const adjustmentTax = roundYen(adjustments.filter((a) => a.taxable).reduce((s, a) => s + a.amount, 0) * TAX_RATE, tenant.taxRounding);

    let withholding: StatementDraft["withholding"] = null;
    if (d.withholdingCategory && d.withholdingCategory !== "none") {
      // 明細で消費税を分けて書くので、源泉の元は税抜の委託料
      const w = calcWithholding(d.withholdingCategory as WithholdingCategory, subtotal, { payeeIsCorporation: d.isCorporation, date: payDate });
      withholding = { category: d.withholdingCategory, amount: w.tax, formula: w.formulaText };
    }

    const total = subtotal + tax - (deductionTotal + deductionTax) + adjustmentTotal + adjustmentTax - (withholding?.amount ?? 0);
    const invoiceBurden = tenant.taxMethod === "general" && !d.invoiceRegistered ? nonDeductibleTax(subtotal + tax, judgedOn, TAX_RATE) : 0;

    out.push({
      driverId: d.id,
      month,
      period: periodOf(month),
      payDate,
      company: { name: tenant.name, registrationNo: tenant.registrationNo },
      driver: { name: d.name, code: d.code ?? null, registrationNo: d.invoiceRegistered ? d.registrationNo : null, invoiceRegistered: d.invoiceRegistered },
      lines,
      subtotal,
      tax,
      taxLabel: payTax ? (d.invoiceRegistered ? "消費税" : "消費税相当額") : null,
      deductions,
      deductionTotal,
      deductionTax,
      adjustments: adjustments.map((a) => ({ label: a.label, amount: a.amount, taxable: a.taxable, agreedInWriting: a.agreedInWriting })),
      adjustmentTotal,
      adjustmentTax,
      withholding,
      total,
      sales: lines.reduce((s, l) => s + l.sales, 0),
      invoiceBurden,
      deductibleRate,
      hasWork,
      isPurchaseStatement: d.invoiceRegistered,
      note: tenant.statementNote?.trim() || DEFAULT_NOTE,
    });
  }
  return out.sort((a, b) => a.driver.name.localeCompare(b.driver.name, "ja"));
}

/** 会社の利益：売上 − 委託料 ＋ 控除（会社の売上）− 控除できない消費税 */
export function profitOf(d: StatementDraft): number {
  return d.sales - d.subtotal + d.deductionTotal - d.invoiceBurden;
}
