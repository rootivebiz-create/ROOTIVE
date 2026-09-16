/**
 * 支払明細データの組み立て（支払明細画面・印刷ページ・PDF・CSV・テキストコピー・ドライバーポータルで共用）
 */
import type { ServerSupabase } from "@/lib/supabase/server";
import type { Company, DriverMonthSummary, WorkEntryCalc, Adjustment } from "@/lib/db/types";
import { monthToDate, payoutDate, formatMonthJa, formatDateJa } from "@/lib/month";
import { yen, pct, qty as qtyText } from "@/lib/format";
import { UNIT_LABELS } from "@/lib/calc/types";

export interface StatementEntry {
  id: string;
  projectName: string;
  itemName: string;
  unit: "day" | "piece";
  qty: number;
  payRate: number;
  pay: number;
  billRate: number;
  bill: number;
  margin: number;
  royaltyRate: number;
  royalty: number;
  entryProfit: number;
  memo: string;
}

export interface StatementAdjustment {
  id: string;
  label: string;
  amount: number;
  countAsProfit: boolean;
  /** 固定控除から複写された場合の driver_recurring_adjustments.id */
  recurringId: string | null;
  sortOrder: number;
}

export interface StatementData {
  month: string; // YYYY-MM
  monthLabel: string; // 2026年9月
  driverId: string;
  driverName: string;
  company: Pick<Company, "name" | "address" | "tel" | "invoice_reg_no" | "statement_note" | "payout_month_offset" | "payout_day">;
  payoutDate: string; // YYYY-MM-DD
  payoutDateLabel: string;
  issuedAt: string; // YYYY-MM-DD（今日）
  entries: StatementEntry[];
  adjustments: StatementAdjustment[];
  pay: number;
  royalty: number;
  mgmtFee: number;
  mgmtFeeSetting: number;
  driverDefaultMgmtFee: number;
  adjPay: number;
  adjProfit: number;
  payout: number;
  /** 会社側の内訳（ドライバーには見せない） */
  bill: number;
  margin: number;
  driverProfit: number;
  profitRate: number;
  isClosed: boolean;
  driverMonthId: string | null;
  memo: string;
  /** ロイヤリティ率が 1 種類ならその率（明細の表示用） */
  royaltyRate: number | null;
}

function todayJST(): string {
  const jst = new Date(Date.now() + 9 * 60 * 60 * 1000);
  return jst.toISOString().slice(0, 10);
}

/** 集計ビューと稼働行から明細データを組み立てる（スタッフ用。RLS により driver ロールでは締め済みの自分の月のみ取得できる） */
export async function loadStatementData(supabase: ServerSupabase, company: Company, month: string, driverId: string): Promise<StatementData | null> {
  const monthDate = monthToDate(month);
  const [summaryRes, entriesRes, driverRes] = await Promise.all([
    supabase.from("v_driver_month_summary").select("*").eq("company_id", company.id).eq("month", monthDate).eq("driver_id", driverId).maybeSingle(),
    supabase.from("v_work_entry_calc").select("*").eq("company_id", company.id).eq("month", monthDate).eq("driver_id", driverId).order("created_at"),
    supabase.from("drivers").select("id, name, mgmt_fee").eq("id", driverId).maybeSingle(),
  ]);
  if (summaryRes.error) throw summaryRes.error;
  if (entriesRes.error) throw entriesRes.error;
  if (driverRes.error) throw driverRes.error;
  const driver = driverRes.data;
  if (!driver) return null;
  const summary: DriverMonthSummary | null = summaryRes.data;
  let adjustments: Adjustment[] = [];
  if (summary?.driver_month_id) {
    const adjRes = await supabase.from("adjustments").select("*").eq("driver_month_id", summary.driver_month_id).order("sort_order").order("created_at");
    if (adjRes.error) throw adjRes.error;
    adjustments = adjRes.data ?? [];
  }
  return buildStatementData({ company, month, driver: { id: driver.id, name: driver.name, mgmt_fee: driver.mgmt_fee }, summary, entries: entriesRes.data ?? [], adjustments });
}

export function buildStatementData(input: {
  company: Company;
  month: string;
  driver: { id: string; name: string; mgmt_fee: number };
  summary: DriverMonthSummary | null;
  entries: WorkEntryCalc[];
  adjustments: Adjustment[];
}): StatementData {
  const { company, month, driver, summary, entries, adjustments } = input;
  const pd = payoutDate(month, company.payout_month_offset, company.payout_day);
  const rates = new Set(entries.map((e) => Number(e.royalty_rate ?? 0)));
  return {
    month,
    monthLabel: formatMonthJa(month),
    driverId: driver.id,
    driverName: driver.name,
    company: {
      name: company.name,
      address: company.address,
      tel: company.tel,
      invoice_reg_no: company.invoice_reg_no,
      statement_note: company.statement_note,
      payout_month_offset: company.payout_month_offset,
      payout_day: company.payout_day,
    },
    payoutDate: pd,
    payoutDateLabel: formatDateJa(pd),
    issuedAt: todayJST(),
    entries: entries.map((e) => ({
      id: e.id ?? "",
      projectName: e.project_name ?? "",
      itemName: e.item_name ?? "",
      unit: (e.unit ?? "day") as "day" | "piece",
      qty: Number(e.qty ?? 0),
      payRate: Number(e.pay_rate ?? 0),
      pay: Number(e.pay ?? 0),
      billRate: Number(e.bill_rate ?? 0),
      bill: Number(e.bill ?? 0),
      margin: Number(e.margin ?? 0),
      royaltyRate: Number(e.royalty_rate ?? 0),
      royalty: Number(e.royalty ?? 0),
      entryProfit: Number(e.entry_profit ?? 0),
      memo: e.memo ?? "",
    })),
    adjustments: adjustments.map((a) => ({ id: a.id, label: a.label, amount: Number(a.amount), countAsProfit: a.count_as_profit, recurringId: a.recurring_id ?? null, sortOrder: a.sort_order })),
    pay: Number(summary?.pay ?? 0),
    royalty: Number(summary?.royalty ?? 0),
    mgmtFee: Number(summary?.mgmt_fee ?? 0),
    mgmtFeeSetting: Number(summary?.mgmt_fee_setting ?? driver.mgmt_fee ?? 0),
    driverDefaultMgmtFee: Number(driver.mgmt_fee ?? 0),
    adjPay: Number(summary?.adj_pay ?? 0),
    adjProfit: Number(summary?.adj_profit ?? 0),
    payout: Number(summary?.payout ?? 0),
    bill: Number(summary?.bill ?? 0),
    margin: Number(summary?.margin ?? 0),
    driverProfit: Number(summary?.driver_profit ?? 0),
    profitRate: Number(summary?.bill ?? 0) !== 0 ? Number(summary?.driver_profit ?? 0) / Number(summary?.bill ?? 0) : 0,
    isClosed: Boolean(summary?.is_closed),
    driverMonthId: summary?.driver_month_id ?? null,
    memo: summary?.memo ?? "",
    royaltyRate: rates.size === 1 ? [...rates][0] : null,
  };
}

/** LINE 送付用の明細テキスト（会社利益は含めない） */
export function statementToText(s: StatementData, opts: { showRoyaltyRate?: boolean } = {}): string {
  const showRate = opts.showRoyaltyRate ?? true;
  const lines: string[] = [];
  lines.push(`【${s.monthLabel} 支払明細】`);
  lines.push(`${s.driverName} 様`);
  lines.push(`${s.company.name}`);
  lines.push("");
  lines.push("■ 稼働");
  for (const e of s.entries) {
    const name = e.itemName && e.itemName !== "標準" ? `${e.projectName}（${e.itemName}）` : e.projectName;
    lines.push(`・${name}：${qtyText(e.qty)}${e.unit === "day" ? "日" : "個"} × ${yen(e.payRate)} ＝ ${yen(e.pay)}`);
  }
  lines.push(`稼働小計：${yen(s.pay)}`);
  lines.push("");
  lines.push("■ 控除・調整");
  lines.push(`・ロイヤリティ${showRate && s.royaltyRate != null ? `（${pct(s.royaltyRate)}）` : ""}：${yen(-s.royalty)}`);
  if (s.mgmtFee !== 0) lines.push(`・管理費：${yen(-s.mgmtFee)}`);
  for (const a of s.adjustments) lines.push(`・${a.label}：${a.amount >= 0 ? "+" : ""}${yen(a.amount)}`);
  lines.push("");
  lines.push(`■ お支払額：${yen(s.payout)}`);
  lines.push(`振込予定日：${s.payoutDateLabel}`);
  if (s.company.statement_note) {
    lines.push("");
    lines.push(s.company.statement_note);
  }
  return lines.join("\n");
}

export const unitLabel = (u: "day" | "piece") => UNIT_LABELS[u];
