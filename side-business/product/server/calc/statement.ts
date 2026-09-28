/**
 * 1 か月ぶんの支払明細を作る（純関数。DB に触らない）。
 * 計算の順序：委託料（税抜）→ 消費税 → 控除（会社の売上。課税なら消費税）→ 調整 → 源泉徴収 → 振込額。
 * 端数処理・経過措置・源泉徴収は、サイトと共有する部品（side-business/lib）を使う。独自の丸めを書かない。
 */
import { calcWithholding, type WithholdingCategory } from "@/lib/engine/withholding";
import { roundYen } from "@/lib/payroll/money";
import { deductibleRateForExempt, monthEnd, nonDeductibleTax } from "@/lib/payroll/tax";
import type { Rounding } from "@/lib/payroll/types";
import { addDays, dayInMonth, type DayOfMonth } from "@/lib/tools/torihiki-joken";

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
  /** 明細を送ってから、連絡が無ければ確認とみなすまでの日数（注記の文に入れる。既定 7） */
  deemedConfirmDays?: number;
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
  /** 委託の開始日・終了日（稼働の無い月の定額を、契約の期間の中だけで引くために使う） */
  startedOn?: string | null;
  endOn?: string | null;
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
export type CalcWork = { driverId: string; projectId: string; qty: number; workDate?: string | null };
export type CalcAdjustment = { driverId: string; label: string; amount: number; taxable: boolean; agreedInWriting: boolean };

/** 日ごとの数量（date が null は日付の無い稼働の合計） */
export type StatementLineDay = { date: string | null; qty: number };

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
  /**
   * 日ごとの数量（日付の古い順。日付の無い稼働があれば最後に date: null でまとめる）。
   * 日付つきの稼働が 1 件も無い行には付けない（写しのハッシュが、日付の無い明細では前と変わらないように）
   */
  days?: StatementLineDay[];
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
  /**
   * 締めの期間が経過措置の段の境目（例：2026-10-01）をまたぐとき、稼働の日ごとに割合を分けた内訳。
   * またがないときは空。日付の無い稼働は期間の末日の割合で数え、undatedAcrossStep を立てる（見張り番が知らせる）
   */
  burdenParts?: { from: string; to: string; rate: number; base: number; burden: number }[];
  undatedAcrossStep?: boolean;
  hasWork: boolean;
  /** 仕入明細書として使う形か（登録済みの方） */
  isPurchaseStatement: boolean;
  note: string;
};

/** 明細の注記（送ってから days 日以内に連絡が無ければ確認とみなす。国税庁 インボイス Q&A 問86 の方法に沿った文） */
export function deemedNote(days = 7): string {
  return `記載内容に誤りがある場合は、受け取りから${days}日以内にご連絡ください。ご連絡がない場合は、内容を確認いただいたものとします。`;
}

export const DEFAULT_NOTE = deemedNote(7);

function toDay(closingDay: number): DayOfMonth {
  return closingDay >= 1 && closingDay <= 30 ? closingDay : "末";
}

/**
 * 締めの期間：前の月の締め日の翌日 〜 その月の締め日（0 と 31 は末日）。
 * 例：末締め 10 月 → 10/1〜10/31、20 日締め 10 月 → 9/21〜10/20
 */
export function periodOf(month: string, closingDay = 0): { from: string; to: string } {
  const [y, m] = month.slice(0, 7).split("-").map(Number);
  const prev = m === 1 ? { y: y - 1, m: 12 } : { y, m: m - 1 };
  const day = toDay(closingDay);
  return { from: addDays(dayInMonth(prev.y, prev.m, day), 1), to: dayInMonth(y, m, day) };
}

/**
 * 免税の方への支払で会社が負担する消費税。期間の中で経過措置の割合が変わるときは、
 * 稼働の日ごとの金額の割合で税込の額を分け（端数は大きい順に配る）、段ごとに計算して足す。
 */
function splitBurden(
  base: number,
  rows: { amount: number; date: string | null }[],
  period: { from: string; to: string },
): { total: number; parts: NonNullable<StatementDraft["burdenParts"]>; undatedAcrossStep: boolean } {
  const spans = deductibleRateForExempt(period.from) !== deductibleRateForExempt(period.to);
  if (!spans) return { total: nonDeductibleTax(base, period.to, TAX_RATE), parts: [], undatedAcrossStep: false };
  let undatedAcrossStep = false;
  const buckets = new Map<number, { amount: number; from: string; to: string }>();
  for (const r of rows) {
    const inPeriod = r.date && r.date >= period.from && r.date <= period.to ? r.date : null;
    if (!inPeriod) undatedAcrossStep = true;
    const date = inPeriod ?? period.to;
    const rate = deductibleRateForExempt(date);
    const b = buckets.get(rate);
    if (b) {
      b.amount += r.amount;
      if (date < b.from) b.from = date;
      if (date > b.to) b.to = date;
    } else buckets.set(rate, { amount: r.amount, from: date, to: date });
  }
  const list = [...buckets.entries()].map(([rate, b]) => ({ rate, ...b })).sort((a, b) => (a.from < b.from ? -1 : 1));
  const weight = list.reduce((x, b) => x + b.amount, 0);
  if (list.length <= 1 || weight <= 0) {
    return { total: nonDeductibleTax(base, list[0]?.to ?? period.to, TAX_RATE), parts: [], undatedAcrossStep };
  }
  // 税込の額を、日ごとの金額の割合で分ける（合計がぴったり base になるように、端数は余りの大きい順に 1 円ずつ）
  const exact = list.map((b) => (base * b.amount) / weight);
  const shares = exact.map(Math.floor);
  let rest = base - shares.reduce((x, y) => x + y, 0);
  const order = exact.map((v, i) => ({ i, frac: v - Math.floor(v) })).sort((a, b) => b.frac - a.frac);
  for (const o of order) {
    if (rest <= 0) break;
    shares[o.i]++;
    rest--;
  }
  const parts = list.map((b, i) => ({ from: b.from, to: b.to, rate: b.rate, base: shares[i], burden: nonDeductibleTax(shares[i], b.to, TAX_RATE) }));
  return { total: parts.reduce((x, p) => x + p.burden, 0), parts, undatedAcrossStep };
}

/**
 * 1 つの行（案件）の日ごとの数量。同じ日の稼働は足す（数量は保存と同じ小数 6 桁まで）。
 * 日付つきの稼働が無ければ undefined（日付の無い行だけなら、日ごとの内訳は出さない）
 */
export function lineDays(rows: { qty: number; date: string | null }[]): StatementLineDay[] | undefined {
  if (!rows.some((r) => r.date)) return undefined;
  const byDate = new Map<string | null, number>();
  for (const r of rows) byDate.set(r.date, Math.round(((byDate.get(r.date) ?? 0) + r.qty) * 1e6) / 1e6);
  const dated = [...byDate.entries()]
    .filter((e): e is [string, number] => e[0] !== null)
    .sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0))
    .map(([date, qty]) => ({ date, qty }));
  const undated = byDate.get(null);
  return undated !== undefined ? [...dated, { date: null, qty: undated }] : dated;
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
  const period = periodOf(month, tenant.closingDay);
  // 経過措置の割合は、期間の末日（日付のある稼働は、その日）で決める
  const judgedOn = period.to;
  const deductibleRate = deductibleRateForExempt(judgedOn);
  const payDate = payDateFor(month, tenant);
  const out: StatementDraft[] = [];
  // 稼働が 1 件も無い月は、会社としてこの仕組みで締めていない月（使い始める前など）とみなし、明細を作らない
  const monthInUse = input.work.some((w) => w.qty > 0);

  for (const d of input.drivers) {
    const qtyByProject = new Map<string, number>();
    const workRows: { projectId: string; qty: number; date: string | null }[] = [];
    for (const w of input.work) {
      if (w.driverId !== d.id || !(w.qty > 0) || !projects.has(w.projectId)) continue;
      qtyByProject.set(w.projectId, Math.round(((qtyByProject.get(w.projectId) ?? 0) + w.qty) * 1e6) / 1e6);
      workRows.push({ projectId: w.projectId, qty: w.qty, date: w.workDate ?? null });
    }
    const adjustments = input.adjustments.filter((a) => a.driverId === d.id && a.amount !== 0);
    const rules = rulesFor(input.rules, d.id);
    // 稼働が無くても引く定額（車両リースなど）がある人は、契約の期間の中なら明細を作る（引いていることを本人に見せる）
    const inContract = (!d.startedOn || d.startedOn <= period.to) && (!d.endOn || d.endOn >= period.from);
    const fixedWithoutWork =
      monthInUse && d.active && inContract && rules.some((r) => !r.onlyWhenWorked && r.kind === "fixed" && (r.amount ?? 0) !== 0);
    if (qtyByProject.size === 0 && adjustments.length === 0 && !fixedWithoutWork) continue;

    const lines: StatementLine[] = [...qtyByProject.entries()]
      .map(([projectId, qty]) => {
        const p = projects.get(projectId)!;
        const rate = overrides.get(`${d.id}:${projectId}`) ?? p.payRate;
        const days = lineDays(workRows.filter((w) => w.projectId === projectId));
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
          ...(days ? { days } : {}),
        };
      })
      .sort((a, b) => a.project.localeCompare(b.project, "ja"));

    const subtotal = lines.reduce((s, l) => s + l.amount, 0);
    const totalQty = lines.reduce((s, l) => s + l.qty, 0);
    const hasWork = lines.length > 0;
    const payTax = d.invoiceRegistered || tenant.payTaxToExempt;
    const tax = payTax ? roundYen(subtotal * TAX_RATE, tenant.taxRounding) : 0;

    const deductions: StatementDeduction[] = rules
      .filter((r) => hasWork || !r.onlyWhenWorked)
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
    const burden =
      tenant.taxMethod === "general" && !d.invoiceRegistered && subtotal + tax > 0
        ? splitBurden(
            subtotal + tax,
            workRows.map((w) => ({ amount: (overrides.get(`${d.id}:${w.projectId}`) ?? projects.get(w.projectId)!.payRate) * w.qty, date: w.date })),
            period,
          )
        : { total: 0, parts: [], undatedAcrossStep: false };

    out.push({
      driverId: d.id,
      month,
      period,
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
      invoiceBurden: burden.total,
      deductibleRate,
      burdenParts: burden.parts,
      undatedAcrossStep: burden.undatedAcrossStep,
      hasWork,
      isPurchaseStatement: d.invoiceRegistered,
      note: tenant.statementNote?.trim() || deemedNote(tenant.deemedConfirmDays ?? 7),
    });
  }
  return out.sort((a, b) => a.driver.name.localeCompare(b.driver.name, "ja"));
}

/**
 * その人に当てる控除のルール：全員向けと、その人だけのもの。
 * 同じ名前のルールがあれば、その人だけのものを使う（例：ロイヤリティは全員 10%、佐藤さんだけ 8%）
 */
export function rulesFor(rules: CalcRule[], driverId: string): CalcRule[] {
  const own = rules.filter((r) => r.active && r.driverId === driverId);
  const ownNames = new Set(own.map((r) => r.name.normalize("NFKC").replace(/\s/g, "")));
  const common = rules.filter((r) => r.active && r.driverId === null && !ownNames.has(r.name.normalize("NFKC").replace(/\s/g, "")));
  return [...common, ...own];
}

/** 会社の利益：売上 − 委託料 ＋ 控除（会社の売上）− 控除できない消費税 */
export function profitOf(d: StatementDraft): number {
  return d.sales - d.subtotal + d.deductionTotal - d.invoiceBurden;
}
