/**
 * Excel（.xlsx）出力の基盤（依存なし・純関数）
 * - OOXML（SpreadsheetML）の最小構成を組み立てて lib/exports/zip.ts の buildZip() で 1 つの .xlsx にする
 * - 共有文字列（sharedStrings）は使わず t="inlineStr" で書く（実装が単純で壊れにくい）
 * - 書式は styles.xml の numFmt：金額 #,##0;[Red]-#,##0 ／ 率 0.0% ／ 数量 #,##0.## ／ 日付 yyyy/mm/dd
 * - 先頭行は見出しとして扱う（太字・薄い背景・下罫線。freezeHeader でウィンドウ枠を固定）
 */
import { buildZip, type ZipEntry } from "./zip";

// ---------------------------------------------------------------------------
// 型
// ---------------------------------------------------------------------------

/** セルの種類（既定は text。数値として書けないときは文字列にフォールバックする） */
export type XlsxCellType = "text" | "number" | "money" | "percent" | "date" | "qty";

/** 書式や太字を指定したいセル */
export interface XlsxCellObject {
  v: string | number | null;
  t?: XlsxCellType;
  bold?: boolean;
}

/** セル（そのままの値、または書式付きのセル） */
export type XlsxCell = string | number | null | undefined | XlsxCellObject;

/** 列の指定（今のところ幅だけ） */
export interface XlsxColumn {
  /** 文字数での列幅（未指定なら中身から概算する） */
  width?: number;
}

/** 1 シート分（rows の先頭行が見出し） */
export interface XlsxSheet {
  /** シート名（Excel の制約に合わせて正規化・重複回避する） */
  name: string;
  columns?: readonly (XlsxColumn | undefined)[];
  rows: readonly XlsxCell[][];
  /** 先頭行（見出し）を固定するか */
  freezeHeader?: boolean;
  /** 見出し行にオートフィルタを付けるか */
  autoFilter?: boolean;
}

// ---------------------------------------------------------------------------
// スタイル（cellXfs の並び順と一致させること）
// ---------------------------------------------------------------------------

const STYLE_TEXT = 0;
const STYLE_MONEY = 1;
const STYLE_PERCENT = 2;
const STYLE_QTY = 3;
const STYLE_DATE = 4;
/** 太字版は +5（cellXfs の 5〜9） */
const STYLE_BOLD_OFFSET = 5;
/** 見出し行のスタイル（太字＋薄い背景＋下罫線） */
export const XLSX_HEADER_STYLE = 10;

/** 書式ごとの numFmtId（styles.xml の numFmts と一致させること） */
export const XLSX_NUM_FMT_IDS = { money: 164, percent: 165, qty: 166, date: 167 } as const;

function baseStyle(t: XlsxCellType | undefined): number {
  switch (t) {
    case "money":
      return STYLE_MONEY;
    case "percent":
      return STYLE_PERCENT;
    case "qty":
      return STYLE_QTY;
    case "date":
      return STYLE_DATE;
    default:
      return STYLE_TEXT;
  }
}

// ---------------------------------------------------------------------------
// 小さな道具
// ---------------------------------------------------------------------------

/** 列番号（0 始まり）→ 列名（A, B, …, Z, AA, AZ, BA, …） */
export function colName(index: number): string {
  let n = (Number.isFinite(index) ? Math.max(0, Math.floor(index)) : 0) + 1;
  let out = "";
  while (n > 0) {
    const rem = (n - 1) % 26;
    out = String.fromCharCode(65 + rem) + out;
    n = Math.floor((n - 1) / 26);
  }
  return out;
}

/** XML のエスケープ（制御文字は XML 1.0 で表現できないため取り除く） */
export function escapeXml(value: string): string {
  return value
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2})(?::(\d{2}))?)?(?:\.\d+)?(?:Z|[+-]\d{2}:?\d{2})?$/;

/** "YYYY-MM-DD"（時刻付きも可）→ Excel の日付シリアル値（1899-12-30 起点）。解釈できなければ null */
export function excelDateSerial(value: string | number | null | undefined): number | null {
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value !== "string") return null;
  const m = DATE_RE.exec(value.trim());
  if (!m) return null;
  const y = Number(m[1]);
  const mo = Number(m[2]);
  const d = Number(m[3]);
  const utc = Date.UTC(y, mo - 1, d);
  const dt = new Date(utc);
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== mo - 1 || dt.getUTCDate() !== d) return null;
  return Math.round(utc / 86_400_000) + 25_569;
}

/** Excel のシート名の制約に合わせる（禁止文字を除去・31 文字まで・空なら Sheet1） */
export function normalizeSheetName(name: string): string {
  const cleaned = String(name ?? "")
    .replace(/[:\\/?*[\]]/g, "")
    .replace(/[\u0000-\u001f\u007f]/g, "")
    .trim();
  const trimmed = cleaned.slice(0, 31).replace(/^'+|'+$/g, "").trim();
  return trimmed === "" ? "Sheet1" : trimmed;
}

/** 既に使った名前と重ならないよう末尾に "(2)", "(3)" … を付ける（大文字小文字は区別しない） */
export function uniqueSheetName(name: string, used: Set<string>): string {
  const base = normalizeSheetName(name);
  let candidate = base;
  for (let n = 2; used.has(candidate.toLowerCase()); n++) {
    const suffix = `(${n})`;
    candidate = base.slice(0, Math.max(1, 31 - suffix.length)) + suffix;
  }
  used.add(candidate.toLowerCase());
  return candidate;
}

/** 半角は 1・全角は 2 で数える表示幅（列幅の概算に使う） */
export function displayWidth(text: string): number {
  let w = 0;
  for (const ch of text) w += /[ -~｡-ﾟ]/.test(ch) ? 1 : 2;
  return w;
}

// ---------------------------------------------------------------------------
// セルの解決
// ---------------------------------------------------------------------------

interface ResolvedCell {
  kind: "empty" | "number" | "text";
  num: number;
  text: string;
  style: number;
}

function isCellObject(cell: XlsxCell): cell is XlsxCellObject {
  return typeof cell === "object" && cell !== null;
}

/** セル → 書き出す値とスタイル（数値にできないものは文字列へフォールバックする） */
function resolveCell(cell: XlsxCell, isHeader: boolean): ResolvedCell {
  const obj = isCellObject(cell) ? cell : { v: cell ?? null };
  const type = isCellObject(cell) ? cell.t : undefined;
  const bold = isCellObject(cell) ? cell.bold === true : false;
  const raw = obj.v ?? null;
  const style = isHeader ? XLSX_HEADER_STYLE : baseStyle(type) + (bold ? STYLE_BOLD_OFFSET : 0);
  const textStyle = isHeader ? XLSX_HEADER_STYLE : STYLE_TEXT + (bold ? STYLE_BOLD_OFFSET : 0);
  const empty: ResolvedCell = { kind: "empty", num: 0, text: "", style };

  if (raw === null) return empty;
  if (typeof raw === "string" && raw.trim() === "") return empty;

  if (type === "date") {
    const serial = excelDateSerial(raw);
    if (serial != null) return { kind: "number", num: serial, text: "", style };
    return { kind: "text", num: 0, text: String(raw), style: textStyle };
  }

  if (typeof raw === "number") {
    return Number.isFinite(raw) ? { kind: "number", num: raw, text: "", style } : { kind: "text", num: 0, text: String(raw), style: textStyle };
  }

  if (type === "number" || type === "money" || type === "percent" || type === "qty") {
    const n = Number(String(raw).trim());
    if (Number.isFinite(n)) return { kind: "number", num: n, text: "", style };
    return { kind: "text", num: 0, text: String(raw), style: textStyle };
  }

  return { kind: "text", num: 0, text: String(raw), style: textStyle };
}

/** 数値の書き出し（指数表記を避ける） */
function numberText(n: number): string {
  if (Number.isInteger(n)) return String(n);
  const s = String(n);
  return s.includes("e") || s.includes("E") ? n.toFixed(10).replace(/0+$/, "").replace(/\.$/, "") : s;
}

// ---------------------------------------------------------------------------
// CSV の行配列（CsvValue[][]）→ シート
// ---------------------------------------------------------------------------

export interface SheetFromRowsOptions {
  /** 列ごとのセル型（見出し行には適用しない）。足りない列は "text" */
  types?: readonly (XlsxCellType | undefined)[];
  /** 列ごとの幅（文字数） */
  widths?: readonly (number | undefined)[];
  /** 見出し行にオートフィルタを付けるか（既定 true） */
  autoFilter?: boolean;
  /** 先頭行を固定するか（既定 true） */
  freezeHeader?: boolean;
  /** 最終行を合計行として太字にするか */
  boldLastRow?: boolean;
}

/**
 * CSV と同じ「先頭が見出しの行配列」から 1 シートを作る。
 * 列ごとに型を指定すると、rawNumber() が作った文字列も数値セルとして書き出される。
 */
export function sheetFromRows(name: string, rows: readonly XlsxCell[][], opts: SheetFromRowsOptions = {}): XlsxSheet {
  const types = opts.types ?? [];
  const lastIndex = rows.length - 1;
  const cells: XlsxCell[][] = rows.map((row, r) => {
    if (r === 0) return [...row];
    const bold = opts.boldLastRow === true && r === lastIndex;
    return row.map((cell, c) => {
      if (isCellObject(cell)) return bold ? { ...cell, bold: true } : cell;
      return { v: cell ?? null, t: types[c] ?? "text", bold };
    });
  });
  const columns = opts.widths ? opts.widths.map((w) => (w == null ? undefined : { width: w })) : undefined;
  return {
    name,
    rows: cells,
    columns,
    freezeHeader: opts.freezeHeader ?? true,
    autoFilter: opts.autoFilter ?? true,
  };
}

// ---------------------------------------------------------------------------
// 各パートの XML
// ---------------------------------------------------------------------------

const XML_HEAD = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>';
const NS_MAIN = "http://schemas.openxmlformats.org/spreadsheetml/2006/main";
const NS_REL_DOC = "http://schemas.openxmlformats.org/officeDocument/2006/relationships";
const NS_PKG_REL = "http://schemas.openxmlformats.org/package/2006/relationships";

function contentTypesXml(sheetCount: number): string {
  const sheets = Array.from(
    { length: sheetCount },
    (_v, i) =>
      `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`,
  ).join("");
  return (
    `${XML_HEAD}<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">` +
    '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
    '<Default Extension="xml" ContentType="application/xml"/>' +
    '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>' +
    sheets +
    '<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>' +
    "</Types>"
  );
}

function rootRelsXml(): string {
  return (
    `${XML_HEAD}<Relationships xmlns="${NS_PKG_REL}">` +
    `<Relationship Id="rId1" Type="${NS_REL_DOC}/officeDocument" Target="xl/workbook.xml"/>` +
    "</Relationships>"
  );
}

function workbookXml(names: string[]): string {
  const sheets = names.map((n, i) => `<sheet name="${escapeXml(n)}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`).join("");
  return `${XML_HEAD}<workbook xmlns="${NS_MAIN}" xmlns:r="${NS_REL_DOC}"><sheets>${sheets}</sheets></workbook>`;
}

function workbookRelsXml(sheetCount: number): string {
  const sheets = Array.from(
    { length: sheetCount },
    (_v, i) => `<Relationship Id="rId${i + 1}" Type="${NS_REL_DOC}/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`,
  ).join("");
  return (
    `${XML_HEAD}<Relationships xmlns="${NS_PKG_REL}">` +
    sheets +
    `<Relationship Id="rId${sheetCount + 1}" Type="${NS_REL_DOC}/styles" Target="styles.xml"/>` +
    "</Relationships>"
  );
}

/** cellXfs：0 標準 / 1 金額 / 2 率 / 3 数量 / 4 日付 / 5〜9 それぞれの太字 / 10 見出し */
function stylesXml(): string {
  const { money, percent, qty, date } = XLSX_NUM_FMT_IDS;
  const xf = (numFmtId: number, fontId: number) =>
    `<xf numFmtId="${numFmtId}" fontId="${fontId}" fillId="0" borderId="0" xfId="0" applyNumberFormat="1" applyFont="1"/>`;
  const body = [xf(0, 0), xf(money, 0), xf(percent, 0), xf(qty, 0), xf(date, 0), xf(0, 1), xf(money, 1), xf(percent, 1), xf(qty, 1), xf(date, 1)].join("");
  return (
    `${XML_HEAD}<styleSheet xmlns="${NS_MAIN}">` +
    '<numFmts count="4">' +
    `<numFmt numFmtId="${money}" formatCode="#,##0;[Red]-#,##0"/>` +
    `<numFmt numFmtId="${percent}" formatCode="0.0%"/>` +
    `<numFmt numFmtId="${qty}" formatCode="#,##0.##"/>` +
    `<numFmt numFmtId="${date}" formatCode="yyyy/mm/dd"/>` +
    "</numFmts>" +
    '<fonts count="2">' +
    '<font><sz val="11"/><color theme="1"/><name val="Yu Gothic"/><family val="2"/><charset val="128"/></font>' +
    '<font><b/><sz val="11"/><color theme="1"/><name val="Yu Gothic"/><family val="2"/><charset val="128"/></font>' +
    "</fonts>" +
    '<fills count="3">' +
    '<fill><patternFill patternType="none"/></fill>' +
    '<fill><patternFill patternType="gray125"/></fill>' +
    '<fill><patternFill patternType="solid"><fgColor rgb="FFF2F2F2"/><bgColor indexed="64"/></patternFill></fill>' +
    "</fills>" +
    '<borders count="2">' +
    "<border><left/><right/><top/><bottom/><diagonal/></border>" +
    '<border><left/><right/><top/><bottom style="thin"><color rgb="FFBFBFBF"/></bottom><diagonal/></border>' +
    "</borders>" +
    '<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>' +
    '<cellXfs count="11">' +
    body +
    '<xf numFmtId="0" fontId="1" fillId="2" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment vertical="center"/></xf>' +
    "</cellXfs>" +
    '<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>' +
    "</styleSheet>"
  );
}

/** 列幅：指定が無ければ中身の表示幅から概算する（最小 6・最大 40） */
function resolveWidths(sheet: XlsxSheet, columnCount: number): number[] {
  const given = sheet.columns ?? [];
  const widths: number[] = [];
  for (let c = 0; c < columnCount; c++) {
    const w = given[c]?.width;
    if (w != null && Number.isFinite(w)) {
      widths.push(Math.min(80, Math.max(2, w)));
      continue;
    }
    let max = 0;
    for (const row of sheet.rows) {
      const cell = row[c];
      const value = isCellObject(cell) ? cell.v : cell;
      if (value == null) continue;
      max = Math.max(max, displayWidth(typeof value === "number" ? numberText(value) : String(value)));
    }
    widths.push(Math.min(40, Math.max(6, max + 2)));
  }
  return widths;
}

function worksheetXml(sheet: XlsxSheet): string {
  const rows = sheet.rows;
  const columnCount = rows.reduce((n, row) => Math.max(n, row.length), 0);
  const lastCol = colName(Math.max(0, columnCount - 1));
  const dimension = rows.length === 0 || columnCount === 0 ? "A1" : `A1:${lastCol}${rows.length}`;

  const freeze =
    sheet.freezeHeader && rows.length > 0
      ? '<pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/><selection pane="bottomLeft" activeCell="A2" sqref="A2"/>'
      : "";
  const views = `<sheetViews><sheetView workbookViewId="0">${freeze}</sheetView></sheetViews>`;

  const widths = resolveWidths(sheet, columnCount);
  const cols = widths.length
    ? `<cols>${widths.map((w, i) => `<col min="${i + 1}" max="${i + 1}" width="${w}" customWidth="1"/>`).join("")}</cols>`
    : "";

  const body = rows
    .map((row, r) => {
      const isHeader = r === 0;
      const cells = row
        .map((cell, c) => {
          const ref = `${colName(c)}${r + 1}`;
          const resolved = resolveCell(cell, isHeader);
          const s = resolved.style === 0 ? "" : ` s="${resolved.style}"`;
          if (resolved.kind === "empty") return `<c r="${ref}"${s}/>`;
          if (resolved.kind === "number") return `<c r="${ref}"${s}><v>${numberText(resolved.num)}</v></c>`;
          return `<c r="${ref}"${s} t="inlineStr"><is><t xml:space="preserve">${escapeXml(resolved.text)}</t></is></c>`;
        })
        .join("");
      return `<row r="${r + 1}"${isHeader ? ' ht="20" customHeight="1"' : ""}>${cells}</row>`;
    })
    .join("");

  const autoFilter = sheet.autoFilter && rows.length > 0 && columnCount > 0 ? `<autoFilter ref="A1:${lastCol}${rows.length}"/>` : "";

  return (
    `${XML_HEAD}<worksheet xmlns="${NS_MAIN}">` +
    `<dimension ref="${dimension}"/>` +
    views +
    '<sheetFormatPr defaultRowHeight="18"/>' +
    cols +
    `<sheetData>${body}</sheetData>` +
    autoFilter +
    "</worksheet>"
  );
}

// ---------------------------------------------------------------------------
// 本体
// ---------------------------------------------------------------------------

/** シート一覧 → .xlsx のバイト列 */
export function buildXlsx(sheets: XlsxSheet[], opts: { now?: Date } = {}): Uint8Array {
  if (!Array.isArray(sheets) || sheets.length === 0) throw new Error("Excel に出力するシートがありません。");
  const encoder = new TextEncoder();
  const used = new Set<string>();
  const names = sheets.map((s) => uniqueSheetName(s.name, used));

  const entries: ZipEntry[] = [
    { name: "[Content_Types].xml", data: encoder.encode(contentTypesXml(sheets.length)) },
    { name: "_rels/.rels", data: encoder.encode(rootRelsXml()) },
    { name: "xl/workbook.xml", data: encoder.encode(workbookXml(names)) },
    { name: "xl/_rels/workbook.xml.rels", data: encoder.encode(workbookRelsXml(sheets.length)) },
    { name: "xl/styles.xml", data: encoder.encode(stylesXml()) },
    ...sheets.map((sheet, i) => ({ name: `xl/worksheets/sheet${i + 1}.xml`, data: encoder.encode(worksheetXml(sheet)) })),
  ];

  return buildZip(entries, { now: opts.now });
}

/** .xlsx の Content-Type */
export const XLSX_CONTENT_TYPE = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

/** CSV のファイル名（.csv）→ Excel のファイル名（.xlsx） */
export function xlsxFilename(csvFilename: string): string {
  return csvFilename.replace(/\.csv$/i, "") + ".xlsx";
}
