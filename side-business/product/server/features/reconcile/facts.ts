/**
 * 受け取る側（当社）から見た、入金の記録から分かること（純関数）。
 * 記録を並べて「確かめてください」までを書く。適法・違反などの判断はしない。
 */
import { monthEnd } from "@/lib/payroll/tax";
import { amountText, dateJa, monthJa } from "./labels";

export type ReceivingFact = {
  code: "fee_deducted" | "paid_after_60_days";
  title: string;
  detail: string;
  note: string;
  sources: { label: string; url: string }[];
};

const TORITEKI_SOURCES = [
  { label: "公正取引委員会「取適法の概要」", url: "https://www.jftc.go.jp/toriteki/toritekigaiyo/gaiyo.html" },
  { label: "公正取引委員会「取適法 リーフレット」", url: "https://www.jftc.go.jp/file/toriteki_leaflet.pdf" },
];

/** a から b まで何日後か（同じ日は 0） */
export function daysAfter(a: string, b: string): number {
  const toUtc = (d: string) => Date.UTC(Number(d.slice(0, 4)), Number(d.slice(5, 7)) - 1, Number(d.slice(8, 10)));
  return Math.round((toUtc(b) - toUtc(a)) / 86400000);
}

export function receivingFacts(notice: { month: string; paidOn: string | null; feeDeducted: number }): ReceivingFact[] {
  const facts: ReceivingFact[] = [];
  if (notice.feeDeducted > 0) {
    facts.push({
      code: "fee_deducted",
      title: "振込手数料が差し引かれています",
      detail: `入金のときに ${amountText(notice.feeDeducted)} が差し引かれています。振込手数料をどちらが持つか、取引の条件を確かめてください。`,
      note: "取引が取適法（旧・下請法）の対象になる場合は、代金から差し引くことについて決まりがあります。対象になるか・どう扱うかは、取引の条件をご確認のうえ、必要に応じて専門家にご相談ください。",
      sources: TORITEKI_SOURCES,
    });
  }
  if (notice.paidOn) {
    const end = monthEnd(notice.month.slice(0, 7));
    const days = daysAfter(end, notice.paidOn);
    if (days > 60) {
      facts.push({
        code: "paid_after_60_days",
        title: "入金日が月末から60日を超えています",
        detail: `${monthJa(notice.month)}分の入金日は ${dateJa(notice.paidOn)} で、その月の末日（${dateJa(end)}）から ${days}日後です。支払の期日が取引の条件どおりか確かめてください。`,
        note: "取引が取適法（旧・下請法）の対象になる場合は、支払期日の決まりがあります。対象になるか・どう扱うかは、取引の条件をご確認のうえ、必要に応じて専門家にご相談ください。",
        sources: TORITEKI_SOURCES,
      });
    }
  }
  return facts;
}
