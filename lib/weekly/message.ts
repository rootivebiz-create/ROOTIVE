/**
 * LINE に送る週次サマリーの本文（純関数）。
 * スマホの LINE で読みやすいプレーンテキスト。絵文字は使わず、全角 40 文字くらいで折り返す。
 */
import { pct, qty as qtyText, yen } from "@/lib/format";
import { LINE_MAX_TEXT } from "@/lib/integrations/types";
import type { WeeklyNumbers } from "./numbers";

/** 1 行の幅（全角 1 文字 ＝ 1.0、半角 1 文字 ＝ 0.5 として数える） */
export const WEEKLY_LINE_WIDTH = 40;

/** 折り返しのときに 1 つのかたまりとして扱う文字（金額・率・URL を途中で切らない） */
const WORD_CHAR_RE = /[0-9A-Za-z¥$%.,:;/?=&#@~_+\-()[\]]/;

/** 表示上の幅（半角は 0.5） */
export function textWidth(text: string): number {
  let w = 0;
  for (const ch of text) w += ch.charCodeAt(0) < 0x80 || (ch >= "｡" && ch <= "ﾟ") ? 0.5 : 1;
  return w;
}

/** 折り返しのかたまりに分ける（半角の連なりは 1 かたまり、それ以外は 1 文字ずつ） */
function chunks(line: string): string[] {
  const out: string[] = [];
  let buf = "";
  for (const ch of line) {
    if (WORD_CHAR_RE.test(ch)) {
      buf += ch;
      continue;
    }
    if (buf) {
      out.push(buf);
      buf = "";
    }
    out.push(ch);
  }
  if (buf) out.push(buf);
  return out;
}

/** 行頭に置きたくない文字（句読点・閉じ括弧） */
const NO_LINE_HEAD = "、。，．）」』】〕〉》；：!?！？";

/** 1 行を幅で折り返す（かたまりの途中では切らない） */
export function wrapJa(line: string, width = WEEKLY_LINE_WIDTH): string[] {
  const text = line.trimEnd();
  if (!text) return [""];
  if (textWidth(text) <= width) return [text];
  const out: string[] = [];
  let current = "";
  for (const chunk of chunks(text)) {
    if (!current) {
      current = chunk;
      continue;
    }
    // 句読点は前の行の末尾に付ける（行頭に落とさない）
    if (textWidth(current) + textWidth(chunk) > width && !NO_LINE_HEAD.includes(chunk)) {
      out.push(current);
      current = chunk;
    } else {
      current += chunk;
    }
  }
  if (current) out.push(current);
  return out;
}

/** 本文全体を折り返す（空行はそのまま残す） */
export function wrapText(text: string, width = WEEKLY_LINE_WIDTH): string {
  return text
    .split("\n")
    .flatMap((line) => wrapJa(line, width))
    .join("\n");
}

export interface WeeklyLineInput {
  companyName: string;
  numbers: WeeklyNumbers;
  /** AI の総括（無ければ空文字） */
  summary?: string | null;
  /** 要点（weeklyHighlights か AI の所見。最大 3 件） */
  highlights?: readonly string[];
  /** 週次サマリーの画面の URL（空なら URL の行を出さない） */
  url?: string | null;
  /** 折り返しの幅（既定 40） */
  width?: number;
}

/** 数字の 3 行（売上・稼働・支払と経費） */
export function weeklyKeyLines(numbers: WeeklyNumbers): string[] {
  return [
    `売上 ${yen(numbers.bill)}／営業利益 ${yen(numbers.operatingProfit)}（${pct(numbers.operatingMargin)}）`,
    `稼働 ${numbers.entryCount} 件・${numbers.workDayCount} 日／ドライバー ${numbers.driverCount} 名（数量 ${qtyText(numbers.qtyTotal)}）`,
    `支払（税込）${yen(numbers.payoutIncl)}／経費 ${yen(numbers.expenseTotal)}`,
  ];
}

/**
 * LINE に送る本文を組み立てる。
 * 先頭は会社名と期間 → 数字の 3 行 → 総括と要点 → 最後に「続きはアプリで」と URL。
 */
export function weeklyLineText(input: WeeklyLineInput): string {
  const { companyName, numbers, summary, highlights = [], url } = input;
  const width = input.width ?? WEEKLY_LINE_WIDTH;
  const name = (companyName ?? "").trim();
  const link = (url ?? "").trim();

  const parts: string[] = [];
  parts.push(name ? `【${name}】先週の経営サマリー` : "先週の経営サマリー");
  parts.push(numbers.label);
  parts.push("");
  parts.push(...weeklyKeyLines(numbers));

  const note = (summary ?? "").trim();
  if (note) {
    parts.push("");
    parts.push(note);
  }

  const points = highlights.map((h) => (h ?? "").trim()).filter((h) => h.length > 0);
  if (points.length > 0) {
    parts.push("");
    parts.push("気になる点");
    points.forEach((h, i) => parts.push(`${i + 1}. ${h}`));
  }

  if (numbers.cash && numbers.cash.endingBalance != null) {
    parts.push("");
    parts.push(`資金の見込み（${numbers.cash.to} 時点）${yen(numbers.cash.endingBalance)}`);
  }

  parts.push("");
  parts.push("続きはアプリで");
  if (link) parts.push(link);

  const body = wrapText(parts.join("\n"), width).replace(/\n{3,}/g, "\n\n").trim();
  return body.length > LINE_MAX_TEXT ? `${body.slice(0, LINE_MAX_TEXT - 1)}…` : body;
}
