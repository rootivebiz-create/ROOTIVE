/**
 * Excel・CSV を「文字の表（string[][]）」にする共通の読み取り。取り込み（稼働）と元請の支払通知の両方で使う。
 * - xlsx は exceljs、csv/tsv/txt は文字コードを自動判定（UTF-8（BOM あり・なし）→ だめなら Shift_JIS）
 * - 見出し行は「文字の多い行」を上から探して当てる（タイトル行・作成者の行・空行を飛ばす）
 * - 合計・小計の行は見分けられるようにする（取り込まない）
 * DB に触らない。サーバーでもテストでも使える。
 */
import ExcelJS from "exceljs";

export type Sheet = { name: string; rows: string[][] };
export type ReadResult = { sheets: Sheet[]; encoding: "xlsx" | "utf-8" | "shift_jis" };

export class TableReadError extends Error {}

const MAX_ROWS = 20000;
const MAX_COLS = 200;

/** ファイル名とバイト列から表を読む */
export async function readTable(fileName: string, data: ArrayBuffer | Uint8Array): Promise<ReadResult> {
  const bytes = data instanceof Uint8Array ? data : new Uint8Array(data);
  const lower = fileName.toLowerCase();
  if (lower.endsWith(".xlsx") || lower.endsWith(".xlsm") || isZip(bytes)) {
    return { sheets: await readXlsx(bytes), encoding: "xlsx" };
  }
  if (lower.endsWith(".xls")) {
    throw new TableReadError("古い形式の Excel（.xls）は読めません。Excel で「名前を付けて保存」→「Excel ブック（.xlsx）」にしてから上げてください");
  }
  if (lower.endsWith(".pdf")) {
    throw new TableReadError("PDF は読めません。元請の画面から CSV か Excel でダウンロードできないか確かめてください");
  }
  const { text, encoding } = decodeText(bytes);
  const delimiter = lower.endsWith(".tsv") || (!text.includes(",") && text.includes("\t")) ? "\t" : ",";
  return { sheets: [{ name: fileName.replace(/\.[^.]+$/, ""), rows: parseCsv(text, delimiter) }], encoding };
}

function isZip(bytes: Uint8Array): boolean {
  return bytes.length > 4 && bytes[0] === 0x50 && bytes[1] === 0x4b && bytes[2] === 0x03 && bytes[3] === 0x04;
}

/** UTF-8 として正しく読めればそれ、読めなければ Shift_JIS（Windows の Excel が出す CSV） */
export function decodeText(bytes: Uint8Array): { text: string; encoding: "utf-8" | "shift_jis" } {
  let start = 0;
  if (bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) start = 3;
  try {
    const text = new TextDecoder("utf-8", { fatal: true }).decode(bytes.subarray(start));
    return { text, encoding: "utf-8" };
  } catch {
    return { text: new TextDecoder("shift_jis").decode(bytes), encoding: "shift_jis" };
  }
}

/** RFC 4180 に沿った CSV の読み取り（" で囲んだ中のカンマ・改行・"" に対応） */
export function parseCsv(text: string, delimiter = ","): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          cell += '"';
          i++;
        } else quoted = false;
      } else cell += c;
      continue;
    }
    if (c === '"' && cell === "") quoted = true;
    else if (c === delimiter) {
      row.push(cell);
      cell = "";
    } else if (c === "\n" || c === "\r") {
      if (c === "\r" && text[i + 1] === "\n") i++;
      row.push(cell);
      rows.push(row);
      row = [];
      cell = "";
      if (rows.length >= MAX_ROWS) break;
    } else cell += c;
  }
  if (cell !== "" || row.length > 0) {
    row.push(cell);
    rows.push(row);
  }
  return rows.map((r) => r.slice(0, MAX_COLS).map((v) => v.trim()));
}

async function readXlsx(bytes: Uint8Array): Promise<Sheet[]> {
  const wb = new ExcelJS.Workbook();
  try {
    await wb.xlsx.load(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer);
  } catch {
    throw new TableReadError("Excel のファイルを開けませんでした。パスワードが付いていないか、壊れていないか確かめてください");
  }
  const sheets: Sheet[] = [];
  wb.eachSheet((ws) => {
    if (ws.state && ws.state !== "visible") return;
    const rows: string[][] = [];
    const last = Math.min(ws.rowCount, MAX_ROWS);
    for (let r = 1; r <= last; r++) {
      const row = ws.getRow(r);
      const cells: string[] = [];
      const width = Math.min(row.cellCount, MAX_COLS);
      for (let c = 1; c <= width; c++) cells.push(cellText(row.getCell(c).value));
      rows.push(cells);
    }
    sheets.push({ name: ws.name, rows });
  });
  if (sheets.length === 0) throw new TableReadError("Excel の中に表が見つかりませんでした");
  return sheets;
}

/** セルの値を文字にする（数式は計算結果、日付は YYYY-MM-DD） */
export function cellText(value: ExcelJS.CellValue): string {
  if (value === null || value === undefined) return "";
  if (value instanceof Date) return isoDate(value);
  if (typeof value === "number") return Number.isInteger(value) ? String(value) : String(Math.round(value * 10000) / 10000);
  if (typeof value === "boolean") return value ? "TRUE" : "FALSE";
  if (typeof value === "string") return value.trim();
  if (typeof value === "object") {
    if ("result" in value) return cellText((value as { result?: ExcelJS.CellValue }).result ?? null);
    if ("richText" in value) return (value as ExcelJS.CellRichTextValue).richText.map((t) => t.text).join("").trim();
    if ("text" in value) return String((value as { text: unknown }).text ?? "").trim();
    if ("error" in value) return "";
  }
  return String(value).trim();
}

function isoDate(d: Date): string {
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-${String(d.getUTCDate()).padStart(2, "0")}`;
}

// ---------------------------------------------------------------- 値の読み取り

/** 全角・カンマ・円・個などの付いた数を読む。読めなければ null */
export function parseNumberCell(value: string): number | null {
  if (!value) return null;
  let v = value.normalize("NFKC").replace(/[,\s]/g, "").replace(/^[¥￥]/, "").replace(/(円|個|件|日|時間|h|便|台|回|本)$/i, "");
  let negative = false;
  if (/^\(.*\)$/.test(v) || /^△|^▲/.test(v)) {
    negative = true;
    v = v.replace(/^\(|\)$/g, "").replace(/^[△▲]/, "");
  }
  if (!/^[-+]?\d+(\.\d+)?$/.test(v)) return null;
  const n = Number(v);
  return negative ? -n : n;
}

/** 日付らしい文字（2026/10/31・2026-10-31・R8.10.31・10/31・Excel の通し番号）を YYYY-MM-DD にする */
export function parseDateCell(value: string, fallbackYear?: number): string | null {
  if (!value) return null;
  const v = value.normalize("NFKC").trim();
  let m = v.match(/^(\d{4})[-/.年](\d{1,2})[-/.月](\d{1,2})日?/);
  if (m) return ymd(Number(m[1]), Number(m[2]), Number(m[3]));
  m = v.match(/^R(\d{1,2})[-/.年](\d{1,2})[-/.月](\d{1,2})/i) ?? v.match(/^令和(\d{1,2})年(\d{1,2})月(\d{1,2})日/);
  if (m) return ymd(2018 + Number(m[1]), Number(m[2]), Number(m[3]));
  m = v.match(/^(\d{1,2})[/月](\d{1,2})日?$/);
  if (m && fallbackYear) return ymd(fallbackYear, Number(m[1]), Number(m[2]));
  if (/^\d{5}$/.test(v)) {
    const serial = Number(v);
    if (serial > 30000 && serial < 60000) {
      const d = new Date(Date.UTC(1899, 11, 30) + serial * 86400000);
      return isoDate(d);
    }
  }
  return null;
}

function ymd(y: number, m: number, d: number): string | null {
  if (m < 1 || m > 12 || d < 1 || d > 31) return null;
  const date = new Date(Date.UTC(y, m - 1, d));
  if (date.getUTCMonth() !== m - 1) return null;
  return isoDate(date);
}

// ---------------------------------------------------------------- 見出し行と合計行

/** 合計・小計の行か（取り込まない） */
export function isTotalRow(row: string[]): boolean {
  return row.some((c) => /^(総?合計|小計|計|total|sum)$/i.test(c.normalize("NFKC").replace(/\s/g, "")));
}

export function isBlankRow(row: string[]): boolean {
  return row.every((c) => c.trim() === "");
}

/**
 * 見出し行を探す：上から 30 行のうち、「文字（数でも日付でもない）のセルが 2 つ以上あり、
 * その下の行に数が入っている」いちばん上の行。見つからなければ 0。
 */
export function detectHeaderRow(rows: string[][]): number {
  const limit = Math.min(rows.length, 30);
  let best = -1;
  let bestScore = 0;
  for (let i = 0; i < limit; i++) {
    const row = rows[i];
    const texts = row.filter((c) => c && parseNumberCell(c) === null && parseDateCell(c) === null).length;
    if (texts < 2) continue;
    const below = rows.slice(i + 1, i + 6);
    const numericBelow = below.some((r) => r.some((c) => parseNumberCell(c) !== null));
    if (!numericBelow) continue;
    const score = texts + (row.filter(Boolean).length === texts ? 1 : 0);
    if (score > bestScore) {
      best = i;
      bestScore = score;
    }
    // 見出しは上のほうにあるので、はっきりした行が見つかったらそこで止める
    if (texts >= 3) break;
  }
  return best < 0 ? 0 : best;
}

/** 見出しの並びから作る目印（同じ形のファイルを翌月も見分ける）。空白・記号・全角半角の違いは無視 */
export function headerSignature(header: string[]): string {
  return header
    .map((h) => normalizeHeader(h))
    .filter(Boolean)
    .join("|");
}

export function normalizeHeader(h: string): string {
  return h
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[\s　・:：()（）[\]「」【】]/g, "");
}

/** 見出し行より下の、データの行だけ（空行・合計行を除き、元の行番号を付ける。行番号は 1 始まり） */
export function dataRows(rows: string[][], headerIndex: number): { rowNo: number; cells: string[] }[] {
  const out: { rowNo: number; cells: string[] }[] = [];
  for (let i = headerIndex + 1; i < rows.length; i++) {
    const cells = rows[i];
    if (isBlankRow(cells) || isTotalRow(cells)) continue;
    out.push({ rowNo: i + 1, cells });
  }
  return out;
}
