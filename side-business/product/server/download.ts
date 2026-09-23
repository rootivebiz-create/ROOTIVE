import "server-only";
import iconv from "iconv-lite";

/**
 * ダウンロードの共通部品（CSV・全銀・PDF）。
 * - CSV は既定で UTF-8（BOM 付き。Excel で文字化けしない）。会計ソフト向けは Shift_JIS も選べる
 * - ファイル名は日本語のまま（RFC 5987 の filename*）
 */
export type CsvCell = string | number | null | undefined;

export function csvLine(cells: CsvCell[]): string {
  return cells
    .map((c) => {
      if (c === null || c === undefined) return "";
      if (typeof c === "number") return String(c);
      // 表計算ソフトで式として動かないようにする（= + @ や、数でない - で始まる文字）
      const v = /^[=+@\t\r]/.test(c) || /^-(?!\d+(\.\d+)?$)/.test(c) ? `'${c}` : c;
      return /[",\r\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v;
    })
    .join(",");
}

export function csvText(rows: CsvCell[][]): string {
  return rows.map(csvLine).join("\r\n") + "\r\n";
}

/** Shift_JIS（cp932）にする。表せない文字は「?」にして、その文字の一覧を返す */
export function encodeSjis(text: string): { bytes: Uint8Array; unmappable: string[] } {
  const unmappable = new Set<string>();
  for (const ch of text) {
    const back = iconv.decode(iconv.encode(ch, "cp932"), "cp932");
    if (back !== ch) unmappable.add(ch);
  }
  return { bytes: new Uint8Array(iconv.encode(text, "cp932")), unmappable: [...unmappable] };
}

export function utf8WithBom(text: string): Uint8Array {
  return new TextEncoder().encode("﻿" + text);
}

export function fileResponse(body: Uint8Array | string, fileName: string, contentType: string): Response {
  const ascii = fileName.replace(/[^\x20-\x7e]/g, "_").replace(/"/g, "");
  const data = typeof body === "string" ? new TextEncoder().encode(body) : body;
  return new Response(data as BodyInit, {
    headers: {
      "Content-Type": contentType,
      "Content-Disposition": `attachment; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(fileName)}`,
      "Cache-Control": "no-store",
    },
  });
}
