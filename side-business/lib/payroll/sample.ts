import type { MonthData } from "./types";

/**
 * デモ用の架空のデータ（実在の人物・会社ではない）。
 * 5 人のドライバー（うち 2 人はインボイス未登録）、2 社の元請、4 つの案件。
 */
export function sampleData(month = "2026-10"): MonthData {
  return {
    settings: {
      companyName: "サンプル運送株式会社",
      companyRegistrationNo: "T1234567890123",
      taxRate: 0.1,
      taxRounding: "floor",
      amountRounding: "round",
      payTaxToExempt: true,
      taxMethod: "general",
      month,
      payDate: nextMonthDay(month, 25),
    },
    drivers: [
      { id: "d1", name: "青木 翔太", invoiceRegistered: true, registrationNo: "T9876543210987", monthlyFee: 15000, royaltyRate: 0.1,
        bank: { bankCode: "0001", bankNameKana: "ﾐｽﾞﾎ", branchCode: "101", branchNameKana: "ｻﾝﾌﾟﾙ", accountType: "ordinary", accountNumber: "1234567", holderKana: "アオキ ショウタ" } },
      { id: "d2", name: "井上 美咲", invoiceRegistered: true, registrationNo: "T2345678901234", monthlyFee: 15000, royaltyRate: 0.1,
        bank: { bankCode: "0005", bankNameKana: "ﾐﾂﾋﾞｼUFJ", branchCode: "202", branchNameKana: "ｻﾝﾌﾟﾙ", accountType: "ordinary", accountNumber: "2345678", holderKana: "イノウエ ミサキ" } },
      { id: "d3", name: "上田 健", invoiceRegistered: false, monthlyFee: 15000, royaltyRate: 0.1,
        bank: { bankCode: "0009", bankNameKana: "ﾐﾂｲｽﾐﾄﾓ", branchCode: "303", branchNameKana: "ｻﾝﾌﾟﾙ", accountType: "ordinary", accountNumber: "3456789", holderKana: "ウエダ ケン" } },
      { id: "d4", name: "遠藤 大輔", invoiceRegistered: false, monthlyFee: 10000, royaltyRate: 0.08,
        bank: { bankCode: "9900", bankNameKana: "ﾕｳﾁﾖ", branchCode: "418", branchNameKana: "ﾖﾝｲﾁﾊﾁ", accountType: "ordinary", accountNumber: "4567890", holderKana: "エンドウ ダイスケ" } },
      { id: "d5", name: "岡田 拓也", invoiceRegistered: true, registrationNo: "T3456789012345", monthlyFee: 15000, royaltyRate: 0.1,
        bank: { bankCode: "0001", bankNameKana: "ﾐｽﾞﾎ", branchCode: "104", branchNameKana: "ｻﾝﾌﾟﾙ", accountType: "ordinary", accountNumber: "5678901", holderKana: "オカダ タクヤ" } },
    ],
    projects: [
      { id: "p1", name: "宅配（個建て）", client: "A物流", unit: "個", billRate: 190, payRate: 150 },
      { id: "p2", name: "企業配（日当）", client: "A物流", unit: "日", billRate: 22000, payRate: 18000 },
      { id: "p3", name: "スポット便", client: "B商事", unit: "件", billRate: 9000, payRate: 7000 },
      { id: "p4", name: "ルート配送（時給）", client: "B商事", unit: "時間", billRate: 2600, payRate: 2000 },
    ],
    work: [
      { driverId: "d1", projectId: "p1", qty: 2310 },
      { driverId: "d1", projectId: "p3", qty: 4 },
      { driverId: "d2", projectId: "p2", qty: 21 },
      { driverId: "d3", projectId: "p1", qty: 1840 },
      { driverId: "d4", projectId: "p4", qty: 168 },
      { driverId: "d4", projectId: "p3", qty: 2 },
      { driverId: "d5", projectId: "p2", qty: 18 },
      { driverId: "d5", projectId: "p1", qty: 420 },
    ],
    adjustments: [
      { driverId: "d1", label: "駐車場代の立替", amount: 3300 },
      { driverId: "d3", label: "車両修理の負担分", amount: -11000 },
    ],
  };
}

function nextMonthDay(month: string, day: number): string {
  const [y, m] = month.split("-").map(Number);
  const ny = m === 12 ? y + 1 : y;
  const nm = m === 12 ? 1 : m + 1;
  return `${ny}-${String(nm).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}
