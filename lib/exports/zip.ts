/**
 * 無圧縮（store）ZIP の生成（依存なし・純関数）。複数 PDF の一括ダウンロード用
 * - ローカルファイルヘッダ／セントラルディレクトリ／終端レコードのみ（ZIP64 非対応：合計 4GB・65535 件未満）
 * - ファイル名は UTF-8（general purpose flag のビット 11 を立てる）
 * - 更新日時は DOS 形式（日本時間）
 */

export interface ZipEntry {
  /** ZIP 内のパス（区切りは "/"） */
  name: string;
  data: Uint8Array;
  /** 更新日時（省略時は buildZip 呼び出し時刻） */
  mtime?: Date;
}

export const ZIP_SIG_LOCAL = 0x04034b50;
export const ZIP_SIG_CENTRAL = 0x02014b50;
export const ZIP_SIG_EOCD = 0x06054b50;
export const ZIP_FLAG_UTF8 = 0x0800; // bit 11：ファイル名が UTF-8

const VERSION = 20; // 2.0（store）
const METHOD_STORE = 0;
const LOCAL_HEADER_SIZE = 30;
const CENTRAL_HEADER_SIZE = 46;
const EOCD_SIZE = 22;
const MAX_U16 = 0xffff;
const MAX_U32 = 0xffffffff;

// CRC-32（多項式 0xEDB88320）のテーブル
const CRC_TABLE = new Uint32Array(256);
for (let n = 0; n < 256; n++) {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  CRC_TABLE[n] = c >>> 0;
}

/** CRC-32（ZIP・PNG と同じ）。符号なし 32 ビット整数を返す */
export function crc32(data: Uint8Array): number {
  let c = 0xffffffff;
  for (let i = 0; i < data.length; i++) c = CRC_TABLE[(c ^ data[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

/** DOS 形式の日時（日本時間）。1980 年より前・不正な日時は 1980-01-01 00:00 にする */
export function dosDateTime(d: Date): { time: number; date: number } {
  const ms = d.getTime();
  if (!Number.isFinite(ms)) return { time: 0, date: (1 << 5) | 1 };
  const jst = new Date(ms + 9 * 60 * 60 * 1000);
  const year = jst.getUTCFullYear();
  if (year < 1980) return { time: 0, date: (1 << 5) | 1 };
  const y = Math.min(year - 1980, 127);
  const date = (y << 9) | ((jst.getUTCMonth() + 1) << 5) | jst.getUTCDate();
  const time = (jst.getUTCHours() << 11) | (jst.getUTCMinutes() << 5) | (jst.getUTCSeconds() >> 1);
  return { time, date };
}

/** 既に使った名前と重ならないよう "_2", "_3" … を拡張子の前に付ける（大文字小文字は区別しない） */
export function uniqueZipName(name: string, used: Set<string>): string {
  const dot = name.lastIndexOf(".");
  let candidate = name;
  for (let n = 2; used.has(candidate.toLowerCase()); n++) {
    candidate = dot > 0 ? `${name.slice(0, dot)}_${n}${name.slice(dot)}` : `${name}_${n}`;
  }
  used.add(candidate.toLowerCase());
  return candidate;
}

/** エントリ一覧 → 無圧縮 ZIP のバイト列 */
export function buildZip(entries: ZipEntry[], opts: { now?: Date } = {}): Uint8Array {
  if (entries.length > MAX_U16) throw new Error(`ZIP に入れられるファイルは ${MAX_U16} 件までです。`);
  const now = opts.now ?? new Date();
  const encoder = new TextEncoder();
  const parts: Uint8Array[] = [];
  const centrals: Uint8Array[] = [];
  let offset = 0;

  for (const e of entries) {
    const name = encoder.encode(e.name);
    if (name.length === 0 || name.length > MAX_U16) throw new Error(`ZIP のファイル名が不正です: ${e.name}`);
    const data = e.data;
    if (data.length > MAX_U32) throw new Error(`ZIP に入れるファイルが大きすぎます: ${e.name}`);
    const crc = crc32(data);
    const { time, date } = dosDateTime(e.mtime ?? now);

    const local = new Uint8Array(LOCAL_HEADER_SIZE + name.length);
    const lv = new DataView(local.buffer);
    lv.setUint32(0, ZIP_SIG_LOCAL, true);
    lv.setUint16(4, VERSION, true); // version needed to extract
    lv.setUint16(6, ZIP_FLAG_UTF8, true); // general purpose bit flag
    lv.setUint16(8, METHOD_STORE, true); // compression method
    lv.setUint16(10, time, true);
    lv.setUint16(12, date, true);
    lv.setUint32(14, crc, true);
    lv.setUint32(18, data.length, true); // compressed size
    lv.setUint32(22, data.length, true); // uncompressed size
    lv.setUint16(26, name.length, true);
    lv.setUint16(28, 0, true); // extra field length
    local.set(name, LOCAL_HEADER_SIZE);

    const central = new Uint8Array(CENTRAL_HEADER_SIZE + name.length);
    const cv = new DataView(central.buffer);
    cv.setUint32(0, ZIP_SIG_CENTRAL, true);
    cv.setUint16(4, VERSION, true); // version made by
    cv.setUint16(6, VERSION, true); // version needed to extract
    cv.setUint16(8, ZIP_FLAG_UTF8, true);
    cv.setUint16(10, METHOD_STORE, true);
    cv.setUint16(12, time, true);
    cv.setUint16(14, date, true);
    cv.setUint32(16, crc, true);
    cv.setUint32(20, data.length, true);
    cv.setUint32(24, data.length, true);
    cv.setUint16(28, name.length, true);
    cv.setUint16(30, 0, true); // extra field length
    cv.setUint16(32, 0, true); // file comment length
    cv.setUint16(34, 0, true); // disk number start
    cv.setUint16(36, 0, true); // internal file attributes
    cv.setUint32(38, 0, true); // external file attributes
    cv.setUint32(42, offset, true); // relative offset of local header
    central.set(name, CENTRAL_HEADER_SIZE);

    parts.push(local, data);
    centrals.push(central);
    offset += local.length + data.length;
    if (offset > MAX_U32) throw new Error("ZIP の合計サイズが 4GB を超えています。");
  }

  const cdOffset = offset;
  const cdSize = centrals.reduce((n, c) => n + c.length, 0);
  const eocd = new Uint8Array(EOCD_SIZE);
  const ev = new DataView(eocd.buffer);
  ev.setUint32(0, ZIP_SIG_EOCD, true);
  ev.setUint16(4, 0, true); // number of this disk
  ev.setUint16(6, 0, true); // disk where central directory starts
  ev.setUint16(8, entries.length, true); // entries on this disk
  ev.setUint16(10, entries.length, true); // total entries
  ev.setUint32(12, cdSize, true);
  ev.setUint32(16, cdOffset, true);
  ev.setUint16(20, 0, true); // comment length

  const total = cdOffset + cdSize + EOCD_SIZE;
  if (total > MAX_U32) throw new Error("ZIP の合計サイズが 4GB を超えています。");
  const out = new Uint8Array(total);
  let pos = 0;
  for (const p of [...parts, ...centrals, eocd]) {
    out.set(p, pos);
    pos += p.length;
  }
  return out;
}
