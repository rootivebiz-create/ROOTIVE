/**
 * 元請の支払通知書（支払明細書）の読み取り（純関数。DB・ネットワーク・React に触らない）
 *
 * - 文字コードの自動判定は呼び出し側（lib/bank/csv.ts の decodeBankCsv）。ここには文字列で渡す
 * - 区切りは , / タブを自動判定する（PDF から貼り付けた「空白で揃えた表」も読む）
 * - ヘッダー行は日本語の列名から推測する（前置きの行・空行があってもよい。lib/intake/sheet.ts と同じ考え方）
 * - 数値は全角数字・カンマ・「¥」「円」・単位（個・件・日）つきでも読む
 * - どの列をどう読んだかは columnReport（日本語）で返し、画面にそのまま出す
 */
import { parseCsv } from "@/lib/bank/csv";
import { nameKey, normalizeName } from "@/lib/intake/helpers";
import { parseNumberInput } from "@/lib/calc/parse";
import { mulMoney, sumMoney } from "@/lib/calc/money";
import { yen } from "@/lib/format";

/** 読み取る 4 項目 */
export const NOTICE_FIELDS = ["name", "qty", "unit_price", "amount"] as const;
export type NoticeField = (typeof NOTICE_FIELDS)[number];

export const NOTICE_FIELD_LABELS: Record<NoticeField, string> = {
  name: "内容",
  qty: "数量",
  unit_price: "単価",
  amount: "金額",
};

/** 1 回に読み取る明細の上限 */
export const MAX_NOTICE_CSV_ROWS = 500;

/** ヘッダー行を探す範囲（先頭から何行目まで見るか） */
export const NOTICE_HEADER_SEARCH_LIMIT = 20;

export type NoticeDelimiter = "," | "\t";

/** 列番号（0 始まり。-1 は見つからなかった） */
export type NoticeColumns = Record<NoticeField, number>;

export const EMPTY_NOTICE_COLUMNS: NoticeColumns = { name: -1, qty: -1, unit_price: -1, amount: -1 };

/** 読み取った明細の 1 行 */
export interface NoticeCsvRow {
  /** 元のテキストの行番号（1 始まり。画面の案内に使う） */
  line: number;
  /** 元請の表記（案件内容の紐づけに使う） */
  raw_name: string;
  qty: number;
  unit_price: number;
  amount: number;
  /** 計算で補った項目（amount = 数量 × 単価、unit_price = 金額 ÷ 数量） */
  derived: "amount" | "unit_price" | null;
}

export interface NoticeCsvResult {
  rows: NoticeCsvRow[];
  /** 判定した区切り */
  delimiter: NoticeDelimiter;
  /** ヘッダー行（空行を除いた何行目か。0 始まり。見つからなければ -1） */
  headerRow: number;
  /** ヘッダー行の列名（見つからなければ空配列） */
  headers: string[];
  /** 判定した列 */
  columns: NoticeColumns;
  /** どの列をどう読んだか（日本語。画面に出す） */
  columnReport: string[];
  /** 読み飛ばした行の理由（日本語） */
  errors: string[];
  /** 読み飛ばした行数 */
  skipped: number;
  /** 読み取りの補足（日本語） */
  notes: string[];
}

export interface ParseNoticeCsvOptions {
  /** 区切りを指定する（省略時は自動判定） */
  delimiter?: NoticeDelimiter;
  /** 読み取る明細の上限（既定 500） */
  maxRows?: number;
  /** errors に積む件数の上限（既定 20） */
  maxErrors?: number;
}

// ---------------------------------------------------------------------------
// 列名の推測
// ---------------------------------------------------------------------------

/**
 * 列名の候補（前にあるものほど強く一致とみなす）。
 * 1 文字の語（「数」「計」）は部分一致させない（「日数」「合計」に誤爆するため）。
 */
export const NOTICE_HEADER_PATTERNS: Record<NoticeField, string[]> = {
  name: ["内容", "品名", "コース名", "コース", "業務内容", "作業内容", "案件名", "案件", "項目", "品目", "名称", "摘要", "区分", "種別", "item", "name"],
  qty: ["数量", "個数", "件数", "日数", "稼働日数", "稼動日数", "台数", "口数", "本数", "回数", "数", "qty", "count"],
  unit_price: ["単価", "支払単価", "委託単価", "契約単価", "単金", "unitprice", "price"],
  amount: ["金額", "支払金額", "請求金額", "支払額", "合計金額", "合計", "小計", "amount", "total"],
};

/** ヘッダー 1 つとある項目の一致度（0 は不一致） */
export function noticeHeaderScore(header: string, field: NoticeField): number {
  const key = nameKey(header);
  if (!key) return 0;
  let best = 0;
  NOTICE_HEADER_PATTERNS[field].forEach((pattern, index) => {
    const pk = nameKey(pattern);
    if (!pk) return;
    const bonus = Math.max(0, 12 - index);
    if (key === pk) best = Math.max(best, 100 + bonus);
    else if (pk.length >= 2 && (key.startsWith(pk) || key.endsWith(pk))) best = Math.max(best, 70 + bonus);
    else if (pk.length >= 2 && key.includes(pk)) best = Math.max(best, 50 + bonus);
  });
  return best;
}

/**
 * ヘッダー名から列を決める。
 * 一致度の高い組み合わせから順に決め、同じ列を 2 つの項目には割り当てない。
 */
export function guessNoticeColumns(headers: string[]): NoticeColumns {
  const candidates: { field: NoticeField; index: number; score: number }[] = [];
  headers.forEach((header, index) => {
    const name = normalizeName(header);
    if (!name) return;
    for (const field of NOTICE_FIELDS) {
      const score = noticeHeaderScore(name, field);
      if (score > 0) candidates.push({ field, index, score });
    }
  });
  candidates.sort((a, b) => b.score - a.score || a.index - b.index);

  const columns: NoticeColumns = { ...EMPTY_NOTICE_COLUMNS };
  const usedFields = new Set<NoticeField>();
  const usedIndexes = new Set<number>();
  for (const c of candidates) {
    if (usedFields.has(c.field) || usedIndexes.has(c.index)) continue;
    columns[c.field] = c.index;
    usedFields.add(c.field);
    usedIndexes.add(c.index);
  }
  return columns;
}

/** その行がヘッダーらしいか（列名っぽい語の一致 ＋ 埋まっている列の数） */
export function noticeHeaderRowScore(cells: string[]): number {
  const values = cells.map((c) => normalizeName(c));
  const filled = values.filter((v) => v !== "").length;
  if (filled < 2) return 0;
  let hits = 0;
  for (const field of NOTICE_FIELDS) {
    if (values.some((v) => noticeHeaderScore(v, field) > 0)) hits += 1;
  }
  const numeric = values.filter((v) => v !== "" && parseNoticeNumber(v) != null).length;
  return hits * 10 + filled - numeric * 3;
}

/** ヘッダー行を探す（見つからなければ headerRow = -1） */
export function detectNoticeHeader(rows: string[][], limit = NOTICE_HEADER_SEARCH_LIMIT): { headerRow: number; headers: string[] } {
  let bestRow = -1;
  let bestScore = 0;
  const end = Math.min(rows.length, limit);
  for (let i = 0; i < end; i += 1) {
    const score = noticeHeaderRowScore(rows[i] ?? []);
    // 少なくとも 1 項目が列名として当たっていること（hits * 10）
    if (score >= 10 && score > bestScore) {
      bestScore = score;
      bestRow = i;
    }
  }
  if (bestRow < 0) return { headerRow: -1, headers: [] };
  return { headerRow: bestRow, headers: (rows[bestRow] ?? []).map((c) => normalizeName(c)) };
}

// ---------------------------------------------------------------------------
// 数値・行の判定
// ---------------------------------------------------------------------------

/** 金額・数量の読み取り（全角数字・カンマ・「¥」「円」・「個」「件」「日」つきでも読む）。読めなければ null */
export function parseNoticeNumber(raw: string | null | undefined): number | null {
  if (raw == null) return null;
  const cleaned = String(raw).replace(/[^0-9０-９.．,，\-ー−－¥￥円\s]/g, "");
  const n = parseNumberInput(cleaned);
  if (n == null) return null;
  return Math.round(n * 100) / 100;
}

/** 合計・消費税などの集計行（明細として取り込まない） */
const TOTAL_ROW_NAMES = [
  "合計",
  "小計",
  "総計",
  "計",
  "消費税",
  "内消費税",
  "税",
  "税抜",
  "税込",
  "源泉",
  "源泉徴収税",
  "差引",
  "差引支払額",
  "支払合計",
  "請求合計",
  "お支払金額",
  "お支払額",
  "total",
];

export function isNoticeTotalRow(name: string): boolean {
  const key = nameKey(name);
  if (!key) return false;
  return TOTAL_ROW_NAMES.some((t) => nameKey(t) === key);
}

/** 空でない行だけを、元の行番号（1 始まり）つきで取り出す */
function contentRows(rows: string[][]): { cells: string[]; line: number }[] {
  const out: { cells: string[]; line: number }[] = [];
  rows.forEach((cells, index) => {
    if (cells.some((c) => (c ?? "").trim() !== "")) out.push({ cells, line: index + 1 });
  });
  return out;
}

function cellAt(cells: string[], index: number): string {
  return index < 0 ? "" : normalizeName(cells[index] ?? "");
}

// ---------------------------------------------------------------------------
// 区切りと貼り付けテキストの整形
// ---------------------------------------------------------------------------

/** 区切り文字の判定（先頭の数行でタブとコンマの数を比べる。lib/intake/sheet.ts と同じ考え方） */
export function detectNoticeDelimiter(text: string): NoticeDelimiter {
  const head = text.split(/\r\n|\n|\r/).slice(0, 20).join("\n");
  const tabs = (head.match(/\t/g) ?? []).length;
  const commas = (head.match(/,/g) ?? []).length;
  return tabs > commas ? "\t" : ",";
}

/**
 * PDF からコピーした「空白で桁を揃えた表」をタブ区切りに直す。
 * コンマもタブも無く、2 文字以上の空白で区切られた行があるときだけ行う。
 */
export function normalizePastedTable(text: string): { text: string; converted: boolean } {
  if (text.includes("\t") || text.includes(",")) return { text, converted: false };
  const lines = text.split(/\r\n|\n|\r/);
  if (!lines.some((l) => /\S[ 　]{2,}\S/.test(l))) return { text, converted: false };
  return { text: lines.map((l) => l.replace(/[ 　]{2,}/g, "\t")).join("\n"), converted: true };
}

// ---------------------------------------------------------------------------
// ヘッダーが無いときの推測（列の並びから）
// ---------------------------------------------------------------------------

/** 数値として読める割合が高い列を「数値の列」とみなす */
function numericColumns(rows: string[][], width: number): number[] {
  const out: number[] = [];
  for (let c = 0; c < width; c += 1) {
    let filled = 0;
    let numeric = 0;
    for (const cells of rows) {
      const v = (cells[c] ?? "").trim();
      if (v === "") continue;
      filled += 1;
      if (parseNoticeNumber(v) != null) numeric += 1;
    }
    if (filled > 0 && numeric / filled >= 0.6) out.push(c);
  }
  return out;
}

/** その列の値が数量らしいか（すべて 1000 未満） */
function looksLikeQty(rows: string[][], index: number): boolean {
  let seen = 0;
  for (const cells of rows) {
    const n = parseNoticeNumber(cells[index] ?? "");
    if (n == null) continue;
    seen += 1;
    if (Math.abs(n) >= 1000) return false;
  }
  return seen > 0;
}

/** ヘッダーが無いときに、列の並びから 内容・数量・単価・金額 を推測する */
export function guessNoticeColumnsByShape(rows: string[][]): NoticeColumns {
  const width = rows.reduce((max, cells) => Math.max(max, cells.length), 0);
  const columns: NoticeColumns = { ...EMPTY_NOTICE_COLUMNS };
  if (width === 0) return columns;

  const numeric = numericColumns(rows, width);
  const numericSet = new Set(numeric);
  for (let c = 0; c < width; c += 1) {
    if (numericSet.has(c)) continue;
    if (rows.some((cells) => (cells[c] ?? "").trim() !== "")) {
      columns.name = c;
      break;
    }
  }

  if (numeric.length >= 3) {
    columns.qty = numeric[0];
    columns.unit_price = numeric[1];
    columns.amount = numeric[2];
  } else if (numeric.length === 2) {
    if (looksLikeQty(rows, numeric[0])) {
      columns.qty = numeric[0];
      columns.amount = numeric[1];
    } else {
      columns.unit_price = numeric[0];
      columns.amount = numeric[1];
    }
  } else if (numeric.length === 1) {
    columns.amount = numeric[0];
  }
  return columns;
}

// ---------------------------------------------------------------------------
// 本体
// ---------------------------------------------------------------------------

function columnLabel(index: number): string {
  return `${index + 1} 列目`;
}

/** どの列をどう読んだかの説明（日本語） */
function buildColumnReport(columns: NoticeColumns, headers: string[], hasHeader: boolean): string[] {
  const missing: Record<NoticeField, string> = {
    name: "内容 ← 見つかりませんでした（1 列目を内容として読みます）",
    qty: "数量 ← 見つかりませんでした（0 として扱います）",
    unit_price: "単価 ← 見つかりませんでした（金額 ÷ 数量 で計算します）",
    amount: "金額 ← 見つかりませんでした（数量 × 単価 で計算します）",
  };
  return NOTICE_FIELDS.map((field) => {
    const index = columns[field];
    if (index < 0) return missing[field];
    const label = NOTICE_FIELD_LABELS[field];
    const header = headers[index] ?? "";
    if (hasHeader && header) return `${label} ← 「${header}」（${columnLabel(index)}）`;
    return `${label} ← ${columnLabel(index)}（列名が無いため並びから推測）`;
  });
}

/**
 * 支払通知書の明細を読み取る。
 * 読めない行・合計行は取り込まずに errors へ理由を積む（日本語）。
 */
export function parseNoticeCsv(text: string, opts: ParseNoticeCsvOptions = {}): NoticeCsvResult {
  const maxRows = opts.maxRows ?? MAX_NOTICE_CSV_ROWS;
  const maxErrors = opts.maxErrors ?? 20;
  const notes: string[] = [];
  const errors: string[] = [];
  let skipped = 0;
  let hidden = 0;
  const addError = (message: string) => {
    skipped += 1;
    if (errors.length < maxErrors) errors.push(message);
    else hidden += 1;
  };

  const source = (text ?? "").replace(/^﻿/, "");
  const prepared = normalizePastedTable(source);
  if (prepared.converted) notes.push("空白で桁を揃えた表として読み取りました（PDF からの貼り付け）。");

  const delimiter = opts.delimiter ?? detectNoticeDelimiter(prepared.text);
  const all = contentRows(parseCsv(prepared.text, delimiter));

  if (all.length === 0) {
    return {
      rows: [],
      delimiter,
      headerRow: -1,
      headers: [],
      columns: { ...EMPTY_NOTICE_COLUMNS },
      columnReport: [],
      errors: ["中身がありません。支払通知書の CSV を選ぶか、表をそのまま貼り付けてください。"],
      skipped: 0,
      notes,
    };
  }

  const detected = detectNoticeHeader(all.map((r) => r.cells));
  const hasHeader = detected.headerRow >= 0;
  const body = hasHeader ? all.slice(detected.headerRow + 1) : all;

  let columns = hasHeader ? guessNoticeColumns(detected.headers) : guessNoticeColumnsByShape(body.map((r) => r.cells));
  if (hasHeader && NOTICE_FIELDS.every((f) => columns[f] < 0)) {
    columns = guessNoticeColumnsByShape(body.map((r) => r.cells));
  }
  if (!hasHeader) notes.push("列名の行が見つからなかったため、列の並びから推測しました。違っていたら CSV の 1 行目に「内容・数量・単価・金額」の見出しを付けてください。");

  // 内容の列が決まらないときは、数値に使っていない最初の列を使う
  if (columns.name < 0) {
    const used = new Set([columns.qty, columns.unit_price, columns.amount].filter((i) => i >= 0));
    const width = body.reduce((max, r) => Math.max(max, r.cells.length), 0);
    let fallback = 0;
    for (let c = 0; c < width; c += 1) {
      if (!used.has(c)) {
        fallback = c;
        break;
      }
    }
    columns = { ...columns, name: fallback };
    notes.push("内容の列を判定できなかったため、数値以外の最初の列を内容として読みました。");
  }

  const rows: NoticeCsvRow[] = [];
  for (const { cells, line } of body) {
    if (rows.length >= maxRows) {
      errors.push(`明細が ${maxRows} 行を超えたため、${line} 行目以降は取り込みませんでした。`);
      break;
    }
    const rawName = cellAt(cells, columns.name);
    const qtyValue = parseNoticeNumber(cellAt(cells, columns.qty));
    const priceValue = parseNoticeNumber(cellAt(cells, columns.unit_price));
    const amountValue = parseNoticeNumber(cellAt(cells, columns.amount));

    if (isNoticeTotalRow(rawName)) {
      addError(`${line} 行目: 合計・消費税の行のため取り込みませんでした（${rawName}）`);
      continue;
    }
    if (rawName === "" && qtyValue == null && priceValue == null && amountValue == null) continue;
    if (rawName === "") {
      addError(`${line} 行目: 内容が空のため取り込みませんでした`);
      continue;
    }

    let qty = qtyValue ?? 0;
    let unitPrice = priceValue ?? 0;
    let amount = amountValue ?? 0;
    let derived: NoticeCsvRow["derived"] = null;

    if (amount === 0 && qty !== 0 && unitPrice !== 0) {
      amount = mulMoney(qty, unitPrice);
      derived = "amount";
    } else if (unitPrice === 0 && qty !== 0 && amount !== 0) {
      unitPrice = Math.round((amount / qty) * 100) / 100;
      derived = "unit_price";
    }
    if (qty === 0 && unitPrice !== 0 && amount !== 0) {
      qty = Math.round((amount / unitPrice) * 100) / 100;
    }

    if (qty === 0 && unitPrice === 0 && amount === 0) {
      addError(`${line} 行目: 数量・単価・金額をどれも読み取れませんでした（${rawName}）`);
      continue;
    }

    rows.push({ line, raw_name: rawName.slice(0, 200), qty, unit_price: unitPrice, amount, derived });
  }

  if (hidden > 0) errors.push(`ほか ${hidden} 行を取り込みませんでした。`);
  if (rows.length === 0 && errors.length === 0) errors.push("取り込める明細がありませんでした。列の見出しと中身を確認してください。");

  return {
    rows,
    delimiter,
    headerRow: detected.headerRow,
    headers: detected.headers,
    columns,
    columnReport: buildColumnReport(columns, detected.headers, hasHeader),
    errors,
    skipped,
    notes,
  };
}

/** 読み取り結果の 1 行まとめ（トースト・画面の見出しに使う） */
export function noticeCsvSummaryText(result: NoticeCsvResult): string {
  if (result.rows.length === 0) return "取り込める明細がありませんでした。";
  const total = sumMoney(result.rows.map((r) => r.amount));
  const skipped = result.skipped > 0 ? `／読み飛ばし ${result.skipped} 行` : "";
  return `${result.rows.length} 行・合計 ${yen(total)}${skipped}`;
}

/** 読み取った明細の合計金額 */
export function noticeCsvTotal(rows: { amount: number }[]): number {
  return sumMoney(rows.map((r) => r.amount));
}
