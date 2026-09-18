import { dateToMonth, isMonthKey } from "@/lib/month";

/** driver_portal_months() の 1 行（お支払額は税込 payout_incl。未締め月は null） */
export interface PortalMonthRow {
  /** "YYYY-MM" */
  month: string;
  status: "open" | "closed";
  payoutIncl: number | null;
  payout: number | null;
  tax: number | null;
  closedAt: string | null;
}

/** 年間サマリー（締め済み月だけを合計する） */
export interface PortalYearSummary {
  year: number;
  label: string;
  /** その年の月（降順）。未締め月も含む */
  months: PortalMonthRow[];
  closedCount: number;
  openCount: number;
  /** 締め済み月の税込お支払額の合計 */
  totalPayoutIncl: number;
  /** 締め済み月の消費税の合計 */
  totalTax: number;
  /** 締め済み月の 1 か月あたりの平均（締め済みが 0 件なら 0） */
  averagePayoutIncl: number;
}

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => typeof v === "object" && v !== null && !Array.isArray(v);
const num = (v: unknown): number => {
  const n = typeof v === "number" ? v : typeof v === "string" ? Number(v) : 0;
  return Number.isFinite(n) ? n : 0;
};
const numOrNull = (v: unknown): number | null => (v == null || v === "" ? null : num(v));
const strOrNull = (v: unknown): string | null => (v == null || v === "" ? null : String(v));

/** RPC driver_portal_months() の結果を安全に行へ変換する（月が無い行は捨てる） */
export function toPortalMonthRows(rows: readonly unknown[] | null | undefined): PortalMonthRow[] {
  if (!Array.isArray(rows)) return [];
  const out: PortalMonthRow[] = [];
  for (const r of rows) {
    if (!isObj(r)) continue;
    const raw = typeof r.month === "string" ? r.month : "";
    const month = dateToMonth(raw);
    if (!isMonthKey(month)) continue;
    out.push({
      month,
      status: r.status === "closed" ? "closed" : "open",
      payoutIncl: numOrNull(r.payout_incl),
      payout: numOrNull(r.payout),
      tax: numOrNull(r.tax),
      closedAt: strOrNull(r.closed_at),
    });
  }
  return out;
}

/** 年ごとの集計（年は降順、年の中の月も降順。合計は締め済み月のみ） */
export function summarizeYears(rows: readonly PortalMonthRow[]): PortalYearSummary[] {
  const byYear = new Map<number, PortalMonthRow[]>();
  for (const r of rows) {
    if (!isMonthKey(r.month)) continue;
    const year = Number(r.month.slice(0, 4));
    const list = byYear.get(year);
    if (list) list.push(r);
    else byYear.set(year, [r]);
  }
  return [...byYear.entries()]
    .sort((a, b) => b[0] - a[0])
    .map(([year, list]) => {
      const months = [...list].sort((a, b) => (a.month < b.month ? 1 : a.month > b.month ? -1 : 0));
      const closed = months.filter((m) => m.status === "closed");
      const totalPayoutIncl = closed.reduce((s, m) => s + (m.payoutIncl ?? 0), 0);
      const totalTax = closed.reduce((s, m) => s + (m.tax ?? 0), 0);
      return {
        year,
        label: `${year}年`,
        months,
        closedCount: closed.length,
        openCount: months.length - closed.length,
        totalPayoutIncl,
        totalTax,
        averagePayoutIncl: closed.length === 0 ? 0 : totalPayoutIncl / closed.length,
      };
    });
}

/** RPC driver_portal_current() の JSON（未締め月の暫定額。会社設定が off・対象無しなら null） */
export interface PortalCurrent {
  /** "YYYY-MM" */
  month: string;
  entryCount: number;
  pay: number;
  royalty: number;
  mgmtFee: number;
  adjPay: number;
  /** 税抜 */
  payout: number;
  tax: number;
  /** 税込（お支払予定額） */
  payoutIncl: number;
  /** "YYYY-MM-DD" */
  payoutDate: string | null;
  updatedAt: string | null;
}

/** RPC の JSON を安全に型へ変換する（null・欠損・文字列の数値に耐える） */
export function parsePortalCurrent(json: unknown): PortalCurrent | null {
  if (!isObj(json)) return null;
  const month = dateToMonth(typeof json.month === "string" ? json.month : "");
  if (!isMonthKey(month)) return null;
  const payoutDate = strOrNull(json.payout_date);
  return {
    month,
    entryCount: num(json.entry_count),
    pay: num(json.pay),
    royalty: num(json.royalty),
    mgmtFee: num(json.mgmt_fee),
    adjPay: num(json.adj_pay),
    payout: num(json.payout),
    tax: num(json.tax),
    payoutIncl: json.payout_incl == null ? num(json.payout) : num(json.payout_incl),
    payoutDate: payoutDate && /^\d{4}-\d{2}-\d{2}$/.test(payoutDate) ? payoutDate : null,
    updatedAt: strOrNull(json.updated_at),
  };
}
