import { inflateSync } from "node:zlib";

/**
 * E2E 用：製品の PDF（@react-pdf → pdfkit。日本語フォントは Type0・Identity-H・ToUnicode 付き）から文字を取り出す。
 * 画面と PDF の数字がそろっているかを確かめるためだけの小さな読み取り（ほかの PDF の読み取りには使わない）。
 * ページの文字の塊（BT … ET）ごとに 1 行にして返す
 */
type Obj = { dict: string; stream: Buffer | null };

function parseObjects(pdf: Buffer): Map<number, Obj> {
  const text = pdf.toString("latin1");
  const objs = new Map<number, Obj>();
  const re = /(\d+) 0 obj\b/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    const start = m.index + m[0].length;
    const streamAt = text.indexOf("stream", start);
    const endAt = text.indexOf("endobj", start);
    if (endAt < 0) break;
    if (streamAt >= 0 && streamAt < endAt) {
      const dict = text.slice(start, streamAt);
      const len = Number(/\/Length (\d+)/.exec(dict)?.[1] ?? NaN);
      let dataStart = streamAt + "stream".length;
      if (text[dataStart] === "\r") dataStart++;
      if (text[dataStart] === "\n") dataStart++;
      let raw = Number.isFinite(len) ? pdf.subarray(dataStart, dataStart + len) : pdf.subarray(dataStart, text.indexOf("endstream", dataStart));
      if (/\/FlateDecode/.test(dict)) raw = inflateSync(raw);
      objs.set(Number(m[1]), { dict, stream: raw });
      const after = text.indexOf("endobj", dataStart + (Number.isFinite(len) ? len : 0));
      re.lastIndex = after > 0 ? after : endAt;
    } else {
      objs.set(Number(m[1]), { dict: text.slice(start, endAt), stream: null });
      re.lastIndex = endAt;
    }
  }
  return objs;
}

/** 16 進の文字列を数の並びに。PDF の 16 進の文字列は途中に空白を挟んでよい（例：合字 ff の ToUnicode は <0066 0066>） */
const hexToCodes = (raw: string, width: number) => {
  const hex = raw.replace(/\s+/g, "");
  const out: number[] = [];
  for (let i = 0; i + width <= hex.length; i += width) out.push(parseInt(hex.slice(i, i + width), 16));
  return out;
};
const hexToString = (hex: string) => String.fromCodePoint(...hexToCodes(hex, 4));

/**
 * ToUnicode の CMap（bfchar・bfrange）を「字形の番号 → 文字」の表に。
 * 行き先の 16 進は空白を含むことがある（合字は 2 文字ぶん <0066 0066>）。読み飛ばすと、そのあとの字形が 1 つずつずれる
 */
function parseCMap(cmap: string): Map<number, string> {
  const map = new Map<number, string>();
  const hexCode = (h: string) => parseInt(h.replace(/\s+/g, ""), 16);
  for (const block of cmap.matchAll(/beginbfchar([\s\S]*?)endbfchar/g)) {
    for (const [, src, dst] of block[1].matchAll(/<([0-9a-fA-F\s]+)>\s*<([0-9a-fA-F\s]+)>/g)) map.set(hexCode(src), hexToString(dst));
  }
  for (const block of cmap.matchAll(/beginbfrange([\s\S]*?)endbfrange/g)) {
    for (const [, lo, hi, rest] of block[1].matchAll(/<([0-9a-fA-F\s]+)>\s*<([0-9a-fA-F\s]+)>\s*(\[[^\]]*\]|<[0-9a-fA-F\s]+>)/g)) {
      const a = hexCode(lo);
      const b = hexCode(hi);
      if (rest.startsWith("[")) {
        const items = [...rest.matchAll(/<([0-9a-fA-F\s]*)>/g)].map((x) => hexToString(x[1]));
        for (let c = a; c <= b; c++) map.set(c, items[c - a] ?? "");
      } else {
        const base = hexToCodes(rest.slice(1, -1), 4);
        for (let c = a; c <= b; c++) {
          const cps = [...base];
          cps[cps.length - 1] += c - a;
          map.set(c, String.fromCodePoint(...cps));
        }
      }
    }
  }
  return map;
}

const ref = (dict: string, key: string) => {
  const m = new RegExp(`/${key}\\s+(\\d+) 0 R`).exec(dict);
  return m ? Number(m[1]) : null;
};

export function pdfText(pdf: Buffer): string {
  if (pdf.subarray(0, 5).toString("latin1") !== "%PDF-") throw new Error("PDF ではありません");
  const objs = parseObjects(pdf);
  const fontMaps = new Map<number, Map<number, string>>();
  const fontMap = (id: number) => {
    if (!fontMaps.has(id)) {
      const tu = ref(objs.get(id)?.dict ?? "", "ToUnicode");
      const stream = tu !== null ? objs.get(tu)?.stream : null;
      fontMaps.set(id, stream ? parseCMap(stream.toString("latin1")) : new Map());
    }
    return fontMaps.get(id)!;
  };
  const lines: string[] = [];
  for (const [, obj] of objs) {
    if (!/\/Type\s*\/Page\b/.test(obj.dict)) continue;
    // ページの文字の表（/F2 → フォントの番号）
    const resId = ref(obj.dict, "Resources");
    const resDict = resId !== null ? (objs.get(resId)?.dict ?? "") : obj.dict;
    const fontsDict = /\/Font\s*<<([\s\S]*?)>>/.exec(resDict)?.[1] ?? "";
    const fonts = new Map<string, number>();
    for (const [, name, id] of fontsDict.matchAll(/\/([A-Za-z0-9_.-]+)\s+(\d+) 0 R/g)) fonts.set(name, Number(id));
    const contentIds = (/\/Contents\s*\[([^\]]*)\]/.exec(obj.dict)?.[1] ?? /\/Contents\s+(\d+ 0 R)/.exec(obj.dict)?.[1] ?? "").match(/(\d+) 0 R/g) ?? [];
    for (const c of contentIds) {
      const content = objs.get(Number(c.split(" ")[0]))?.stream?.toString("latin1") ?? "";
      let current = new Map<number, string>();
      let line = "";
      const tokens = content.matchAll(/\/([A-Za-z0-9_.-]+)\s+[\d.]+\s+Tf|\[((?:[^\]\\]|\\.)*)\]\s*TJ|<([0-9a-fA-F\s]*)>\s*Tj|\bET\b/g);
      for (const t of tokens) {
        if (t[1]) {
          current = fontMap(fonts.get(t[1]) ?? -1);
        } else if (t[2] !== undefined || t[3] !== undefined) {
          const hexes = t[2] !== undefined ? [...t[2].matchAll(/<([0-9a-fA-F\s]*)>/g)].map((x) => x[1]) : [t[3]!];
          for (const h of hexes) for (const code of hexToCodes(h, 4)) line += current.get(code) ?? "";
        } else {
          if (line) lines.push(line);
          line = "";
        }
      }
      if (line) lines.push(line);
    }
  }
  return lines.join("\n");
}
