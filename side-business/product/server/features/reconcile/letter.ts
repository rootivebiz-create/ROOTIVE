/**
 * 元請のご担当者へ送る「確認のお願い」の文面を作る（純関数。画面でも使う）。
 * - 数字（当社の記録とお支払通知）を並べて、確かめてもらうお願いだけを書く
 * - 責める言い方・法律の話・「払われていない」と決めつける言い方はしない
 * - 日ごとの記録を送れることを添える
 */
import { amountText, monthJa, priceText, qtyUnitText, type ItemKind } from "./labels";

export type LetterItem = {
  id: string;
  kind: ItemKind;
  label: string;
  unit: string | null;
  ourQty: number | null;
  theirQty: number | null;
  ourPrice: number | null;
  theirPrice: number | null;
  ourAmount: number;
  theirAmount: number;
  diff: number;
  /** 数量と単価の両方が違うため 2 つに分けたうちの 1 つ */
  split: boolean;
};

export type LetterInput = {
  clientName: string;
  /** 宛名（例：ご担当者様・経理部 ◯◯様） */
  contactName: string;
  companyName: string;
  senderName: string;
  /** YYYY-MM-01 */
  month: string;
  items: LetterItem[];
  /** 日ごとの記録をお送りできる旨を添える */
  offerRecords: boolean;
};

/** 1 件ぶんの見出し */
export function letterItemTitle(it: LetterItem): string {
  switch (it.kind) {
    case "qty":
      return it.split ? `${it.label}の数量（単価の違いとは分けて計算しています）` : `${it.label}の数量`;
    case "price":
      return it.split ? `${it.label}の単価（数量の違いとは分けて計算しています）` : `${it.label}の単価`;
    case "amount":
      return `${it.label}の金額`;
    case "missing":
      return `${it.label}（お支払通知に行が見当たりません）`;
    case "extra":
      return `${it.label}（当社の記録に対応する内容が見当たりません）`;
  }
}

const q = (v: number | null, unit: string | null) => (v === null ? "" : qtyUnitText(v, unit));
const diffText = (d: number) => `差 ${amountText(Math.abs(d))}`;

/** 1 件ぶんの本文（数字の並べ方） */
export function letterItemBody(it: LetterItem): string {
  const unit = it.unit;
  switch (it.kind) {
    case "qty":
      if (it.split) {
        return `当社の記録では ${q(it.ourQty, unit)}、お支払通知では ${q(it.theirQty, unit)} です。当社の単価 ${priceText(it.ourPrice ?? 0)} で計算すると ${amountText(it.ourAmount)} と ${amountText(it.theirAmount)} になります（${diffText(it.diff)}）。`;
      }
      return `当社の記録では ${it.label} ${q(it.ourQty, unit)} × ${priceText(it.ourPrice ?? 0)} = ${amountText(it.ourAmount)}、お支払通知では ${q(it.theirQty, unit)} = ${amountText(it.theirAmount)}（${diffText(it.diff)}）となっております。`;
    case "price":
      if (it.split) {
        return `当社の単価は ${priceText(it.ourPrice ?? 0)}、お支払通知の単価は ${priceText(it.theirPrice ?? 0)} です。お支払通知の数量 ${q(it.theirQty, unit)} で計算すると ${amountText(it.ourAmount)} と ${amountText(it.theirAmount)} になります（${diffText(it.diff)}）。`;
      }
      return `当社の記録では ${it.label} ${q(it.ourQty, unit)} × ${priceText(it.ourPrice ?? 0)} = ${amountText(it.ourAmount)}、お支払通知では ${q(it.theirQty, unit)} × ${priceText(it.theirPrice ?? 0)} = ${amountText(it.theirAmount)}（${diffText(it.diff)}）となっております。`;
    case "amount": {
      const ours = it.ourQty !== null && it.ourPrice !== null ? `${q(it.ourQty, unit)} × ${priceText(it.ourPrice)} = ${amountText(it.ourAmount)}` : amountText(it.ourAmount);
      const theirs =
        it.theirQty !== null && it.theirPrice !== null ? `${q(it.theirQty, unit)} × ${priceText(it.theirPrice)} = ${amountText(it.theirAmount)}` : amountText(it.theirAmount);
      return `当社の記録では ${it.label} ${ours}、お支払通知では ${theirs}（${diffText(it.diff)}）となっております。`;
    }
    case "missing":
      return `当社の記録では ${it.label} ${q(it.ourQty, unit)} × ${priceText(it.ourPrice ?? 0)} = ${amountText(it.ourAmount)} ですが、お支払通知に該当する行が見当たりませんでした。`;
    case "extra": {
      const figures = it.theirQty !== null && it.theirPrice !== null ? `${q(it.theirQty, null)} × ${priceText(it.theirPrice)} = ${amountText(it.theirAmount)}` : amountText(it.theirAmount);
      return `お支払通知に「${it.label}」（${figures}）の行がございますが、当社の記録では対応する内容を確認できておりません。念のため、内容をお教えいただけますでしょうか。`;
    }
  }
}

export function letterSubject(input: Pick<LetterInput, "month" | "companyName">): string {
  return `${monthJa(input.month)}分 お支払通知書の内容のご確認のお願い（${input.companyName}）`;
}

export function buildLetter(input: LetterInput): { subject: string; body: string } {
  const lines: string[] = [];
  const contact = input.contactName.trim() || "ご担当者様";
  lines.push(input.clientName.trim());
  lines.push(contact);
  lines.push("");
  lines.push(`いつもお世話になっております。${input.companyName}${input.senderName.trim() ? `の${input.senderName.trim()}` : ""}です。`);
  lines.push("");
  lines.push(`${monthJa(input.month)}分のお支払通知書をお送りいただき、ありがとうございました。`);
  if (input.items.length === 0) {
    lines.push("当社の記録と照らし合わせましたが、確認をお願いしたい点はございませんでした。");
  } else {
    lines.push("当社の記録と照らし合わせたところ、次の点で数字が異なっておりました。");
    lines.push("お手数ですが、ご確認いただけますでしょうか。");
    lines.push("");
    input.items.forEach((it, i) => {
      lines.push(`${i + 1}. ${letterItemTitle(it)}`);
      lines.push(`   ${letterItemBody(it)}`);
      lines.push("");
    });
    const net = input.items.reduce((a, it) => a + it.diff, 0);
    if (input.items.length > 1 && net !== 0) {
      lines.push(`上記を合わせると、お支払通知の金額は当社の記録に比べて ${amountText(Math.abs(net))} ${net < 0 ? "少ない" : "多い"}金額となっております。`);
    }
    lines.push("当社の集計に誤りがある可能性もございますので、あわせてご確認いただけますと幸いです。");
  }
  if (input.offerRecords) lines.push("日ごとの稼働の記録（ドライバー別）が必要でしたら、すぐにお送りいたします。");
  if (input.items.length > 0) lines.push("お忙しいところ恐れ入りますが、ご確認のうえ、ご教示いただけますと幸いです。");
  lines.push("");
  lines.push("どうぞよろしくお願いいたします。");
  lines.push("");
  lines.push(input.companyName);
  if (input.senderName.trim()) lines.push(input.senderName.trim());
  return { subject: letterSubject(input), body: lines.join("\n") };
}

/** メールソフトを開くリンク（宛先は無くてもよい） */
export function mailtoHref(to: string, subject: string, body: string): string {
  const addr = to.trim().replace(/[\s<>"]/g, "");
  return `mailto:${encodeURIComponent(addr).replace(/%40/g, "@")}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body.replace(/\n/g, "\r\n"))}`;
}
