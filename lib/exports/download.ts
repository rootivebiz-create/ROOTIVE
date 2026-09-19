/**
 * ダウンロード応答の共通処理（Route Handler から使う。Next.js に依存しない純粋な Response 生成）
 * - 日本語ファイル名：Content-Disposition に ASCII の代替名と RFC 5987（filename*=UTF-8''...）の両方を付ける
 */

/** RFC 5987 用のパーセントエンコード（encodeURIComponent が残す ' ( ) * も符号化する） */
export function encodeRfc5987(value: string): string {
  return encodeURIComponent(value).replace(/['()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);
}

/** ASCII だけの代替ファイル名（非 ASCII を含む場合は export.<拡張子>） */
export function asciiFallbackName(filename: string): string {
  if (/^[\x20-\x7e]+$/.test(filename) && !/["\\]/.test(filename)) return filename;
  const m = /\.([A-Za-z0-9]+)$/.exec(filename);
  return `export${m ? `.${m[1].toLowerCase()}` : ""}`;
}

/** Content-Disposition ヘッダー値（attachment） */
export function contentDisposition(filename: string): string {
  return `attachment; filename="${asciiFallbackName(filename)}"; filename*=UTF-8''${encodeRfc5987(filename)}`;
}

function downloadHeaders(filename: string, contentType: string): HeadersInit {
  return {
    "Content-Type": contentType,
    "Content-Disposition": contentDisposition(filename),
    "Cache-Control": "private, no-store",
    "X-Content-Type-Options": "nosniff",
  };
}

/** Uint8Array / Buffer を Response に渡せる ArrayBuffer へ複製する（型・共有バッファの都合） */
export function toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  const out = new ArrayBuffer(bytes.byteLength);
  new Uint8Array(out).set(bytes);
  return out;
}

/** CSV（UTF-8）のダウンロード応答 */
export function csvResponse(filename: string, csv: string): Response {
  return new Response(csv, { status: 200, headers: downloadHeaders(filename, "text/csv; charset=utf-8") });
}

/** バイナリ（Shift_JIS CSV・PDF など）のダウンロード応答 */
export function binaryResponse(filename: string, body: Uint8Array, contentType: string): Response {
  return new Response(toArrayBuffer(body), { status: 200, headers: downloadHeaders(filename, contentType) });
}

/** PDF のダウンロード応答 */
export function pdfResponse(filename: string, body: Uint8Array): Response {
  return binaryResponse(filename, body, "application/pdf");
}

/** JSON ファイル（整形済み）のダウンロード応答 */
export function jsonFileResponse(filename: string, data: unknown): Response {
  return new Response(JSON.stringify(data, null, 2), { status: 200, headers: downloadHeaders(filename, "application/json; charset=utf-8") });
}

/** エラー応答（日本語メッセージをそのまま表示できるよう text/plain） */
export function errorResponse(status: number, message: string): Response {
  return new Response(message, {
    status,
    headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "private, no-store" },
  });
}

/** ファイル名に使えない文字を置き換える（OS 予約文字と制御文字） */
export function safeFilePart(s: string): string {
  return s.replace(/[\\/:*?"<>|\x00-\x1f]/g, "_").trim() || "_";
}

/** 日本時間のタイムスタンプ "YYYYMMDD_HHMM"（バックアップのファイル名用） */
export function timestampJST(now: Date = new Date()): string {
  const jst = new Date(now.getTime() + 9 * 60 * 60 * 1000);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${jst.getUTCFullYear()}${p(jst.getUTCMonth() + 1)}${p(jst.getUTCDate())}_${p(jst.getUTCHours())}${p(jst.getUTCMinutes())}`;
}

/** Excel（.xlsx）のダウンロード応答 */
export function xlsxResponse(filename: string, body: Uint8Array): Response {
  return binaryResponse(filename, body, "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
}
