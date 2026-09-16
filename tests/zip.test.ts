import { describe, expect, it } from "vitest";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { ZIP_FLAG_UTF8, ZIP_SIG_CENTRAL, ZIP_SIG_EOCD, ZIP_SIG_LOCAL, buildZip, crc32, dosDateTime, uniqueZipName, type ZipEntry } from "@/lib/exports/zip";

const enc = new TextEncoder();
const dec = new TextDecoder();

interface ParsedEntry {
  name: string;
  localName: string;
  flags: number;
  method: number;
  crc: number;
  localCrc: number;
  compressedSize: number;
  uncompressedSize: number;
  time: number;
  date: number;
  data: Uint8Array;
}

/** テスト用の最小 ZIP パーサー（終端レコード → セントラルディレクトリ → ローカルヘッダの順にたどる） */
function parseZip(bytes: Uint8Array): ParsedEntry[] {
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const eocd = bytes.length - 22;
  expect(dv.getUint32(eocd, true)).toBe(ZIP_SIG_EOCD);
  expect(dv.getUint16(eocd + 4, true)).toBe(0);
  expect(dv.getUint16(eocd + 6, true)).toBe(0);
  const count = dv.getUint16(eocd + 10, true);
  expect(dv.getUint16(eocd + 8, true)).toBe(count);
  const cdSize = dv.getUint32(eocd + 12, true);
  const cdOffset = dv.getUint32(eocd + 16, true);
  expect(dv.getUint16(eocd + 20, true)).toBe(0);
  expect(cdOffset + cdSize).toBe(eocd);

  const out: ParsedEntry[] = [];
  let p = cdOffset;
  for (let i = 0; i < count; i++) {
    expect(dv.getUint32(p, true)).toBe(ZIP_SIG_CENTRAL);
    expect(dv.getUint16(p + 6, true)).toBe(20);
    const flags = dv.getUint16(p + 8, true);
    const method = dv.getUint16(p + 10, true);
    const time = dv.getUint16(p + 12, true);
    const date = dv.getUint16(p + 14, true);
    const crc = dv.getUint32(p + 16, true);
    const compressedSize = dv.getUint32(p + 20, true);
    const uncompressedSize = dv.getUint32(p + 24, true);
    const nameLen = dv.getUint16(p + 28, true);
    const extraLen = dv.getUint16(p + 30, true);
    const commentLen = dv.getUint16(p + 32, true);
    const localOffset = dv.getUint32(p + 42, true);
    const name = dec.decode(bytes.subarray(p + 46, p + 46 + nameLen));

    expect(dv.getUint32(localOffset, true)).toBe(ZIP_SIG_LOCAL);
    expect(dv.getUint16(localOffset + 4, true)).toBe(20);
    expect(dv.getUint16(localOffset + 6, true)).toBe(flags);
    expect(dv.getUint16(localOffset + 8, true)).toBe(method);
    expect(dv.getUint16(localOffset + 10, true)).toBe(time);
    expect(dv.getUint16(localOffset + 12, true)).toBe(date);
    const localCrc = dv.getUint32(localOffset + 14, true);
    expect(dv.getUint32(localOffset + 18, true)).toBe(compressedSize);
    expect(dv.getUint32(localOffset + 22, true)).toBe(uncompressedSize);
    const localNameLen = dv.getUint16(localOffset + 26, true);
    const localExtraLen = dv.getUint16(localOffset + 28, true);
    const localName = dec.decode(bytes.subarray(localOffset + 30, localOffset + 30 + localNameLen));
    const dataStart = localOffset + 30 + localNameLen + localExtraLen;
    const data = bytes.subarray(dataStart, dataStart + compressedSize);

    out.push({ name, localName, flags, method, crc, localCrc, compressedSize, uncompressedSize, time, date, data });
    p += 46 + nameLen + extraLen + commentLen;
  }
  expect(p).toBe(cdOffset + cdSize);
  return out;
}

const pdfLike = new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x37, 0x0a, 0x00, 0xff, 0xfe, 0x80, 0x7f]);
const sample: ZipEntry[] = [
  { name: "支払明細_2026-09_相曽慧.pdf", data: pdfLike },
  { name: "支払明細_2026-09_吉田雅一.pdf", data: enc.encode("こんにちは, ZIP") },
  { name: "empty.txt", data: new Uint8Array(0) },
];
const mtime = new Date("2026-09-16T15:04:30Z"); // 日本時間 2026-09-17 00:04:30

describe("crc32", () => {
  it("既知の値と一致する", () => {
    expect(crc32(new Uint8Array(0))).toBe(0);
    expect(crc32(enc.encode("123456789"))).toBe(0xcbf43926);
    expect(crc32(enc.encode("The quick brown fox jumps over the lazy dog"))).toBe(0x414fa339);
    expect(crc32(new Uint8Array([0xff]))).toBe(0xff000000);
  });

  it("符号なし 32 ビット整数を返す", () => {
    const v = crc32(enc.encode("a"));
    expect(v).toBe(0xe8b7be43);
    expect(v).toBeGreaterThanOrEqual(0);
    expect(Number.isInteger(v)).toBe(true);
  });
});

describe("buildZip", () => {
  it("自前のパーサーで読める：シグネチャ・件数・ファイル名（UTF-8）・データ・CRC が一致する", () => {
    const bytes = buildZip(sample, { now: mtime });
    const entries = parseZip(bytes);
    expect(entries).toHaveLength(3);
    entries.forEach((e, i) => {
      expect(e.name).toBe(sample[i].name);
      expect(e.localName).toBe(sample[i].name);
      expect(e.flags & ZIP_FLAG_UTF8).toBe(ZIP_FLAG_UTF8);
      expect(e.method).toBe(0);
      expect(e.compressedSize).toBe(sample[i].data.length);
      expect(e.uncompressedSize).toBe(sample[i].data.length);
      expect(Array.from(e.data)).toEqual(Array.from(sample[i].data));
      expect(e.crc).toBe(crc32(sample[i].data));
      expect(e.localCrc).toBe(e.crc);
    });
    expect(dec.decode(entries[1].data)).toBe("こんにちは, ZIP");
    // 無圧縮なので全体サイズ ＝ Σ(30 + 名前) + Σデータ + Σ(46 + 名前) + 22
    const nameBytes = sample.reduce((n, e) => n + enc.encode(e.name).length, 0);
    const dataBytes = sample.reduce((n, e) => n + e.data.length, 0);
    expect(bytes.length).toBe(30 * 3 + nameBytes + dataBytes + 46 * 3 + nameBytes + 22);
  });

  it("エントリが 0 件でも有効な ZIP（終端レコードのみ）", () => {
    const bytes = buildZip([]);
    expect(bytes.length).toBe(22);
    expect(parseZip(bytes)).toEqual([]);
  });

  it("更新日時は DOS 形式（日本時間）。省略時は now を使う", () => {
    const dt = dosDateTime(mtime);
    expect(dt.date).toBe(((2026 - 1980) << 9) | (9 << 5) | 17);
    expect(dt.time).toBe((0 << 11) | (4 << 5) | (30 >> 1));
    expect(dosDateTime(new Date("1975-01-01T00:00:00Z"))).toEqual({ time: 0, date: (1 << 5) | 1 });
    expect(dosDateTime(new Date(Number.NaN))).toEqual({ time: 0, date: (1 << 5) | 1 });

    const [a, b] = parseZip(buildZip([{ name: "a.txt", data: enc.encode("a") }, { name: "b.txt", data: enc.encode("b"), mtime: new Date("2020-02-29T03:00:00Z") }], { now: mtime }));
    expect({ time: a.time, date: a.date }).toEqual(dt);
    expect({ time: b.time, date: b.date }).toEqual({ time: 12 << 11, date: ((2020 - 1980) << 9) | (2 << 5) | 29 });
  });

  it("Buffer のデータもそのまま入れられる（共有バッファでもコピーが正しい）", () => {
    const buf = Buffer.from("buffer data");
    const [e] = parseZip(buildZip([{ name: "buf.bin", data: buf }]));
    expect(dec.decode(e.data)).toBe("buffer data");
  });

  it("空のファイル名は拒否する", () => {
    expect(() => buildZip([{ name: "", data: new Uint8Array(0) }])).toThrow(/ファイル名/);
  });
});

describe("uniqueZipName", () => {
  it("重複する名前には拡張子の前に _2, _3 … を付ける（大文字小文字は区別しない）", () => {
    const used = new Set<string>();
    expect(uniqueZipName("支払明細_2026-09_山田太郎.pdf", used)).toBe("支払明細_2026-09_山田太郎.pdf");
    expect(uniqueZipName("支払明細_2026-09_山田太郎.pdf", used)).toBe("支払明細_2026-09_山田太郎_2.pdf");
    expect(uniqueZipName("支払明細_2026-09_山田太郎.pdf", used)).toBe("支払明細_2026-09_山田太郎_3.pdf");
    expect(uniqueZipName("支払明細_2026-09_山田太郎_2.pdf", used)).toBe("支払明細_2026-09_山田太郎_2_2.pdf");
    expect(uniqueZipName("README", used)).toBe("README");
    expect(uniqueZipName("readme", used)).toBe("readme_2");
    expect(uniqueZipName(".hidden", used)).toBe(".hidden");
    expect(uniqueZipName(".hidden", used)).toBe(".hidden_2");
  });
});

// python3 があれば標準ライブラリの zipfile で検証する（無ければスキップ）
const python = spawnSync("python3", ["--version"], { encoding: "utf8" });
const hasPython = !python.error && python.status === 0;

describe.skipIf(!hasPython)("python3 zipfile による検証", () => {
  it("zipfile -t と testzip() を通り、UTF-8 のファイル名とデータが読める", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "rootive-zip-"));
    try {
      const file = path.join(dir, "test.zip");
      fs.writeFileSync(file, buildZip(sample, { now: mtime }));

      const t = spawnSync("python3", ["-m", "zipfile", "-t", file], { encoding: "utf8" });
      expect(t.status, t.stderr).toBe(0);
      expect(t.stdout).not.toMatch(/corrupt/i);

      const script = [
        "import sys, json, zipfile",
        "z = zipfile.ZipFile(sys.argv[1])",
        "infos = z.infolist()",
        "print(json.dumps({",
        "  'bad': z.testzip(),",
        "  'names': z.namelist(),",
        "  'utf8': [bool(i.flag_bits & 0x800) for i in infos],",
        "  'stored': [i.compress_type == zipfile.ZIP_STORED for i in infos],",
        "  'sizes': [i.file_size for i in infos],",
        "  'dates': [list(i.date_time) for i in infos],",
        "  'second': list(z.read(infos[1].filename)),",
        "}, ensure_ascii=False))",
      ].join("\n");
      const r = spawnSync("python3", ["-c", script, file], { encoding: "utf8" });
      expect(r.status, r.stderr).toBe(0);
      const info = JSON.parse(r.stdout) as { bad: string | null; names: string[]; utf8: boolean[]; stored: boolean[]; sizes: number[]; dates: number[][]; second: number[] };
      expect(info.bad).toBeNull();
      expect(info.names).toEqual(sample.map((e) => e.name));
      expect(info.utf8).toEqual([true, true, true]);
      expect(info.stored).toEqual([true, true, true]);
      expect(info.sizes).toEqual(sample.map((e) => e.data.length));
      expect(info.dates[0]).toEqual([2026, 9, 17, 0, 4, 30]);
      expect(dec.decode(new Uint8Array(info.second))).toBe("こんにちは, ZIP");
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});
