/**
 * 銀行の入出金明細 CSV の読み取り（純関数。DB・ネットワークに触らない）
 *
 * - 文字コードは UTF-8（BOM あり／なし）と Shift_JIS（cp932）を自動判定する
 * - 区切りは , 。引用符つき・セル内改行に対応する
 * - 書式（列の並び）は lib/bank/formats.ts が判定する
 * - 同じファイルを 2 回取り込んでも増えないように、行ごとに決まった指紋（fingerprint）を作る
 */
import iconv from "iconv-lite";
import { normalizeDescription } from "./helpers";
import { amountOfRow, classifyHeader, detectColumns, parseBankAmount, parseBankDate, UNKNOWN_FORMAT, type BankColumns, type ParsedTxn } from "./formats";

export type { ParsedTxn };

/** 判定した文字コード */
export type BankCsvEncoding = "utf-8" | "shift_jis";

export interface DecodedBankCsv {
  text: string;
  encoding: BankCsvEncoding;
}

export interface ParseBankCsvOptions {
  /** ヘッダー行を探す行数の上限（既定 20） */
  headerSearchLimit?: number;
  /** 取り込む明細の上限（既定 5000） */
  maxRows?: number;
  /** errors に積む件数の上限（既定 20。超えた分は「ほか N 件」にまとめる） */
  maxErrors?: number;
}

export interface BankCsvResult {
  /** 判定した書式名（"2列型（お預入金額／お支払金額）" など。判定できなければ "不明"） */
  format: string;
  /** 読み取れた明細 */
  rows: ParsedTxn[];
  /** 読めなかった行の理由（日本語） */
  errors: string[];
  /** 読めずに飛ばした行数 */
  skipped: number;
  /** 判定した文字コード */
  encoding: BankCsvEncoding;
  /** 判定した列（判定できなければ null） */
  columns: BankColumns | null;
}

// ---------------------------------------------------------------------------
// 文字コード
// ---------------------------------------------------------------------------

const UTF8_BOM = [0xef, 0xbb, 0xbf];

function hasUtf8Bom(bytes: Uint8Array): boolean {
  return bytes.length >= 3 && UTF8_BOM.every((b, i) => bytes[i] === b);
}

/** 文字化けの度合い（置換文字と制御文字の数） */
function mojibakeScore(text: string): number {
  let score = 0;
  for (const ch of text) {
    const code = ch.codePointAt(0) ?? 0;
    if (ch === "�") score += 10;
    else if (code < 0x09 || (code > 0x0d && code < 0x20)) score += 5;
  }
  return score;
}

/**
 * UTF-8（BOM あり／なし）と Shift_JIS を自動判定して文字列にする。
 * BOM があれば UTF-8。無ければ両方でデコードして、文字化けの少ない方を選ぶ。
 */
export function decodeBankCsv(buffer: Uint8Array): DecodedBankCsv {
  const bytes = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);
  const body = Buffer.from(hasUtf8Bom(bytes) ? bytes.subarray(3) : bytes);
  if (hasUtf8Bom(bytes)) return { text: iconv.decode(body, "utf8"), encoding: "utf-8" };

  const utf8 = iconv.decode(body, "utf8");
  const utf8Score = mojibakeScore(utf8);
  if (utf8Score === 0) return { text: utf8, encoding: "utf-8" };

  const sjis = iconv.decode(body, "cp932");
  return mojibakeScore(sjis) < utf8Score ? { text: sjis, encoding: "shift_jis" } : { text: utf8, encoding: "utf-8" };
}

// ---------------------------------------------------------------------------
// CSV の分解
// ---------------------------------------------------------------------------

/**
 * CSV テキストを 2 次元配列へ（引用符つき・セル内改行・"" のエスケープに対応）。
 * 改行は CRLF / LF / CR のいずれでもよい。末尾の改行では空行を作らない。
 */
export function parseCsv(text: string, delimiter = ","): string[][] {
  const s = text.replace(/^﻿/, "");
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;

  for (let i = 0; i < s.length; i += 1) {
    const ch = s[i];
    if (quoted) {
      if (ch === '"') {
        if (s[i + 1] === '"') {
          cell += '"';
          i += 1;
        } else {
          quoted = false;
        }
      } else {
        cell += ch;
      }
      continue;
    }
    if (ch === '"' && cell === "") {
      quoted = true;
      continue;
    }
    if (ch === delimiter) {
      row.push(cell);
      cell = "";
      continue;
    }
    if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && s[i + 1] === "\n") i += 1;
      row.push(cell);
      cell = "";
      rows.push(row);
      row = [];
      continue;
    }
    cell += ch;
  }
  if (cell !== "" || row.length > 0) {
    row.push(cell);
    rows.push(row);
  }
  return rows;
}

// ---------------------------------------------------------------------------
// 明細の読み取り
// ---------------------------------------------------------------------------

/** 空でない行だけを、元の行番号（1 始まり）つきで取り出す */
function contentRows(rows: string[][]): { cells: string[]; line: number }[] {
  const out: { cells: string[]; line: number }[] = [];
  rows.forEach((cells, index) => {
    if (cells.some((c) => c.trim() !== "")) out.push({ cells, line: index + 1 });
  });
  return out;
}

function preview(cells: string[]): string {
  const s = cells.join(",").replace(/\s+/g, " ").trim();
  return s.length > 60 ? `${s.slice(0, 60)}…` : s;
}

/**
 * 銀行 CSV を解析する。日付か金額が読めない行は errors に理由を積んで飛ばす。
 * 書式を判定できなければ rows は空、format は "不明"。
 */
export function parseBankCsv(buffer: Uint8Array, opts: ParseBankCsvOptions = {}): BankCsvResult {
  const maxRows = opts.maxRows ?? 5000;
  const maxErrors = opts.maxErrors ?? 20;
  const { text, encoding } = decodeBankCsv(buffer);
  const all = contentRows(parseCsv(text));

  const errors: string[] = [];
  let skipped = 0;
  let hidden = 0;
  const addError = (message: string) => {
    skipped += 1;
    if (errors.length < maxErrors) errors.push(message);
    else hidden += 1;
  };

  if (all.length === 0) {
    return { format: UNKNOWN_FORMAT, rows: [], errors: ["CSV に中身がありません。ファイルを確認してください。"], skipped: 0, encoding, columns: null };
  }

  const columns = detectColumns(
    all.map((r) => r.cells),
    opts.headerSearchLimit ?? 20,
  );
  if (!columns) {
    return {
      format: UNKNOWN_FORMAT,
      rows: [],
      errors: ["日付と金額の列を判定できませんでした。銀行の入出金明細 CSV をそのまま保存したファイルを選んでください。"],
      skipped: 0,
      encoding,
      columns: null,
    };
  }

  const body = columns.headerRow == null ? all : all.slice(columns.headerRow + 1);
  const rows: ParsedTxn[] = [];

  for (const { cells, line } of body) {
    if (rows.length >= maxRows) {
      errors.push(`明細が ${maxRows} 件を超えたため、${line} 行目以降は取り込みませんでした。期間を分けて取り込んでください。`);
      break;
    }
    const dateCell = cells[columns.date] ?? "";
    const txnDate = parseBankDate(dateCell);
    if (txnDate == null) {
      // 月ごとにヘッダーが繰り返されている CSV は、見出し行を黙って飛ばす
      if (classifyHeader(dateCell) != null) continue;
      addError(`${line} 行目: 日付を読み取れませんでした（${preview(cells)}）`);
      continue;
    }
    const amount = amountOfRow(cells, columns);
    if (amount == null) {
      addError(`${line} 行目: 金額を読み取れませんでした（${preview(cells)}）`);
      continue;
    }
    const balance = columns.balance == null ? null : parseBankAmount(cells[columns.balance]);
    rows.push({
      txnDate,
      description: normalizeDescription(columns.description == null ? "" : cells[columns.description]),
      amount,
      balance,
      raw: cells.join(","),
    });
  }

  if (hidden > 0) errors.push(`ほか ${hidden} 件の行を読み取れませんでした。`);
  if (rows.length === 0 && errors.length === 0) errors.push("取り込める明細がありませんでした。");

  return { format: columns.format, rows, errors, skipped, encoding, columns };
}

// ---------------------------------------------------------------------------
// 指紋（二重取り込みの防止）
// ---------------------------------------------------------------------------

/** 指紋のもとになる値 */
export interface FingerprintSource {
  txnDate: string;
  description: string;
  amount: number;
  balance?: number | null;
}

/** 摘要が長すぎる場合の打ち切り */
const FINGERPRINT_DESC_MAX = 200;

/**
 * 明細 1 件の指紋（決定的）。同じ CSV を 2 回取り込んでも同じ値になる。
 * seq は同一ファイル内に同じ内容の行が複数あるときの連番（2 件目以降は "#2" が付く）。
 */
export function fingerprintTxn(companyId: string, txn: FingerprintSource, seq = 1): string {
  const description = normalizeDescription(txn.description).slice(0, FINGERPRINT_DESC_MAX);
  const balance = txn.balance == null ? "" : txn.balance.toFixed(2);
  const base = [companyId, txn.txnDate, txn.amount.toFixed(2), description, balance].join("|");
  return seq > 1 ? `${base}#${seq}` : base;
}

/**
 * 明細の並び順に指紋を作る。同じ内容が同一ファイル内に複数あるときは 2 件目以降に連番を振るので、
 * 「同じ日に同じ金額・同じ摘要の取引が本当に 2 件ある」場合でも片方が消えない。
 */
export function fingerprintTxns(companyId: string, rows: FingerprintSource[]): string[] {
  const seen = new Map<string, number>();
  return rows.map((row) => {
    const base = fingerprintTxn(companyId, row);
    const seq = (seen.get(base) ?? 0) + 1;
    seen.set(base, seq);
    return fingerprintTxn(companyId, row, seq);
  });
}
