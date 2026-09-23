/**
 * 請求書のメールの文面（純関数。0028）。
 * 件名と本文は取引先に届くので、丁寧に・短く。金額は税込の合計、期日があれば添える。
 */
import { yen } from "@/lib/format";

export interface InvoiceMailInput {
  companyName: string;
  companyTel: string;
  clientName: string;
  honorific: string;
  invoiceNo: string;
  monthLabel: string;
  total: number;
  dueDateLabel: string | null;
  /** 送る人が書き足した一言（任意） */
  message?: string;
}

export function invoiceMailSubject(i: Pick<InvoiceMailInput, "companyName" | "monthLabel" | "invoiceNo">): string {
  return `【${i.companyName}】${i.monthLabel}分 ご請求書のご送付（${i.invoiceNo}）`;
}

export function invoiceMailText(i: InvoiceMailInput): string {
  const lines = [
    `${i.clientName} ${i.honorific || "御中"}`,
    "",
    "いつもお世話になっております。",
    `${i.companyName}でございます。`,
    "",
    `${i.monthLabel}分のご請求書をお送りいたします。`,
    "添付の PDF をご確認くださいますよう、お願い申し上げます。",
    "",
    `　請求書番号：${i.invoiceNo}`,
    `　ご請求金額：${yen(i.total)}（税込）`,
  ];
  if (i.dueDateLabel) lines.push(`　お支払い期限：${i.dueDateLabel}`);
  const note = (i.message ?? "").trim();
  if (note) lines.push("", note);
  lines.push("", "ご不明な点がございましたら、お気軽にお問い合わせください。", "今後ともよろしくお願い申し上げます。", "", "――――――――――――", i.companyName);
  if (i.companyTel) lines.push(`TEL ${i.companyTel}`);
  return lines.join("\n");
}
