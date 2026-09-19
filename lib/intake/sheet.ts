/**
 * 元請の実績ファイルの読み取り（純関数。DB・ネットワークに触らない）
 *
 * 対応しているのは CSV / TSV（.csv / .tsv / .txt）だけ。
 * 文字コードは UTF-8（BOM あり／なし）と Shift_JIS を自動判定する（lib/bank/csv.ts の decodeBankCsv を再利用）。
 * Excel（.xlsx / .xls）と PDF は対応しない（画面で「CSV に保存し直してください」と案内する）。
 */
import { decodeBankCsv, parseCsv, type BankCsvEncoding } from "@/lib/bank/csv";
import { SHEET_EXTENSIONS, SHEET_SUPPORT_TEXT } from "@/lib/schemas/intake";
import { normalizeName } from "./helpers";
import { MAPPING_FIELDS, headerScore } from "./mapping";

export { SHEET_EXTENSIONS, SHEET_SUPPORT_TEXT };

/** 対応していない拡張子と、その案内（日本語） */
export const UNSUPPORTED_EXTENSIONS: Record<string, string> = {
  ".xlsx": "Excel のファイル（.xlsx）は読み込めません。Excel で開いて「CSV UTF-8（コンマ区切り）」として保存し直してから選んでください。",
  ".xlsm": "Excel のファイル（.xlsm）は読み込めません。Excel で開いて「CSV UTF-8（コンマ区切り）」として保存し直してから選んでください。",
  ".xls": "Excel のファイル（.xls）は読み込めません。Excel で開いて「CSV UTF-8（コンマ区切り）」として保存し直してから選んでください。",
  ".pdf": "PDF は読み込めません。元請から CSV（または Excel を CSV に保存し直したもの）をもらってください。",
  ".zip": "ZIP は読み込めません。中の CSV を取り出してから選んでください。",
};

/** 読み取りの上限（1 ファイル 5MB・5000 行） */
export const MAX_SHEET_ROWS = 5000;

/** ヘッダー行を探す範囲（先頭から何行目まで見るか） */
export const HEADER_SEARCH_LIMIT = 20;

/** 読み取れないファイル（理由は日本語のメッセージ） */
export class SheetParseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SheetParseError";
  }
}

export type SheetDelimiter = "," | "\t";

/** 読み取った 1 シート（CSV / TSV は 1 シートだけ） */
export interface ParsedSheet {
  name: string;
  rows: string[][];
}

export interface ParseSheetResult {
  sheets: ParsedSheet[];
  /** 判定した文字コード */
  encoding: BankCsvEncoding;
  /** 判定した区切り */
  delimiter: SheetDelimiter;
  /** 行数が上限を超えて打ち切ったか */
  truncated: boolean;
}

/** ファイル名の拡張子（小文字。無ければ ""） */
export function sheetExtension(fileName: string): string {
  const name = (fileName ?? "").trim().toLowerCase();
  const i = name.lastIndexOf(".");
  return i < 0 ? "" : name.slice(i);
}

export function isSupportedSheetFile(fileName: string): boolean {
  return (SHEET_EXTENSIONS as readonly string[]).includes(sheetExtension(fileName));
}

/** 区切り文字の判定（先頭の数行でタブとコンマの数を比べる） */
export function detectDelimiter(text: string, fileName = ""): SheetDelimiter {
  const head = text.split(/\r\n|\n|\r/).slice(0, 20).join("\n");
  const tabs = (head.match(/\t/g) ?? []).length;
  const commas = (head.match(/,/g) ?? []).length;
  if (tabs > commas) return "\t";
  if (commas > 0) return ",";
  return sheetExtension(fileName) === ".tsv" ? "\t" : ",";
}

/** 末尾の空行を落とす */
function trimTrailingEmpty(rows: string[][]): string[][] {
  let end = rows.length;
  while (end > 0 && (rows[end - 1] ?? []).every((c) => (c ?? "").trim() === "")) end -= 1;
  return rows.slice(0, end);
}

/**
 * 実績ファイルを 2 次元配列へ。
 * 対応していない拡張子・中身が空のときは SheetParseError（日本語のメッセージ）を投げる。
 */
export function parseSheet(buffer: Uint8Array, fileName: string): ParseSheetResult {
  const ext = sheetExtension(fileName);
  const unsupported = UNSUPPORTED_EXTENSIONS[ext];
  if (unsupported) throw new SheetParseError(unsupported);
  if (ext !== "" && !isSupportedSheetFile(fileName)) {
    throw new SheetParseError(`${ext} のファイルは読み込めません。${SHEET_SUPPORT_TEXT}`);
  }
  if (!buffer || buffer.length === 0) throw new SheetParseError("ファイルが空です。内容を確認してください。");

  const { text, encoding } = decodeBankCsv(buffer);
  const delimiter = detectDelimiter(text, fileName);
  const all = trimTrailingEmpty(parseCsv(text, delimiter));
  if (all.length === 0) throw new SheetParseError("ファイルに中身がありません。内容を確認してください。");

  const truncated = all.length > MAX_SHEET_ROWS;
  const rows = truncated ? all.slice(0, MAX_SHEET_ROWS) : all;
  return {
    sheets: [{ name: normalizeName(fileName) || "シート 1", rows }],
    encoding,
    delimiter,
    truncated,
  };
}

/** ヘッダー行の判定結果 */
export interface DetectedHeader {
  /** ヘッダー行の番号（0 始まり） */
  headerRow: number;
  /** 列名（正規化済み） */
  headers: string[];
}

/** その行がヘッダーらしいか（列名っぽい語の一致 ＋ 埋まっている列の数） */
export function headerRowScore(cells: string[]): number {
  const values = cells.map((c) => normalizeName(c));
  const filled = values.filter((v) => v !== "").length;
  if (filled < 2) return 0;
  let hits = 0;
  for (const field of MAPPING_FIELDS) {
    if (values.some((v) => headerScore(v, field) > 0)) hits += 1;
  }
  // 数字だけの行（明細）はヘッダーにしない
  const numeric = values.filter((v) => v !== "" && /^[-+]?[\d,./]+$/.test(v)).length;
  return hits * 10 + filled - numeric * 2;
}

/**
 * ヘッダー行を探す（前置きの行・空行があってもよい）。
 * 見つからなければ最初の中身のある行を使う。
 */
export function detectHeader(rows: string[][], limit = HEADER_SEARCH_LIMIT): DetectedHeader {
  let bestRow = -1;
  let bestScore = 0;
  const end = Math.min(rows.length, limit);
  for (let i = 0; i < end; i += 1) {
    const score = headerRowScore(rows[i] ?? []);
    if (score > bestScore) {
      bestScore = score;
      bestRow = i;
    }
  }
  if (bestRow < 0) {
    bestRow = rows.findIndex((cells) => (cells ?? []).some((c) => (c ?? "").trim() !== ""));
    if (bestRow < 0) bestRow = 0;
  }
  return { headerRow: bestRow, headers: (rows[bestRow] ?? []).map((c) => normalizeName(c)) };
}
