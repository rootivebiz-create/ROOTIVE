/**
 * LINE へ送る文面の組み立て（純関数）。
 * スマホの LINE で読みやすいプレーンテキスト。絵文字は使わず、1 行は短くする。
 */
import { yen } from "@/lib/format";
import { formatDateJa } from "@/lib/month";
import { LINE_MAX_TEXT } from "./types";

/**
 * 行をつないで 1 通の本文にする。null / undefined の行は落とし、空文字は空行として残す。
 * 空行が続いたら 1 行にまとめ、前後の空白を取り、LINE の上限で切り詰める。
 */
function lines(...parts: (string | null | undefined)[]): string {
  const text = parts
    .filter((p): p is string => typeof p === "string")
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  return text.length > LINE_MAX_TEXT ? `${text.slice(0, LINE_MAX_TEXT - 1)}…` : text;
}

/** 先頭の見出し（【会社名】お知らせ） */
function header(companyName: string, title: string): string {
  const name = companyName.trim();
  return name ? `【${name}】${title}` : title;
}

export interface StatementReadyInput {
  companyName: string;
  driverName: string;
  /** "2026年9月" */
  monthLabel: string;
  /** 税込のお支払額 */
  payoutIncl: number;
  /** "2026-10-31"（省略可） */
  payoutDate?: string | null;
  /** 明細ページの URL（省略可） */
  url?: string | null;
}

/** 月を締めて支払明細ができたときの連絡 */
export function statementReadyMessage(input: StatementReadyInput): string {
  const { companyName, driverName, monthLabel, payoutIncl, payoutDate, url } = input;
  return lines(
    header(companyName, `${monthLabel}の支払明細ができました`),
    "",
    `${driverName.trim()} さん`,
    `お支払額（税込）：${yen(payoutIncl)}`,
    payoutDate ? `振込予定日：${formatDateJa(payoutDate)}` : null,
    url ? "" : null,
    url ? "明細はこちらから確認できます。" : null,
    url ?? null,
  );
}

export interface AlertMessageInput {
  companyName: string;
  title: string;
  detail?: string | null;
  url?: string | null;
}

/** 重要なアラートの通知 */
export function alertMessage(input: AlertMessageInput): string {
  const { companyName, title, detail, url } = input;
  return lines(
    header(companyName, "重要なお知らせ"),
    "",
    title.trim(),
    detail?.trim() ? detail.trim() : null,
    url ? "" : null,
    url ? "詳しくはこちらを確認してください。" : null,
    url ?? null,
  );
}

/** 合言葉で連携できたときの返信 */
export function linkedMessage(input: { companyName: string; name: string }): string {
  return lines(
    header(input.companyName, "連携が完了しました"),
    "",
    `${input.name.trim()} さんと連携しました。`,
    "これから支払明細やお知らせをこちらにお送りします。",
  );
}

/** 合言葉が見つからなかったときの返信 */
export function linkFailedMessage(): string {
  return lines("合言葉が見つかりませんでした。", "アプリで新しい合言葉を出してから、もう一度送ってください。");
}

/** 友だち追加のときの歓迎メッセージ */
export function welcomeMessage(companyName: string): string {
  return lines(
    header(companyName, "友だち追加ありがとうございます"),
    "",
    "このアカウントからは支払明細やお知らせをお送りします。",
    "アプリで出した 6 桁の合言葉をこのトークに送ると、連携が完了します。",
  );
}

/** 連携済みの人がテキストを送ってきたときの案内 */
export function guideMessage(): string {
  return lines(
    "このアカウントからは支払明細やお知らせをお送りします。",
    "連携するときは、アプリで出した 6 桁の合言葉を送ってください。",
  );
}

/** 接続テストの送信 */
export function testMessage(companyName: string): string {
  return lines(header(companyName, "テスト送信です"), "", "この文が届いていれば LINE 連携は正常です。");
}
