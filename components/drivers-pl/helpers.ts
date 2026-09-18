/**
 * ドライバー別の採算（/drivers-pl）の集計（純関数。React に依存しない。テスト・CSV 出力からも使う）
 *
 * 金額は DB ビュー（v_driver_month_summary / v_work_entry_calc）の値をそのまま使い、
 * 合計は sumMoney で足し合わせるだけにする（独自の丸め・再計算はしない）。
 * シミュレーションに渡す入力（SimDriver）もここで組み立てる（計算そのものは lib/calc/simulate.ts）。
 */
import type { DriverMonthSummary, WorkEntryCalc } from "@/lib/db/types";
import type { AdjustmentInput, EntryInput, RoundingMode, SimDriver, TaxInput, TaxMode, Unit } from "@/lib/calc";
import { subMoney, sumMoney } from "@/lib/calc";
import { dateToMonth } from "@/lib/month";

/** 一覧の 1 行（ドライバー × 月） */
export interface DriverPlRow {
  driverId: string;
  driverName: string;
  driverSortOrder: number;
  isActive: boolean;
  /** 支払単価 0 の行だけで構成される（役員・オーナー本人。利益率が 100% になるため注記する） */
  isOwner: boolean;
  /** "YYYY-MM" */
  month: string;
  entryCount: number;
  /** 数量 > 0 の稼働行の件数（管理費・1 稼働あたりの利益の基準） */
  activeEntryCount: number;
  /** 稼働量（数量の合計） */
  qtyTotal: number;
  bill: number;
  pay: number;
  margin: number;
  royalty: number;
  mgmtFee: number;
  adjustmentCount: number;
  adjPay: number;
  adjProfit: number;
  payout: number;
  tax: number;
  payoutIncl: number;
  /** 会社利益（driver_profit） */
  profit: number;
  /** 利益率 ＝ 会社利益 ÷ 売上（売上 0 なら 0） */
  profitRate: number;
  /** 1 稼働あたりの利益 ＝ 会社利益 ÷ 数量 > 0 の行数（0 件なら null ＝「—」） */
  profitPerEntry: number | null;
  /** 稼働行か調整がある（0 だけの行は一覧に出さない） */
  hasData: boolean;
}

/** 合計行 */
export interface DriverPlTotals {
  driverCount: number;
  entryCount: number;
  activeEntryCount: number;
  qtyTotal: number;
  bill: number;
  pay: number;
  margin: number;
  royalty: number;
  mgmtFee: number;
  adjPay: number;
  payout: number;
  tax: number;
  payoutIncl: number;
  profit: number;
  profitRate: number;
  profitPerEntry: number | null;
}

/** 12 か月の推移の 1 点 */
export interface DriverTrendPoint {
  /** "YYYY-MM" */
  month: string;
  bill: number;
  profit: number;
  profitRate: number;
  entryCount: number;
  payoutIncl: number;
  /** その月に稼働行・調整があるか */
  hasData: boolean;
}

/** 稼働の内訳の 1 行 */
export interface DriverEntryRow {
  id: string;
  projectName: string;
  itemName: string;
  unit: Unit;
  qty: number;
  billRate: number;
  payRate: number;
  royaltyRate: number;
  bill: number;
  pay: number;
  margin: number;
  royalty: number;
  entryProfit: number;
}

function num(v: number | null | undefined): number {
  const n = Number(v ?? 0);
  return Number.isFinite(n) ? n : 0;
}

function byName(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

/** 案件（内容）の表示名：内容が「標準」なら案件名だけ */
export function entryLabel(r: Pick<DriverEntryRow, "projectName" | "itemName">): string {
  return r.itemName && r.itemName !== "標準" ? `${r.projectName}（${r.itemName}）` : r.projectName;
}

// ---------------------------------------------------------------------------
// 計算・シミュレーションへの入力
// ---------------------------------------------------------------------------

/** v_work_entry_calc の 1 行 → 計算入力（スナップショット済みの単価・率） */
export function toEntryInput(e: WorkEntryCalc): EntryInput {
  return {
    qty: num(e.qty),
    billRate: num(e.bill_rate),
    payRate: num(e.pay_rate),
    royaltyRate: num(e.royalty_rate),
    roundingMode: (e.rounding_mode ?? "none") as RoundingMode,
  };
}

/** v_driver_month_summary の税の条件（締め済み月は締めた時点の値が入っている） */
export function toTaxInput(s: DriverMonthSummary): TaxInput {
  return {
    mode: (s.tax_mode ?? "taxable") as TaxMode,
    rate: num(s.tax_rate),
    rounding: (s.tax_rounding ?? "floor") as RoundingMode,
  };
}

/**
 * 調整の復元：ビューは合計（adj_pay ＝ Σamount、adj_profit ＝ Σ(利益計上の −amount)）しか持たないため、
 * 「利益計上あり」「利益計上なし」の 2 件にまとめ直して calcDriverMonth に渡す（合計は一致する）。
 */
export function toAdjustmentInputs(adjPay: number, adjProfit: number): AdjustmentInput[] {
  const profitAmount = -adjProfit;
  const plainAmount = subMoney(adjPay, profitAmount);
  const out: AdjustmentInput[] = [];
  if (profitAmount !== 0) out.push({ amount: profitAmount, countAsProfit: true });
  if (plainAmount !== 0) out.push({ amount: plainAmount, countAsProfit: false });
  return out;
}

/** 稼働行をドライバーごとに束ねる */
function groupEntriesByDriver(entries: WorkEntryCalc[]): Map<string, WorkEntryCalc[]> {
  const map = new Map<string, WorkEntryCalc[]>();
  for (const e of entries) {
    const key = e.driver_id ?? "";
    const g = map.get(key);
    if (g) g.push(e);
    else map.set(key, [e]);
  }
  return map;
}

/** 支払単価 0 の行だけで構成されるか（役員・オーナー本人の判定。稼働行が無ければ false） */
export function isOwnerEntries(entries: WorkEntryCalc[]): boolean {
  return entries.length > 0 && entries.every((e) => num(e.pay_rate) === 0);
}

/** シミュレーションの入力（ドライバー × 月）。締め済み月も試算だけはできる */
export function buildSimDrivers(summaries: DriverMonthSummary[], entries: WorkEntryCalc[]): SimDriver[] {
  const byDriver = groupEntriesByDriver(entries);
  return summaries.map((s) => {
    const driverId = s.driver_id ?? "";
    return {
      driverId,
      driverName: s.driver_name ?? "",
      entries: (byDriver.get(driverId) ?? []).map(toEntryInput),
      driverMonth: {
        mgmtFee: num(s.mgmt_fee_setting),
        adjustments: toAdjustmentInputs(num(s.adj_pay), num(s.adj_profit)),
        tax: toTaxInput(s),
      },
    };
  });
}

// ---------------------------------------------------------------------------
// 一覧
// ---------------------------------------------------------------------------

/** v_driver_month_summary ＋ 当月の稼働行 → 一覧の行（会社利益の多い順） */
export function buildDriverPlRows(summaries: DriverMonthSummary[], entries: WorkEntryCalc[]): DriverPlRow[] {
  const byDriver = groupEntriesByDriver(entries);
  const rows = summaries.map((s) => {
    const driverId = s.driver_id ?? "";
    const own = byDriver.get(driverId) ?? [];
    const bill = num(s.bill);
    const profit = num(s.driver_profit);
    const entryCount = num(s.entry_count);
    const activeEntryCount = num(s.active_entry_count);
    const adjustmentCount = num(s.adjustment_count);
    return {
      driverId,
      driverName: s.driver_name ?? "",
      driverSortOrder: num(s.driver_sort_order),
      isActive: s.driver_is_active ?? true,
      isOwner: isOwnerEntries(own),
      month: s.month ? dateToMonth(String(s.month)) : "",
      entryCount,
      activeEntryCount,
      qtyTotal: sumMoney(own.map((e) => num(e.qty))),
      bill,
      pay: num(s.pay),
      margin: num(s.margin),
      royalty: num(s.royalty),
      mgmtFee: num(s.mgmt_fee),
      adjustmentCount,
      adjPay: num(s.adj_pay),
      adjProfit: num(s.adj_profit),
      payout: num(s.payout),
      tax: num(s.tax),
      payoutIncl: num(s.payout_incl),
      profit,
      profitRate: bill !== 0 ? profit / bill : 0,
      profitPerEntry: activeEntryCount > 0 ? profit / activeEntryCount : null,
      hasData: entryCount > 0 || adjustmentCount > 0,
    };
  });
  return sortDriverPlRows(rows);
}

/** 会社利益の降順（同額なら売上の降順 → 並び順 → 名前） */
export function sortDriverPlRows(rows: DriverPlRow[]): DriverPlRow[] {
  return [...rows].sort((a, b) => {
    if (a.profit !== b.profit) return b.profit - a.profit;
    if (a.bill !== b.bill) return b.bill - a.bill;
    if (a.driverSortOrder !== b.driverSortOrder) return a.driverSortOrder - b.driverSortOrder;
    return byName(a.driverName, b.driverName);
  });
}

/** 一覧に出す行：データのある行だけ。停止中は includeInactive のときだけ */
export function visibleDriverPlRows(rows: DriverPlRow[], opts: { includeInactive?: boolean } = {}): DriverPlRow[] {
  return rows.filter((r) => r.hasData && (opts.includeInactive || r.isActive));
}

/** 隠れている停止中のドライバーの人数（「停止中も表示」の案内用） */
export function hiddenInactiveCount(rows: DriverPlRow[]): number {
  return rows.filter((r) => r.hasData && !r.isActive).length;
}

/** 合計（金額は sumMoney、利益率は合計どうしの比） */
export function sumDriverPlRows(rows: DriverPlRow[]): DriverPlTotals {
  const sum = (pick: (r: DriverPlRow) => number) => sumMoney(rows.map(pick));
  const count = (pick: (r: DriverPlRow) => number) => rows.reduce((a, r) => a + pick(r), 0);
  const bill = sum((r) => r.bill);
  const profit = sum((r) => r.profit);
  const activeEntryCount = count((r) => r.activeEntryCount);
  return {
    driverCount: rows.length,
    entryCount: count((r) => r.entryCount),
    activeEntryCount,
    qtyTotal: sum((r) => r.qtyTotal),
    bill,
    pay: sum((r) => r.pay),
    margin: sum((r) => r.margin),
    royalty: sum((r) => r.royalty),
    mgmtFee: sum((r) => r.mgmtFee),
    adjPay: sum((r) => r.adjPay),
    payout: sum((r) => r.payout),
    tax: sum((r) => r.tax),
    payoutIncl: sum((r) => r.payoutIncl),
    profit,
    profitRate: bill !== 0 ? profit / bill : 0,
    profitPerEntry: activeEntryCount > 0 ? profit / activeEntryCount : null,
  };
}

/** 状態の表示（CSV・一覧で共用） */
export function driverStateLabel(r: Pick<DriverPlRow, "isActive" | "isOwner">): string {
  if (r.isOwner) return "役員・オーナー";
  return r.isActive ? "稼働中" : "停止中";
}

/** 役員・オーナーの注記を出すか（利益率 100%・支払 0 になるため） */
export function hasOwnerRow(rows: DriverPlRow[]): boolean {
  return rows.some((r) => r.isOwner);
}

// ---------------------------------------------------------------------------
// 12 か月の推移・稼働の内訳
// ---------------------------------------------------------------------------

/** 指定ドライバーの推移（months の順。データが無い月は 0 埋め） */
export function driverTrend(summaries: DriverMonthSummary[], driverId: string, months: string[]): DriverTrendPoint[] {
  const byMonth = new Map<string, DriverMonthSummary>();
  for (const s of summaries) {
    if ((s.driver_id ?? "") !== driverId || !s.month) continue;
    byMonth.set(dateToMonth(String(s.month)), s);
  }
  return months.map((month) => {
    const s = byMonth.get(month);
    const bill = num(s?.bill);
    const profit = num(s?.driver_profit);
    const entryCount = num(s?.entry_count);
    return {
      month,
      bill,
      profit,
      profitRate: bill !== 0 ? profit / bill : 0,
      entryCount,
      payoutIncl: num(s?.payout_incl),
      hasData: Boolean(s) && (entryCount > 0 || num(s?.adjustment_count) > 0),
    };
  });
}

/** 推移のグラフ・棒の基準になる最大値（売上と会社利益の絶対値の最大。0 なら 0） */
export function trendScale(points: DriverTrendPoint[]): number {
  return points.reduce((a, p) => Math.max(a, Math.abs(p.bill), Math.abs(p.profit)), 0);
}

/** 指定ドライバーの当月の稼働行（案件・内容の順） */
export function driverEntryRows(entries: WorkEntryCalc[], driverId: string): DriverEntryRow[] {
  return entries
    .filter((e) => (e.driver_id ?? "") === driverId)
    .map((e) => ({
      id: e.id ?? "",
      projectName: e.project_name ?? "",
      itemName: e.item_name ?? "",
      unit: (e.unit ?? "day") as Unit,
      qty: num(e.qty),
      billRate: num(e.bill_rate),
      payRate: num(e.pay_rate),
      royaltyRate: num(e.royalty_rate),
      bill: num(e.bill),
      pay: num(e.pay),
      margin: num(e.margin),
      royalty: num(e.royalty),
      entryProfit: num(e.entry_profit),
    }))
    .sort((a, b) => byName(a.projectName, b.projectName) || byName(a.itemName, b.itemName) || byName(a.id, b.id));
}

/** 既定で選ぶドライバー（一覧の先頭 ＝ 会社利益が最も多い人）。?driver= の指定があればそれを優先 */
export function resolveSelectedDriver(rows: DriverPlRow[], requested: string | null | undefined): string {
  if (requested && rows.some((r) => r.driverId === requested)) return requested;
  return rows[0]?.driverId ?? "";
}
