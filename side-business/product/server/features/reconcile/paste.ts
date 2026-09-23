/**
 * 貼り付けた表（元請の画面・Excel・PDF からコピーした文字）を、取り込みと同じ「TSV のファイル」にする。
 * - タブが入っていれば（Excel・ブラウザの表のコピー）、そのまま使う
 * - タブが無ければ（PDF のコピーは空白で区切られることが多い）、空白で区切り、見出しの行の列の数に合わせる：
 *   ・列が多い行は、品目の名前に空白が入っているとみて、最初の文字の続きを 1 つにまとめる（「宅配 個建て」）
 *   ・列が少ない行は、数字を右に寄せる（空いた欄は金額より前にあることが多いため。「待機料 3,000」→ 金額の列）
 * 読み取れた結果は、画面の「お支払通知の行」と「読み取りの詳細」で人が確かめる（PDF のコピーは形が崩れることがある）。
 * DB に触らない。
 */
import { parseDateCell, parseNumberCell } from "~/server/tabular";

/** 貼り付けられる文字の上限（画面から送れる大きさに収める） */
export const MAX_PASTE_CHARS = 1_000_000;

/** 名前を入れなかったときのファイル名 */
export const PASTE_DEFAULT_NAME = "貼り付けた表";

export type PastedTable = { tsv: string; rows: number; columns: number; splitBySpaces: boolean };

/** 数字か日付の欄か（品目の名前の続きとしてまとめない） */
function isValueToken(token: string): boolean {
  return parseNumberCell(token) !== null || parseDateCell(token, 2000) !== null;
}

function splitSpaces(line: string): string[] {
  const t = line.replace(/[\s　]+/g, " ").trim();
  return t ? t.split(" ") : [];
}

/** 見出しの行の列の数：数字の入った最初の行より上で、いちばん近い「文字だけが 2 つ以上並んだ行」 */
function headerWidth(tokens: string[][]): number | null {
  const first = tokens.findIndex((t) => t.some(isValueToken));
  if (first <= 0) return null;
  for (let i = first - 1; i >= 0; i--) {
    const t = tokens[i];
    if (t.length === 0) continue;
    if (t.length >= 2 && !t.some(isValueToken)) return t.length;
  }
  return null;
}

/** 1 行を width の列にそろえる（数字の入っていない行は、そのまま） */
function fitRow(t: string[], width: number | null): string[] {
  if (width === null || t.length === 0 || !t.some(isValueToken) || t.length === width) return t;
  if (t.length > width) {
    // 最初の「文字の続き」を、多い分だけ 1 つにまとめる
    const start = t.findIndex((x) => !isValueToken(x));
    if (start < 0) return t;
    let end = start;
    while (end + 1 < t.length && !isValueToken(t[end + 1])) end++;
    const merge = Math.min(t.length - width + 1, end - start + 1);
    if (merge < 2) return t;
    return [...t.slice(0, start), t.slice(start, start + merge).join(" "), ...t.slice(start + merge)];
  }
  // 列が少ない：最後の文字の欄までは左から、うしろの数字は右に寄せる
  let lastText = -1;
  for (let i = 0; i < t.length; i++) if (!isValueToken(t[i])) lastText = i;
  const head = t.slice(0, lastText + 1);
  const tail = t.slice(lastText + 1);
  return [...head, ...Array.from({ length: width - head.length - tail.length }, () => ""), ...tail];
}

function tsvCell(value: string): string {
  return /["\t\r\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
}

/** 貼り付けた文字を TSV にする。表らしい行が無ければ rows は 0 */
export function pastedTableToTsv(text: string): PastedTable {
  const lines = text.replace(/\r\n?/g, "\n").split("\n");
  while (lines.length > 0 && !lines[lines.length - 1].trim()) lines.pop();
  const nonEmpty = lines.filter((l) => l.trim()).length;
  if (lines.some((l) => l.includes("\t"))) {
    const columns = Math.max(0, ...lines.map((l) => l.split("\t").length));
    return { tsv: `${lines.join("\n")}\n`, rows: nonEmpty, columns, splitBySpaces: false };
  }
  const tokens = lines.map(splitSpaces);
  const width = headerWidth(tokens);
  const rows = tokens.map((t) => fitRow(t, width));
  const columns = Math.max(0, ...rows.map((r) => r.length));
  return { tsv: `${rows.map((r) => r.map(tsvCell).join("\t")).join("\n")}\n`, rows: nonEmpty, columns, splitBySpaces: true };
}

/** 貼り付けた表のファイル名（画面・操作の記録に出す）。名前にファイルの区切りや拡張子が入っていても、そのまま .tsv にする */
export function pasteFileName(label: string | null | undefined): string {
  const base = (label ?? "")
    .normalize("NFKC")
    .replace(/[\\/:*?"<>|\u0000-\u001f]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 60);
  return `${base || PASTE_DEFAULT_NAME}.tsv`;
}
