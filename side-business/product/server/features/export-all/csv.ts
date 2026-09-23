/**
 * 全データの書き出しの CSV（純関数）。表計算ソフトで開けて、しかも読み戻したときに 1 文字も変わらない形にする。
 * - 空欄（引用符なし）＝値なし（NULL）、""（引用符だけ）＝空の文字
 * - 文字の列で、頭が = + - @ ' タブ 改行 のものは、式として動かないよう ' を 1 つ付ける（読み戻すときに 1 つ外す）
 * - 配列と JSON の列は JSON の文字で入れる
 * - 行の区切りは CRLF。文字コードは UTF-8（BOM は書き出す側で付ける）
 */

/** 列の型から、文字の列か（頭に ' を付ける対象か） */
export function isTextType(sqlType: string): boolean {
  return sqlType === "text" || sqlType.startsWith("varchar") || sqlType.startsWith("character");
}

export function isJsonType(sqlType: string): boolean {
  return sqlType === "jsonb" || sqlType === "json";
}

export function isArrayType(sqlType: string): boolean {
  return sqlType.endsWith("[]");
}

const GUARD = /^[=+\-@'\t\r]/;

/** DB の値（to_jsonb で読んだもの）→ CSV のセルの文字（null は値なし） */
export function toCell(value: unknown, sqlType: string): string | null {
  if (value === null || value === undefined) return null;
  if (isJsonType(sqlType) || isArrayType(sqlType)) return JSON.stringify(value);
  if (typeof value === "string") return isTextType(sqlType) && GUARD.test(value) ? `'${value}` : value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  return JSON.stringify(value);
}

/** CSV のセルの文字 → DB に入れる値（json_populate_recordset に渡す形） */
export function fromCell(cell: string | null, sqlType: string): unknown {
  if (cell === null) return null;
  if (isJsonType(sqlType) || isArrayType(sqlType)) return JSON.parse(cell);
  if (isTextType(sqlType) && cell.startsWith("'")) return cell.slice(1);
  if (sqlType === "boolean") return cell === "true";
  return cell;
}

function quote(cell: string | null): string {
  if (cell === null) return "";
  if (cell === "" || /[",\r\n]/.test(cell) || cell.trim() !== cell) return `"${cell.replace(/"/g, '""')}"`;
  return cell;
}

/** 見出しと行から CSV の文字にする */
export function encodeCsv(header: string[], rows: (string | null)[][]): string {
  return [header.map(quote).join(","), ...rows.map((r) => r.map(quote).join(","))].join("\r\n") + "\r\n";
}

/**
 * CSV の文字を読む（RFC 4180。引用符の中の改行・"" に対応）。
 * 引用符なしの空欄は null、引用符つきの空欄は "" として返す。
 */
export function parseCsv(text: string): { header: string[]; rows: (string | null)[][] } {
  const src = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
  const n = src.length;
  const records: (string | null)[][] = [];
  if (n === 0) return { header: [], rows: [] };
  let row: (string | null)[] = [];
  let i = 0;
  for (;;) {
    // セルを 1 つ読む
    let cell: string | null;
    if (src[i] === '"') {
      let out = "";
      i++;
      for (;;) {
        if (i >= n) throw new Error("CSV の引用符が閉じていません");
        const ch = src[i];
        if (ch === '"') {
          if (src[i + 1] === '"') {
            out += '"';
            i += 2;
            continue;
          }
          i++;
          break;
        }
        out += ch;
        i++;
      }
      cell = out;
    } else {
      let j = i;
      while (j < n && src[j] !== "," && src[j] !== "\r" && src[j] !== "\n") j++;
      const raw = src.slice(i, j);
      cell = raw === "" ? null : raw;
      i = j;
    }
    row.push(cell);
    if (i >= n) {
      records.push(row);
      break;
    }
    const sep = src[i];
    if (sep === ",") {
      i++;
      continue;
    }
    if (sep === "\r" || sep === "\n") {
      i += sep === "\r" && src[i + 1] === "\n" ? 2 : 1;
      records.push(row);
      row = [];
      if (i >= n) break;
      continue;
    }
    throw new Error("CSV の形が正しくありません（引用符のあとに文字があります）");
  }
  const [header = [], ...rows] = records;
  return { header: header.map((h) => h ?? ""), rows };
}
