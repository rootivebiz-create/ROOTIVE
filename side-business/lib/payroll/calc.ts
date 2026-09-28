import { roundYen, sum } from "./money";
import { monthEnd, nonDeductibleTax } from "./tax";
import type { Adjustment, Driver, MonthData, Project, WorkRow } from "./types";

export type StatementLine = {
  projectId: string;
  projectName: string;
  client: string;
  unit: string;
  qty: number;
  rate: number;
  amount: number;
};

export type Statement = {
  driver: Driver;
  lines: StatementLine[];
  /** 委託料（税抜）＝ Σ 支払単価 × 数量 */
  subtotal: number;
  /** 委託料にかかる消費税（免税の方に払わない設定なら 0） */
  tax: number;
  royalty: number;
  /** 管理費（稼働がある月だけ） */
  fee: number;
  /** 控除（ロイヤリティ＋管理費）にかかる消費税 */
  deductionTax: number;
  adjustments: Adjustment[];
  adjustmentTotal: number;
  /** 振込額 ＝ 委託料 ＋ 消費税 −（ロイヤリティ ＋ 管理費 ＋ その消費税）± 調整 */
  total: number;
  hasWork: boolean;
};

function linesFor(driver: Driver, data: MonthData, projects: Map<string, Project>): StatementLine[] {
  const byProject = new Map<string, number>();
  for (const row of data.work) {
    if (row.driverId !== driver.id || !(row.qty > 0)) continue;
    byProject.set(row.projectId, (byProject.get(row.projectId) ?? 0) + row.qty);
  }
  const lines: StatementLine[] = [];
  for (const [projectId, qty] of byProject) {
    const p = projects.get(projectId);
    if (!p) continue;
    lines.push({
      projectId,
      projectName: p.name,
      client: p.client,
      unit: p.unit,
      qty,
      rate: p.payRate,
      amount: roundYen(p.payRate * qty, data.settings.amountRounding),
    });
  }
  return lines.sort((a, b) => a.projectName.localeCompare(b.projectName, "ja"));
}

export function buildStatement(driver: Driver, data: MonthData): Statement {
  const s = data.settings;
  const projects = new Map(data.projects.map((p) => [p.id, p]));
  const lines = linesFor(driver, data, projects);
  const subtotal = sum(lines.map((l) => l.amount));
  const hasWork = lines.length > 0;
  const payTax = driver.invoiceRegistered || s.payTaxToExempt;
  const tax = payTax ? roundYen(subtotal * s.taxRate, s.taxRounding) : 0;
  const royalty = roundYen(subtotal * driver.royaltyRate, s.amountRounding);
  const fee = hasWork ? driver.monthlyFee : 0;
  const deductionTax = roundYen((royalty + fee) * s.taxRate, s.taxRounding);
  const adjustments = data.adjustments.filter((a) => a.driverId === driver.id && a.amount !== 0);
  const adjustmentTotal = sum(adjustments.map((a) => a.amount));
  const total = subtotal + tax - (royalty + fee + deductionTax) + adjustmentTotal;
  return { driver, lines, subtotal, tax, royalty, fee, deductionTax, adjustments, adjustmentTotal, total, hasWork };
}

export function buildStatements(data: MonthData): Statement[] {
  return data.drivers.map((d) => buildStatement(d, data)).filter((st) => st.hasWork || st.adjustmentTotal !== 0);
}

export type ProjectPL = {
  project: Project;
  qty: number;
  sales: number;
  cost: number;
  gross: number;
  /** 粗利率（売上 0 のときは null） */
  margin: number | null;
};

export type DriverPL = {
  driver: Driver;
  sales: number;
  cost: number;
  royaltyAndFee: number;
  /** 免税の方への支払で、会社が控除できずに負担する消費税 */
  invoiceCost: number;
  /** 会社に残る利益 ＝ 売上 − 委託料 ＋ ロイヤリティ・管理費 − 控除できない消費税 */
  profit: number;
  total: number;
};

export type ClientPL = { client: string; sales: number; cost: number; gross: number; margin: number | null };

export type MonthSummary = {
  sales: number;
  cost: number;
  royaltyAndFee: number;
  invoiceCost: number;
  profit: number;
  margin: number | null;
  payout: number;
  statements: Statement[];
  projects: ProjectPL[];
  drivers: DriverPL[];
  clients: ClientPL[];
  /** 経過措置の判定に使った日（対象月の末日） */
  judgedOn: string;
};

const margin = (gross: number, sales: number) => (sales === 0 ? null : gross / sales);

export function summarize(data: MonthData): MonthSummary {
  const s = data.settings;
  const judgedOn = monthEnd(s.month);
  const statements = buildStatements(data);
  const projectsById = new Map(data.projects.map((p) => [p.id, p]));

  const projectPL = new Map<string, ProjectPL>();
  for (const row of data.work) {
    const p = projectsById.get(row.projectId);
    if (!p || !(row.qty > 0) || !data.drivers.some((d) => d.id === row.driverId)) continue;
    const cur = projectPL.get(p.id) ?? { project: p, qty: 0, sales: 0, cost: 0, gross: 0, margin: null };
    cur.qty += row.qty;
    projectPL.set(p.id, cur);
  }
  for (const pl of projectPL.values()) {
    pl.sales = roundYen(pl.project.billRate * pl.qty, s.amountRounding);
    pl.cost = roundYen(pl.project.payRate * pl.qty, s.amountRounding);
    pl.gross = pl.sales - pl.cost;
    pl.margin = margin(pl.gross, pl.sales);
  }

  const drivers: DriverPL[] = statements.map((st) => {
    const sales = sum(
      st.lines.map((l) => roundYen((projectsById.get(l.projectId)?.billRate ?? 0) * l.qty, s.amountRounding)),
    );
    const royaltyAndFee = st.royalty + st.fee;
    const invoiceCost =
      s.taxMethod === "general" && !st.driver.invoiceRegistered ? nonDeductibleTax(st.subtotal + st.tax, judgedOn, s.taxRate) : 0;
    return {
      driver: st.driver,
      sales,
      cost: st.subtotal,
      royaltyAndFee,
      invoiceCost,
      profit: sales - st.subtotal + royaltyAndFee - invoiceCost,
      total: st.total,
    };
  });

  const clientMap = new Map<string, ClientPL>();
  for (const pl of projectPL.values()) {
    const c = clientMap.get(pl.project.client) ?? { client: pl.project.client, sales: 0, cost: 0, gross: 0, margin: null };
    c.sales += pl.sales;
    c.cost += pl.cost;
    c.gross += pl.gross;
    clientMap.set(pl.project.client, c);
  }
  for (const c of clientMap.values()) c.margin = margin(c.gross, c.sales);

  const sales = sum(drivers.map((d) => d.sales));
  const cost = sum(drivers.map((d) => d.cost));
  const royaltyAndFee = sum(drivers.map((d) => d.royaltyAndFee));
  const invoiceCost = sum(drivers.map((d) => d.invoiceCost));
  const profit = sales - cost + royaltyAndFee - invoiceCost;
  return {
    sales,
    cost,
    royaltyAndFee,
    invoiceCost,
    profit,
    margin: margin(profit, sales),
    payout: sum(statements.map((st) => st.total)),
    statements,
    projects: [...projectPL.values()].sort((a, b) => b.gross - a.gross),
    drivers: drivers.sort((a, b) => b.profit - a.profit),
    clients: [...clientMap.values()].sort((a, b) => b.gross - a.gross),
    judgedOn,
  };
}

/** 稼働行を足し合わせる（同じドライバー × 案件は 1 行にまとめる） */
export function mergeWork(rows: WorkRow[]): WorkRow[] {
  const map = new Map<string, WorkRow>();
  for (const r of rows) {
    const key = `${r.driverId}\u0000${r.projectId}`;
    const cur = map.get(key);
    if (cur) cur.qty = Math.round((cur.qty + r.qty) * 1e6) / 1e6;
    else map.set(key, { ...r });
  }
  return [...map.values()];
}
