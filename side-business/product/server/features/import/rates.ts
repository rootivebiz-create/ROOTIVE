/**
 * 取り込み：単価・金額の列から、人ごとの支払単価を読む（純関数。DB に触らない）。
 * 同じ案件でも人によって単価が違う会社は、Excel の「単価」（または 金額 ÷ 数量）の列に答えがある。
 * 台帳の単価（人ごとの単価 → 案件の支払単価）と違う人を「人ごとの単価」の下書きとして出す（決めるのは会社）。
 * 行ごとに単価が違う人（段階制・最低保証 など）は、下書きにせず知らせるだけ（今の計算は 単価 × 数量 だけのため）。
 */
import { isBlankRow, isTotalRow, parseNumberCell } from "~/server/tabular";
import { findRateColumns } from "./columns";
import { colLetter } from "./detect";
import type { WorkMapping } from "./types";

export type RateProposal = {
  driverId: string;
  driverName: string;
  projectId: string;
  projectName: string;
  unit: string;
  /** Excel の単価 */
  rate: number;
  /** 今の台帳の単価（人ごとの単価があればそれ、無ければ案件の支払単価） */
  current: number;
  /** 人ごとの単価がもうあるか */
  hasOverride: boolean;
  rows: number;
};

export type RateFinding = {
  col: number;
  header: string;
  kind: "rate" | "amount";
  /** 台帳と違い、行ごとには同じ単価の人（下書き） */
  proposals: RateProposal[];
  /** 台帳と同じだった人 × 案件の数 */
  matched: number;
  /** 同じ人・同じ案件で、行ごとに単価が違う（段階制・最低保証・日額と歩合 など。今の計算では表せない） */
  varying: { driverName: string; projectName: string; rates: number[] }[];
  /** 受注単価（元請からの単価）と同じ値ばかり：支払の単価ではないとみなし、下書きを出さない */
  billLike: boolean;
  unreadable: string[];
};

type Rec = { rowNo: number; driverId: string; projectId: string; qty: number };
type ProjectInfo = { id: string; name: string; unit: string; payRate: number; billRate: number };

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

const same = (a: number, b: number) => Math.abs(a - b) < 0.005;

/**
 * 単価・金額の列を読む。resolved は当たった行（行番号・人・案件・数量）。
 * 1 行に 1 人 × 1 案件の行だけを見る（案件が横に並ぶ表の行は、どの案件の単価か分からないので見ない）
 */
export function readRateColumns(input: {
  rows: string[][];
  mapping: WorkMapping;
  header: string[];
  resolved: Rec[];
  projects: ProjectInfo[];
  overrides: { driverId: string; projectId: string; payRate: number }[];
  names: Map<string, string>;
}): RateFinding[] {
  const { rows, mapping, header } = input;
  const cols = findRateColumns(header, mapping.roles);
  if (cols.length === 0) return [];
  // 行ごとに、1 人 × 1 案件と数量の合計
  const byRow = new Map<number, { driverId: string; projectId: string; qty: number; mixed: boolean }>();
  for (const r of input.resolved) {
    const x = byRow.get(r.rowNo);
    if (!x) byRow.set(r.rowNo, { driverId: r.driverId, projectId: r.projectId, qty: r.qty, mixed: false });
    else {
      if (x.driverId !== r.driverId || x.projectId !== r.projectId) x.mixed = true;
      x.qty += r.qty;
    }
  }
  const projects = new Map(input.projects.map((p) => [p.id, p]));
  const override = new Map(input.overrides.map((o) => [`${o.driverId}:${o.projectId}`, o.payRate]));
  const out: RateFinding[] = [];
  for (const c of cols) {
    const pairs = new Map<string, { driverId: string; projectId: string; rates: number[] }>();
    const unreadable: string[] = [];
    for (const [rowNo, x] of byRow) {
      const row = rows[rowNo - 1];
      if (!row || x.mixed || isBlankRow(row) || isTotalRow(row) || rowNo <= mapping.headerRow + mapping.headerDepth) continue;
      const raw = (row[c.col] ?? "").trim();
      if (!raw) continue;
      const v = parseNumberCell(raw);
      if (v === null) {
        unreadable.push(`${colLetter(c.col)}${rowNo}`);
        continue;
      }
      if (v <= 0) continue;
      const rate = c.kind === "rate" ? round2(v) : x.qty > 0 ? round2(v / x.qty) : null;
      if (rate === null) continue;
      const key = `${x.driverId}:${x.projectId}`;
      const p = pairs.get(key) ?? { driverId: x.driverId, projectId: x.projectId, rates: [] };
      p.rates.push(rate);
      pairs.set(key, p);
    }
    const proposals: RateProposal[] = [];
    const varying: RateFinding["varying"] = [];
    let matched = 0;
    let bill = 0;
    for (const [key, p] of pairs) {
      const proj = projects.get(p.projectId);
      if (!proj) continue;
      const distinct = [...new Set(p.rates)].sort((a, b) => a - b);
      const driverName = input.names.get(p.driverId) ?? "";
      if (distinct.length > 1) {
        varying.push({ driverName, projectName: proj.name, rates: distinct });
        continue;
      }
      const rate = distinct[0];
      const own = override.get(key);
      const current = own ?? proj.payRate;
      if (same(rate, current)) {
        matched++;
        continue;
      }
      if (same(rate, proj.billRate) && !same(proj.billRate, proj.payRate)) bill++;
      proposals.push({
        driverId: p.driverId,
        driverName,
        projectId: p.projectId,
        projectName: proj.name,
        unit: proj.unit,
        rate,
        current,
        hasOverride: own !== undefined,
        rows: p.rates.length,
      });
    }
    const total = matched + proposals.length;
    // 受注単価と同じ値ばかりなら、元請からの単価の列（支払の単価ではない）
    const billLike = total > 0 && bill * 2 >= total && bill > 0;
    out.push({
      col: c.col,
      header: c.header,
      kind: c.kind,
      proposals: billLike ? [] : proposals.sort((a, b) => a.driverName.localeCompare(b.driverName, "ja") || a.projectName.localeCompare(b.projectName, "ja")),
      matched,
      varying: varying.sort((a, b) => a.driverName.localeCompare(b.driverName, "ja")),
      billLike,
      unreadable,
    });
  }
  return out.filter((f) => f.proposals.length > 0 || f.matched > 0 || f.varying.length > 0 || f.billLike);
}

/** 採用するときに選んだ下書きの鍵（人 × 案件） */
export function rateKey(p: { driverId: string; projectId: string }): string {
  return `${p.driverId}:${p.projectId}`;
}
