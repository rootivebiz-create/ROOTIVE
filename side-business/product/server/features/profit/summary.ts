/**
 * 利益のまとめ（純関数。DB に触らない）。
 * 明細の形（StatementDraft）だけから、案件・元請・ドライバーごとの利益と、月の合計を出す。
 * - 会社の利益は profitOf（売上 − 委託料 ＋ 控除（会社の売上）− 控除できない消費税）だけで決める。ここで計算し直さない
 * - 控除と経過措置の負担はドライバーごとのもの。案件・元請には割り振らず、別の行として見せる
 * - 金額は税抜。消費税と、立替の精算などの調整は利益に入れない（profitOf と同じ）
 */
import { profitOf, type StatementDraft } from "~/server/calc/statement";
import { TRANSITIONAL_STEPS, monthEnd, nonDeductibleTax } from "@/lib/payroll/tax";
import { periodLabel } from "@/lib/tools/invoice-cost";

// ---------------------------------------------------------------- 形

export type ProfitTotals = {
  /** 売上（受注の単価 × 数量。税抜） */
  sales: number;
  /** 委託料（ドライバーへの支払。税抜） */
  pay: number;
  /** 案件の粗利（売上 − 委託料） */
  gross: number;
  /** 控除（ロイヤリティ・管理費・リースなど。会社の売上。税抜） */
  deductions: number;
  /** 経過措置の負担（インボイスの登録が無い方への支払で、控除できない消費税） */
  burden: number;
  /** 会社の利益（profitOf の合計） */
  profit: number;
  /** 利益率（会社の利益 ÷ 売上。売上が無ければ null） */
  rate: number | null;
  /** 明細の人数 */
  drivers: number;
  /** インボイスの登録が無い方の人数（稼働のある人） */
  unregistered: number;
  /** 振込額の合計（明細の振込額の合計） */
  transfer: number;
};

export type ProjectProfit = {
  key: string;
  name: string;
  client: string | null;
  unit: string;
  qty: number;
  sales: number;
  pay: number;
  /** 粗利（売上 − 委託料）。控除と経過措置の負担は含めない */
  profit: number;
  rate: number | null;
  drivers: number;
};

export type ClientProfit = {
  key: string;
  name: string;
  /** 元請が決まっていない案件のまとまりか */
  none: boolean;
  projects: string[];
  sales: number;
  pay: number;
  profit: number;
  rate: number | null;
};

export type DriverProfit = {
  driverId: string;
  name: string;
  code: string | null;
  registered: boolean;
  sales: number;
  pay: number;
  deductions: number;
  burden: number;
  /** 会社の利益（profitOf） */
  profit: number;
  rate: number | null;
  transfer: number;
  hasWork: boolean;
};

export type ProfitSummary = {
  totals: ProfitTotals;
  projects: ProjectProfit[];
  clients: ClientProfit[];
  drivers: DriverProfit[];
};

/** 元請が決まっていない案件をまとめる名前 */
export const NO_CLIENT_LABEL = "元請の設定なし";

// ---------------------------------------------------------------- 計算

/** 利益 ÷ 売上（売上が 0 以下なら null） */
export function rateOf(profit: number, sales: number): number | null {
  return sales > 0 ? profit / sales : null;
}

/** 名前の順。番号（ドライバーの番号）があれば番号の順を先にする（漢字の名前は読みの順に並ばないため） */
function byNameJa(a: { name: string; code?: string | null }, b: { name: string; code?: string | null }): number {
  const ca = a.code ?? "";
  const cb = b.code ?? "";
  if (ca && cb && ca !== cb) return ca.localeCompare(cb, "ja", { numeric: true });
  if (ca && !cb) return -1;
  if (!ca && cb) return 1;
  return a.name.localeCompare(b.name, "ja");
}

/** 明細の一覧から、合計と案件・元請・ドライバーごとの利益を出す */
export function summarizeDrafts(drafts: StatementDraft[]): ProfitSummary {
  const totals: ProfitTotals = { sales: 0, pay: 0, gross: 0, deductions: 0, burden: 0, profit: 0, rate: null, drivers: drafts.length, unregistered: 0, transfer: 0 };
  const projects = new Map<string, ProjectProfit & { driverIds: Set<string> }>();
  const drivers: DriverProfit[] = [];

  for (const d of drafts) {
    const profit = profitOf(d);
    totals.sales += d.sales;
    totals.pay += d.subtotal;
    totals.deductions += d.deductionTotal;
    totals.burden += d.invoiceBurden;
    totals.profit += profit;
    totals.transfer += d.total;
    if (!d.driver.invoiceRegistered && d.hasWork) totals.unregistered++;
    drivers.push({
      driverId: d.driverId,
      name: d.driver.name,
      code: d.driver.code,
      registered: d.driver.invoiceRegistered,
      sales: d.sales,
      pay: d.subtotal,
      deductions: d.deductionTotal,
      burden: d.invoiceBurden,
      profit,
      rate: rateOf(profit, d.sales),
      transfer: d.total,
      hasWork: d.hasWork,
    });
    for (const l of d.lines) {
      const p =
        projects.get(l.projectId) ??
        { key: l.projectId, name: l.project, client: l.client, unit: l.unit, qty: 0, sales: 0, pay: 0, profit: 0, rate: null, drivers: 0, driverIds: new Set<string>() };
      p.qty = Math.round((p.qty + l.qty) * 1e6) / 1e6;
      p.sales += l.sales;
      p.pay += l.amount;
      p.driverIds.add(d.driverId);
      projects.set(l.projectId, p);
    }
  }
  totals.gross = totals.sales - totals.pay;
  totals.rate = rateOf(totals.profit, totals.sales);

  const projectRows: ProjectProfit[] = [...projects.values()]
    .map(({ driverIds, ...p }) => {
      const profit = p.sales - p.pay;
      return { ...p, profit, rate: rateOf(profit, p.sales), drivers: driverIds.size };
    })
    .sort(byNameJa);

  // 元請ごと（明細に書いた元請の名前でまとめる。締めた月は、そのときの名前のまま）
  const clients = new Map<string, ClientProfit>();
  for (const p of projectRows) {
    const key = p.client ?? "";
    const c = clients.get(key) ?? { key, name: p.client ?? NO_CLIENT_LABEL, none: p.client === null, projects: [], sales: 0, pay: 0, profit: 0, rate: null };
    c.projects.push(p.name);
    c.sales += p.sales;
    c.pay += p.pay;
    clients.set(key, c);
  }
  const clientRows = [...clients.values()]
    .map((c) => {
      const profit = c.sales - c.pay;
      return { ...c, profit, rate: rateOf(profit, c.sales) };
    })
    .sort((a, b) => Number(a.none) - Number(b.none) || byNameJa(a, b));

  return { totals, projects: projectRows, clients: clientRows, drivers: drivers.sort(byNameJa) };
}

// ---------------------------------------------------------------- 並べ替え

export type SortKey = "profit_desc" | "profit_asc" | "name";

export const SORTS: { key: SortKey; label: string }[] = [
  { key: "profit_desc", label: "利益の多い順" },
  { key: "profit_asc", label: "利益の少ない順" },
  { key: "name", label: "番号・名前の順" },
];

export function parseSort(value: string | string[] | undefined): SortKey {
  const v = Array.isArray(value) ? value[0] : value;
  return SORTS.some((s) => s.key === v) ? (v as SortKey) : "profit_desc";
}

/** 利益の多い順・少ない順・名前の順（同じ額なら名前の順） */
export function sortRows<T extends { name: string; code?: string | null; profit: number }>(rows: T[], sort: SortKey): T[] {
  const out = [...rows];
  if (sort === "name") return out.sort(byNameJa);
  const dir = sort === "profit_desc" ? -1 : 1;
  return out.sort((a, b) => (a.profit - b.profit) * dir || byNameJa(a, b));
}

/** 利益の多い案件と少ない案件（3 件ずつ。案件が少ないときは重ならないようにする） */
export function topAndBottom<T extends { key: string; name: string; profit: number }>(rows: T[], n = 3): { top: T[]; bottom: T[] } {
  const top = sortRows(rows, "profit_desc").slice(0, n);
  const used = new Set(top.map((r) => r.key));
  const bottom = sortRows(rows, "profit_asc")
    .filter((r) => !used.has(r.key))
    .slice(0, n);
  return { top, bottom };
}

// ---------------------------------------------------------------- 前の月との比べ

export type Change = { diff: number; ratio: number | null };

/** 前の月との差（前の月の記録が無ければ null） */
export function changeOf(current: number, previous: number | null | undefined): Change | null {
  if (previous === null || previous === undefined) return null;
  const diff = current - previous;
  return { diff, ratio: previous !== 0 ? diff / Math.abs(previous) : null };
}

// ---------------------------------------------------------------- 推移

export type TrendPoint = {
  month: string;
  sales: number;
  pay: number;
  profit: number;
  rate: number | null;
  drivers: number;
  closed: boolean;
  /** snapshot（締めた明細の写し）・calc（今の稼働と設定から計算） */
  source: "snapshot" | "calc";
};

export function toTrendPoint(month: string, totals: ProfitTotals, closed: boolean, source: TrendPoint["source"]): TrendPoint {
  return { month, sales: totals.sales, pay: totals.pay, profit: totals.profit, rate: totals.rate, drivers: totals.drivers, closed, source };
}

// ---------------------------------------------------------------- 経過措置の先の目安

export type BurdenStep = {
  from: string;
  to: string | null;
  /** 「2026年10月〜2028年9月」 */
  label: string;
  /** 控除できる割合（0.7 = 70%） */
  deductibleRate: number;
  /** 会社が負担する消費税（月・同じ稼働が続いた場合の目安） */
  monthly: number;
  /** 年（月 × 12） */
  yearly: number;
  /** 今の期間との差（月） */
  diffMonthly: number;
  isCurrent: boolean;
};

export type FutureBurden = {
  /** 会社が原則課税か（簡易課税・2割特例は、この負担が出ない計算方法） */
  affected: boolean;
  /** インボイスの登録が無く、この月に支払がある人 */
  people: number;
  /** その人たちへの支払（委託料 ＋ 消費税相当額） */
  base: number;
  /** 仕入税額相当額（支払 × 10/110。1 人ずつ 1 円未満を切り捨てて足したもの） */
  creditable: number;
  current: BurdenStep | null;
  next: BurdenStep | null;
  /** 今の期間と、これからの期間 */
  steps: BurdenStep[];
};

/** 経過措置が終わったあと（控除できる割合 0）の期間の初日 */
const NO_DEDUCTION_FROM = (TRANSITIONAL_STEPS.find((s) => s.rate === 0) ?? TRANSITIONAL_STEPS[TRANSITIONAL_STEPS.length - 1]).from;

/**
 * この月の「登録が無い方への支払（委託料 ＋ 消費税相当額）」が同じまま続いたら、経過措置の期間ごとに会社の負担がいくらになるか。
 * 1 人ずつ nonDeductibleTax（日付つきの割合の表）で出して足す。明細の invoiceBurden と同じ出し方。
 */
export function futureBurden(drafts: StatementDraft[], month: string, taxMethod: string): FutureBurden {
  const judged = monthEnd(month.slice(0, 7));
  const affected = taxMethod === "general";
  const bases = drafts.filter((d) => !d.driver.invoiceRegistered && d.subtotal + d.tax > 0).map((d) => d.subtotal + d.tax);
  const burdenAt = (date: string) => (affected ? bases.reduce((sum, b) => sum + nonDeductibleTax(b, date), 0) : 0);

  const raw = TRANSITIONAL_STEPS.filter((step) => step.to === null || step.to >= judged).map((step) => {
    const isCurrent = step.from <= judged;
    // 今の期間はこの月の末日で、先の期間はその初日で割合を引く
    const monthly = burdenAt(isCurrent ? judged : step.from);
    return { from: step.from, to: step.to, label: periodLabel(step.from, step.to), deductibleRate: step.rate, monthly, yearly: monthly * 12, isCurrent };
  });
  const current = raw.find((r) => r.isCurrent) ?? null;
  const steps: BurdenStep[] = raw.map((r) => ({ ...r, diffMonthly: r.monthly - (current?.monthly ?? 0) }));
  const currentStep = steps.find((r) => r.isCurrent) ?? null;
  const nextIndex = currentStep ? steps.indexOf(currentStep) + 1 : 0;
  return {
    affected,
    people: bases.length,
    base: bases.reduce((a, b) => a + b, 0),
    creditable: bases.reduce((sum, b) => sum + nonDeductibleTax(b, NO_DEDUCTION_FROM), 0),
    current: currentStep,
    next: steps[nextIndex] && steps[nextIndex] !== currentStep ? steps[nextIndex] : null,
    steps,
  };
}
