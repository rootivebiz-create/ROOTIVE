/**
 * 案件別採算（/projects の「案件ごとの採算」）の純関数ヘルパー
 *
 * 数字は DB ビュー v_project_pl の値をそのまま使う（案件利益 ＝ 稼働の利益 − 直課経費、
 * 利益率・目標未達の判定もビューが計算する）。ここで行うのは表示用の整形と、
 * 合計（sumMoney で誤差なく足す）・並び替え・推移の 0 埋めだけ。
 *
 * 管理費・調整はドライバー単位のため案件には配賦していない。
 */
import type { ProjectPl } from "@/lib/db/types";
import { sumMoney } from "@/lib/calc";
import { addMonths, compareMonth, dateToMonth, monthRange } from "@/lib/month";

/** 推移の月数（直近 12 か月） */
export const TREND_MONTHS = 12;

/** 画面で扱う案件 × 月の採算（ビューの null を正規化したもの） */
export interface ProjectPlRow {
  projectId: string;
  /** "YYYY-MM" */
  month: string;
  projectName: string;
  clientName: string;
  clientId: string;
  isActive: boolean;
  sortOrder: number;
  /** 目標利益率（0.2 = 20%）。null = 判定しない */
  targetMargin: number | null;
  entryCount: number;
  driverCount: number;
  qtyTotal: number;
  bill: number;
  pay: number;
  margin: number;
  royalty: number;
  /** 稼働の利益 ＝ 単価差額利益 ＋ ロイヤリティ */
  entryProfit: number;
  /** 案件に紐づけた経費（税抜） */
  expenseDirect: number;
  expenseCount: number;
  /** 案件利益 ＝ 稼働の利益 − 直課経費 */
  projectProfit: number;
  /** 利益率 ＝ 案件利益 ÷ 売上（売上 0 なら 0） */
  projectMargin: number;
  belowTarget: boolean;
  closed: boolean;
}

export function toProjectRow(r: ProjectPl): ProjectPlRow {
  return {
    projectId: r.project_id ?? "",
    month: r.month ? dateToMonth(r.month) : "",
    projectName: r.project_name ?? "",
    clientName: r.client_name ?? "",
    clientId: r.client_id ?? "",
    isActive: r.project_is_active !== false,
    sortOrder: Number(r.project_sort_order ?? 0),
    targetMargin: r.target_margin == null ? null : Number(r.target_margin),
    entryCount: Number(r.entry_count ?? 0),
    driverCount: Number(r.driver_count ?? 0),
    qtyTotal: Number(r.qty_total ?? 0),
    bill: Number(r.bill ?? 0),
    pay: Number(r.pay ?? 0),
    margin: Number(r.margin ?? 0),
    royalty: Number(r.royalty ?? 0),
    entryProfit: Number(r.entry_profit ?? 0),
    expenseDirect: Number(r.expense_direct ?? 0),
    expenseCount: Number(r.expense_count ?? 0),
    projectProfit: Number(r.project_profit ?? 0),
    projectMargin: Number(r.project_margin ?? 0),
    belowTarget: r.below_target === true,
    closed: r.is_closed === true,
  };
}

/** 目標利益率の判定：目標なし・売上 0 は判定しない */
export type TargetJudgement = "none" | "ok" | "below";

export const TARGET_JUDGEMENT_LABELS: Record<TargetJudgement, string> = {
  none: "—",
  ok: "達成",
  below: "目標未達",
};

/** CSV 用の判定（「—」では意味が分からないため文字にする） */
export const TARGET_JUDGEMENT_CSV_LABELS: Record<TargetJudgement, string> = {
  none: "目標なし",
  ok: "達成",
  below: "目標未達",
};

export function judgeTarget(row: Pick<ProjectPlRow, "targetMargin" | "bill" | "belowTarget">): TargetJudgement {
  if (row.targetMargin == null || row.bill === 0) return "none";
  return row.belowTarget ? "below" : "ok";
}

/** 利益率の高い順（同率は売上の多い順 → 案件名）。元の配列は変更しない */
export function sortByMargin(rows: ProjectPlRow[]): ProjectPlRow[] {
  return [...rows].sort((a, b) => {
    if (a.projectMargin !== b.projectMargin) return b.projectMargin - a.projectMargin;
    if (a.bill !== b.bill) return b.bill - a.bill;
    return a.projectName.localeCompare(b.projectName, "ja");
  });
}

export interface ProjectPlTotals {
  projectCount: number;
  entryCount: number;
  expenseCount: number;
  qtyTotal: number;
  bill: number;
  pay: number;
  margin: number;
  royalty: number;
  entryProfit: number;
  expenseDirect: number;
  projectProfit: number;
  /** 合計の利益率 ＝ 案件利益の合計 ÷ 売上の合計（売上 0 なら 0） */
  projectMargin: number;
  belowTargetCount: number;
}

/** 合計行（金額は sumMoney、件数は単純な足し算） */
export function sumProjectRows(rows: ProjectPlRow[]): ProjectPlTotals {
  const bill = sumMoney(rows.map((r) => r.bill));
  const projectProfit = sumMoney(rows.map((r) => r.projectProfit));
  return {
    projectCount: rows.length,
    entryCount: rows.reduce((a, r) => a + r.entryCount, 0),
    expenseCount: rows.reduce((a, r) => a + r.expenseCount, 0),
    qtyTotal: sumMoney(rows.map((r) => r.qtyTotal)),
    bill,
    pay: sumMoney(rows.map((r) => r.pay)),
    margin: sumMoney(rows.map((r) => r.margin)),
    royalty: sumMoney(rows.map((r) => r.royalty)),
    entryProfit: sumMoney(rows.map((r) => r.entryProfit)),
    expenseDirect: sumMoney(rows.map((r) => r.expenseDirect)),
    projectProfit,
    projectMargin: bill !== 0 ? projectProfit / bill : 0,
    belowTargetCount: belowTargetCount(rows),
  };
}

/** 目標利益率を下回っている案件の件数 */
export function belowTargetCount(rows: ProjectPlRow[]): number {
  return rows.filter((r) => judgeTarget(r) === "below").length;
}

/** 推移の 1 点（データの無い月は 0 埋め） */
export interface ProjectTrendPoint {
  /** "YYYY-MM" */
  month: string;
  bill: number;
  projectProfit: number;
  projectMargin: number;
  expenseDirect: number;
  entryCount: number;
  /** その月に行があるか（無い月は「—」表示） */
  hasData: boolean;
}

/** 稼動月で終わる直近 count か月（古い順） */
export function trendMonths(month: string, count: number = TREND_MONTHS): string[] {
  return monthRange(addMonths(month, -(count - 1)), month);
}

/**
 * 案件の推移（既定は行のある最新の月で終わる 12 か月）。欠けている月は 0 埋め
 * months を渡すとその月だけを（渡した順で）返す
 */
export function toTrend(rows: ProjectPlRow[], projectId: string, months?: string[]): ProjectTrendPoint[] {
  const mine = rows.filter((r) => r.projectId === projectId && r.month !== "");
  const byMonth = new Map(mine.map((r) => [r.month, r]));
  const list = months ?? (mine.length > 0 ? trendMonths(mine.map((r) => r.month).reduce((a, b) => (compareMonth(a, b) >= 0 ? a : b))) : []);
  return list.map((m) => {
    const r = byMonth.get(m);
    return {
      month: m,
      bill: r?.bill ?? 0,
      projectProfit: r?.projectProfit ?? 0,
      projectMargin: r?.projectMargin ?? 0,
      expenseDirect: r?.expenseDirect ?? 0,
      entryCount: r?.entryCount ?? 0,
      hasData: r != null,
    };
  });
}
