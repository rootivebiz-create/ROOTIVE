/**
 * 同じドライバーの 2 つの月の明細を並べる（純関数。DB に触らない）。ドライバーの画面の「先月との比べ」に使う。
 * 比べるのはドライバーに見せる形（DriverStatementView）の数字だけ（会社の売上・受注の単価は入らない）。
 */
import { jpMonthLabel, type DriverStatementView } from "~/server/features/statements/view";

export type CompareAmount = { before: number; after: number; diff: number };

export type CompareQtyRow = {
  /** 案件の目印（明細の行の key） */
  key: string;
  project: string;
  unit: string;
  /** その月に稼働が無ければ null */
  before: number | null;
  after: number | null;
  diff: number;
};

export type MonthCompare = {
  prevMonth: string;
  prevLabel: string;
  curLabel: string;
  /** お振込額 */
  total: CompareAmount;
  /** 委託料（税抜） */
  subtotal: CompareAmount;
  /** 引かれているもの（消費税を含む） */
  deductions: CompareAmount;
  /** 案件ごとの数量（今月の並び → 先月だけの案件） */
  qty: CompareQtyRow[];
};

/** 数量の差（保存と同じ小数 4 桁まで。0.1 + 0.2 のような誤差を見せない） */
function qtyDiff(after: number, before: number): number {
  return Math.round((after - before) * 10_000) / 10_000;
}

function amount(before: number, after: number): CompareAmount {
  return { before, after, diff: after - before };
}

export function compareMonths(prev: DriverStatementView, cur: DriverStatementView): MonthCompare {
  const before = new Map(prev.lines.map((l) => [l.key, l]));
  const seen = new Set<string>();
  const qty: CompareQtyRow[] = [];
  for (const l of cur.lines) {
    seen.add(l.key);
    const p = before.get(l.key);
    qty.push({ key: l.key, project: l.project, unit: l.unit, before: p ? p.qty : null, after: l.qty, diff: qtyDiff(l.qty, p?.qty ?? 0) });
  }
  for (const p of prev.lines) {
    if (seen.has(p.key)) continue;
    qty.push({ key: p.key, project: p.project, unit: p.unit, before: p.qty, after: null, diff: qtyDiff(0, p.qty) });
  }
  return {
    prevMonth: prev.month,
    prevLabel: jpMonthLabel(prev.month),
    curLabel: jpMonthLabel(cur.month),
    total: amount(prev.total, cur.total),
    subtotal: amount(prev.subtotal, cur.subtotal),
    deductions: amount(prev.deductionTotal + prev.deductionTax, cur.deductionTotal + cur.deductionTax),
    qty,
  };
}
