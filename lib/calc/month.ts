import { calcEntry } from "./entry";
import { fromS4, sumMoney, toS4 } from "./money";
import type { CompanyMonthCalc, DriverMonthCalc, DriverMonthInput } from "./types";

/**
 * ドライバー × 月 の計算（§2.2）
 * mgmt_fee は数量 > 0 の稼働行が 1 件以上ある場合のみ計上
 * payout = Σpay − Σroyalty − mgmt_fee + adj_pay
 * driver_profit = Σmargin + Σroyalty + mgmt_fee + adj_profit
 */
export function calcDriverMonth(input: DriverMonthInput): DriverMonthCalc {
  const rows = input.entries.map(calcEntry);
  const activeEntryCount = input.entries.filter((e) => e.qty > 0).length;
  const mgmtFeeSetting = Number.isFinite(input.mgmtFee) ? input.mgmtFee : 0;
  const mgmtFee = activeEntryCount > 0 ? mgmtFeeSetting : 0;
  const bill = sumMoney(rows.map((r) => r.bill));
  const pay = sumMoney(rows.map((r) => r.pay));
  const margin = sumMoney(rows.map((r) => r.margin));
  const royalty = sumMoney(rows.map((r) => r.royalty));
  const adjPay = sumMoney(input.adjustments.map((a) => a.amount));
  const adjProfit = sumMoney(input.adjustments.filter((a) => a.countAsProfit).map((a) => -a.amount));
  const payout = fromS4(toS4(pay) - toS4(royalty) - toS4(mgmtFee) + toS4(adjPay));
  const driverProfit = fromS4(toS4(margin) + toS4(royalty) + toS4(mgmtFee) + toS4(adjProfit));
  const profitRate = bill !== 0 ? driverProfit / bill : 0;
  return {
    entryCount: input.entries.length,
    activeEntryCount,
    bill,
    pay,
    margin,
    royalty,
    mgmtFee,
    mgmtFeeSetting,
    adjPay,
    adjProfit,
    payout,
    driverProfit,
    profitRate,
  };
}

/** 会社 × 月（§2.3）：全ドライバー×月の合計 */
export function calcCompanyMonth(drivers: DriverMonthCalc[]): CompanyMonthCalc {
  const bill = sumMoney(drivers.map((d) => d.bill));
  const profit = sumMoney(drivers.map((d) => d.driverProfit));
  return {
    driverCount: drivers.length,
    entryCount: drivers.reduce((a, d) => a + d.entryCount, 0),
    bill,
    pay: sumMoney(drivers.map((d) => d.pay)),
    margin: sumMoney(drivers.map((d) => d.margin)),
    royalty: sumMoney(drivers.map((d) => d.royalty)),
    mgmtFee: sumMoney(drivers.map((d) => d.mgmtFee)),
    adjPay: sumMoney(drivers.map((d) => d.adjPay)),
    adjProfit: sumMoney(drivers.map((d) => d.adjProfit)),
    payout: sumMoney(drivers.map((d) => d.payout)),
    profit,
    profitRate: bill !== 0 ? profit / bill : 0,
  };
}
