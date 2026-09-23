// ROOTIVE GROUP 5カ年経営計画（2026–2031）の PowerPoint を生成する。
// 実行：cd docs/management-plan && npm install && node build.mjs
// 数値は暫定経営目標（2027〜2031 の連結売上 2・5・10・18・30 億円）だけを使う。ほかの数値は作らない。
import pptxgen from "pptxgenjs";
import JSZip from "jszip";
import { writeFileSync } from "node:fs";

const OUT = "ROOTIVE_GROUP_5year_plan_2026-2031.pptx";
const TOTAL = 24;

// ---------- デザインの定数 ----------
const C = {
  DEEP: "0B1A2E", // 濃い背景
  NAVY: "14284B", // 主の色
  NAVY_MID: "22375C",
  STEEL: "4A6280",
  CARD_DK: "13243F", // 暗い背景の上のカード
  LINE_DK: "2E4468", // 暗い背景の上の細線
  CHIP_DK: "3C5378",
  BLACK: "0E1014",
  INK: "1B1F27", // 明るい背景の本文
  WHITE: "FFFFFF",
  GOLD: "C9A96E", // 線・ノード、暗い背景の上の金の文字
  GOLD_L: "B08D57", // 明るい背景の上の線・ノード
  GOLD_D: "8C6D3F", // 明るい背景の上の金の文字
  SILVER: "A7B0BE",
  SILVER_L: "D5DBE3",
  TINT: "F3F5F8",
  RULE: "E3E8EF",
  RULE_D: "C9D1DC",
  MUTED: "5B6675",
  BAR_OFF: "C5CCD6",
  RED: "C26A5E",
};
const F = { JPB: "Yu Gothic", JP: "Yu Gothic Medium", MIN: "Yu Mincho", EN: "Arial", NUM: "Cambria" };
const LATIN_FONTS = new Set([F.EN, F.NUM]);
const REV = [2, 5, 10, 18, 30]; // FY2027〜FY2031 グループ連結売上（暫定経営目標・億円）
const FY = ["FY2027", "FY2028", "FY2029", "FY2030", "FY2031"];

const X0 = 0.6;
const X1 = 12.733;
const CW = X1 - X0;

const SECTION = {
  1: "",
  2: "I 理念と長期目標",
  3: "I 理念と長期目標",
  4: "I 理念と長期目標",
  5: "I 理念と長期目標",
  6: "II 5カ年目標とロードマップ",
  7: "II 5カ年目標とロードマップ",
  8: "II 5カ年目標とロードマップ",
  9: "II 5カ年目標とロードマップ",
  10: "II 5カ年目標とロードマップ",
  11: "II 5カ年目標とロードマップ",
  12: "II 5カ年目標とロードマップ",
  13: "II 5カ年目標とロードマップ",
  14: "II 5カ年目標とロードマップ",
  15: "III グループ経営の設計",
  16: "III グループ経営の設計",
  17: "III グループ経営の設計",
  18: "III グループ経営の設計",
  19: "III グループ経営の設計",
  20: "III グループ経営の設計",
  21: "IV 経営者の役割と次のフェーズ",
  22: "IV 経営者の役割と次のフェーズ",
  23: "IV 経営者の役割と次のフェーズ",
  24: "",
};

// ---------- 点検（はみ出し・フォント・位置） ----------
const ISSUES = [];
let CUR = 0; // いま作っているページ
const VISUALS = new Set();

function emWidth(ch) {
  const code = ch.codePointAt(0);
  if (code >= 0x2e80 || (code >= 0x3000 && code <= 0x30ff) || (code >= 0xff00 && code <= 0xffef)) return 1.0;
  if (ch === " ") return 0.28;
  if ("il.,:;'!|".includes(ch)) return 0.28;
  if ("I".includes(ch)) return 0.3;
  if ("MW%".includes(ch)) return 0.9;
  if ("¥×–—→≠".includes(ch)) return ch === "→" || ch === "≠" ? 1.0 : 0.6;
  if (/[A-Z&]/.test(ch)) return 0.7;
  if (/[0-9]/.test(ch)) return 0.56;
  if (/[a-z]/.test(ch)) return 0.53;
  return 0.5;
}
function lineWidthIn(runs) {
  // runs: [{text, size, bold, cs}]
  let w = 0;
  for (const r of runs) {
    for (const ch of r.text) w += (emWidth(ch) * r.size * (r.bold ? 1.04 : 1)) / 72 + (r.cs || 0) / 72;
  }
  return w;
}
function issue(kind, msg) {
  ISSUES.push(`p${String(CUR).padStart(2, "0")} [${kind}] ${msg}`);
}

// ---------- 基本の部品（オプションは毎回新しいオブジェクトで作る） ----------
let pres;

// content: 文字列（\n で改行）または [{text, o:{...}}] の配列（o.br で改行）
function tx(slide, content, o) {
  const size = o.size ?? 14;
  const font = o.font ?? F.JP;
  const base = {
    x: o.x,
    y: o.y,
    w: o.w,
    h: o.h,
    isTextBox: true,
    margin: 0,
    fontFace: font,
    fontSize: size,
    color: o.color ?? C.INK,
    align: o.align ?? "left",
    valign: o.valign ?? "top",
    lang: LATIN_FONTS.has(font) ? "en-US" : "ja-JP",
    fit: "none",
    wrap: true,
  };
  if (o.bold) base.bold = true;
  if (o.cs) base.charSpacing = o.cs;
  if (o.paraAfter) base.paraSpaceAfter = o.paraAfter;
  if (o.fill) base.fill = { color: o.fill };
  if (o.line) base.line = { color: o.line, width: o.lineW ?? 0.75 };

  // 行に分ける（点検用）
  const lines = [[]];
  let runs;
  if (typeof content === "string") {
    const parts = content.split("\n");
    parts.forEach((p, i) => {
      if (i > 0) lines.push([]);
      lines[lines.length - 1].push({ text: p, size, bold: !!o.bold, cs: o.cs, font });
    });
    runs = content;
  } else {
    runs = content.map((r) => {
      const ro = r.o ?? {};
      const rf = ro.font ?? font;
      const opts = { fontFace: rf, lang: LATIN_FONTS.has(rf) ? "en-US" : "ja-JP" };
      if (ro.size) opts.fontSize = ro.size;
      if (ro.color) opts.color = ro.color;
      if (ro.bold) opts.bold = true;
      if (ro.cs) opts.charSpacing = ro.cs;
      if (ro.br) opts.breakLine = true;
      if (ro.paraAfter) opts.paraSpaceAfter = ro.paraAfter;
      lines[lines.length - 1].push({ text: r.text, size: ro.size ?? size, bold: ro.bold ?? !!o.bold, cs: ro.cs ?? o.cs, font: rf });
      if (ro.br) lines.push([]);
      return { text: r.text, options: opts };
    });
  }
  const multi = lines.length > 1;
  if (o.ls) base.lineSpacing = o.ls;
  else if (multi) base.lineSpacing = Math.round(size * 1.5);

  // 点検：英字フォントに日本語を入れない
  for (const ln of lines) {
    for (const r of ln) {
      if (LATIN_FONTS.has(r.font) && /[^\x20-\x7E–¥×]/.test(r.text)) issue("font", `英字フォントに日本語・全角: "${r.text}"`);
    }
  }
  // 点検：幅
  for (const ln of lines) {
    const w = lineWidthIn(ln);
    if (w > o.w * 0.94) issue("width", `${(w / o.w * 100).toFixed(0)}% "${ln.map((r) => r.text).join("")}" (w=${o.w})`);
  }
  // 点検：高さ
  const maxSize = Math.max(...lines.flat().map((r) => r.size));
  const pitch = (base.lineSpacing ?? maxSize * 1.3) / 72;
  const needH = multi ? pitch * lines.length + ((o.paraAfter ?? 0) * (lines.length - 1)) / 72 : (maxSize * 1.25) / 72;
  if (needH > o.h * 1.04) issue("height", `need ${needH.toFixed(2)} > h ${o.h} "${lines[0].map((r) => r.text).join("")}"`);
  // 点検：位置
  if (!o.edgeOk && (o.x < 0.5 || o.y < 0.35 || o.x + o.w > 12.84 || o.y + o.h > 7.05)) {
    issue("bounds", `(${o.x}, ${o.y}, ${o.w}, ${o.h}) "${lines[0].map((r) => r.text).join("")}"`);
  }
  // 点検：小さすぎる文字
  for (const r of lines.flat()) if (r.size < 10 && r.text.trim()) issue("size", `${r.size}pt "${r.text}"`);

  slide.addText(runs, base);
}

function rect(slide, o) {
  const opts = { x: o.x, y: o.y, w: o.w, h: o.h };
  if (o.fill) opts.fill = { color: o.fill };
  if (o.line) {
    opts.line = { color: o.line, width: o.lineW ?? 0.75 };
    if (o.dash) opts.line.dashType = o.dash;
  }
  if (o.round) {
    slide.addShape(pres.ShapeType.roundRect, { ...opts, rectRadius: o.round });
  } else {
    slide.addShape(o.shape ?? pres.ShapeType.rect, opts);
  }
  if (!o.edgeOk && (o.x < 0.5 || o.y < 0.35 || o.x + o.w > 12.84 || o.y + o.h > 7.05)) {
    issue("bounds", `shape (${o.x}, ${o.y}, ${o.w}, ${o.h})`);
  }
}

// 2 点を結ぶ線（向きに応じて反転する）
function line(slide, x1, y1, x2, y2, o = {}) {
  const opts = {
    x: Math.min(x1, x2),
    y: Math.min(y1, y2),
    w: Math.abs(x2 - x1),
    h: Math.abs(y2 - y1),
    line: { color: o.color ?? C.NAVY, width: o.width ?? 1 },
  };
  if (o.dash) opts.line.dashType = o.dash;
  // 始点側・終点側の矢印（反転を考えて付け替える）
  const flipH = x2 < x1;
  const flipV = y2 < y1;
  if (flipH) opts.flipH = true;
  if (flipV) opts.flipV = true;
  if (o.arrowEnd) opts.line.endArrowType = "triangle";
  if (o.arrowStart) opts.line.beginArrowType = "triangle";
  slide.addShape(pres.ShapeType.line, opts);
}

function node(slide, cx, cy, d, o = {}) {
  const opts = { x: cx - d / 2, y: cy - d / 2, w: d, h: d };
  if (o.ring) {
    opts.fill = { color: o.bg ?? C.WHITE };
    opts.line = { color: o.color ?? C.GOLD, width: o.lineW ?? 1.5 };
  } else {
    opts.fill = { color: o.color ?? C.GOLD };
  }
  slide.addShape(o.diamond ? pres.ShapeType.diamond : pres.ShapeType.ellipse, opts);
  if (o.dot) {
    const dd = o.dot;
    slide.addShape(pres.ShapeType.ellipse, { x: cx - dd / 2, y: cy - dd / 2, w: dd, h: dd, fill: { color: o.color ?? C.GOLD } });
  }
}

// 点つきの箇条（単行は上下中央、複数行は上揃え）
function items(slide, list, o) {
  const size = o.size ?? 14;
  const pitchLine = (o.ls ?? Math.round(size * 1.5)) / 72;
  let y = o.y;
  for (const it of list) {
    const text = typeof it === "string" ? it : it.t;
    const n = text.split("\n").length;
    const h = n > 1 ? pitchLine * n : Math.max(pitchLine, (size * 1.35) / 72);
    const d = o.dot ?? 0.07;
    slide.addShape(pres.ShapeType.ellipse, {
      x: o.x,
      y: y + (n > 1 ? pitchLine / 2 : h / 2) - d / 2,
      w: d,
      h: d,
      fill: { color: o.dotColor ?? C.GOLD_L },
    });
    tx(slide, text, {
      x: o.x + (o.indent ?? 0.2),
      y,
      w: o.w - (o.indent ?? 0.2),
      h,
      size,
      font: (typeof it === "object" && it.font) || o.font || F.JP,
      color: (typeof it === "object" && it.color) || o.color || C.INK,
      bold: (typeof it === "object" && it.bold) || o.bold,
      valign: n > 1 ? "top" : "middle",
      ls: n > 1 ? Math.round(pitchLine * 72) : undefined,
    });
    y += h + (o.gap ?? 0.12);
  }
  return y;
}

// ---------- 枠（キッカー・見出し・フッター・現在地の目印） ----------
const STOPS = ["NOW", "2028", "2031", "IPO"];
function pathMarker(slide, dark, range) {
  // range: {from, to} ノードの番号 or {seg:[a,b]} 区間だけ
  const xs = [9.0, 10.1, 11.2, 12.2];
  const y = 0.64;
  const on = (i) => range.from !== undefined && i >= range.from && i <= range.to;
  const segOn = (i) => (range.seg ? range.seg[0] === i : on(i) && on(i + 1));
  const offLine = dark ? C.LINE_DK : C.RULE_D;
  const goldLine = dark ? C.GOLD : C.GOLD_L;
  for (let i = 0; i < 3; i++) {
    const x1 = xs[i] + 0.1 + lineWidthIn([{ text: STOPS[i], size: 10, bold: true }]) + 0.1;
    const x2 = xs[i + 1] - 0.08;
    line(slide, x1, y, x2, y, { color: segOn(i) ? goldLine : offLine, width: segOn(i) ? 1.5 : 1, dash: i === 2 ? "sysDash" : undefined });
  }
  STOPS.forEach((s, i) => {
    const active = on(i);
    node(slide, xs[i], y, 0.1, { color: active ? goldLine : dark ? C.CHIP_DK : C.BAR_OFF });
    tx(slide, s, {
      x: xs[i] + 0.1,
      y: y - 0.13,
      w: 0.48,
      h: 0.26,
      font: F.EN,
      size: 10,
      bold: true,
      color: active ? (dark ? C.WHITE : C.NAVY) : dark ? C.STEEL : C.SILVER,
      valign: "middle",
    });
  });
}

function frame(slide, o) {
  const theme = o.theme ?? "light";
  const dark = theme !== "light";
  slide.background = { color: theme === "black" ? C.BLACK : dark ? C.DEEP : C.WHITE };
  const n = String(o.n).padStart(2, "0");
  if (o.kicker) {
    const quiet = theme === "black";
    tx(
      slide,
      [
        { text: n, o: { color: quiet ? C.SILVER : dark ? C.GOLD : C.GOLD_D } },
        { text: "   |   ", o: { color: dark ? C.STEEL : C.RULE_D } },
        { text: o.kicker, o: { color: dark ? C.SILVER : C.MUTED } },
      ],
      { x: X0, y: 0.5, w: 8.2, h: 0.28, font: F.EN, size: 11, bold: true, cs: 2, valign: "middle" },
    );
  }
  if (o.title) {
    tx(slide, o.title, {
      x: X0,
      y: 0.82,
      w: CW,
      h: 0.62,
      font: o.titleFont ?? F.JPB,
      bold: o.titleFont ? false : true,
      size: o.titleSize ?? 26,
      color: dark ? C.WHITE : C.NAVY,
      valign: "middle",
    });
  }
  if (o.lead) {
    tx(slide, o.lead, { x: X0, y: 1.45, w: CW, h: 0.36, size: 14, color: dark ? C.SILVER_L : C.MUTED, valign: "middle" });
  }
  if (o.marker) pathMarker(slide, dark, o.marker);
  if (o.footer !== false) {
    if (SECTION[o.n]) {
      tx(slide, `ROOTIVE GROUP 5カ年経営計画 2026–2031  ｜  ${SECTION[o.n]}`, {
        x: X0,
        y: 6.8,
        w: 8,
        h: 0.22,
        size: 10,
        color: dark ? C.STEEL : C.MUTED,
        valign: "middle",
      });
    }
    tx(slide, n, { x: 11.93, y: 6.8, w: 0.8, h: 0.22, font: F.EN, size: 10, color: dark ? C.STEEL : C.MUTED, align: "right", valign: "middle" });
  }
  if (o.notes) slide.addNotes(o.notes);
}

function newSlide(n) {
  CUR = n;
  return pres.addSlide();
}

// ---------- 各ページ ----------

function s01() {
  const s = newSlide(1);
  s.background = { color: C.DEEP };
  tx(s, "MEDIUM-TERM MANAGEMENT PLAN", { x: 0.8, y: 0.75, w: 6, h: 0.3, font: F.EN, size: 11, bold: true, cs: 4, color: C.GOLD, valign: "middle" });
  tx(s, "CONFIDENTIAL", { x: 9.73, y: 0.75, w: 3.0, h: 0.3, font: F.EN, size: 10, cs: 3, color: C.SILVER, align: "right", valign: "middle" });
  tx(s, "ROOTIVE GROUP", { x: 0.8, y: 1.45, w: 9, h: 0.62, font: F.NUM, size: 32, bold: true, cs: 4, color: C.WHITE, valign: "middle" });
  tx(s, "5カ年経営計画", { x: 0.8, y: 2.12, w: 10, h: 1.05, font: F.MIN, size: 54, color: C.WHITE, valign: "middle" });
  tx(s, "2026–2031｜第一期中期経営計画", { x: 0.8, y: 3.22, w: 10, h: 0.5, size: 22, color: C.SILVER_L, valign: "middle" });
  tx(s, "物流会社から、複数の事業を所有し育てる企業グループへ。", { x: 0.8, y: 3.98, w: 11.5, h: 0.55, font: F.MIN, size: 24, color: C.GOLD, valign: "middle" });

  // THE LINE（NOW → 2028 → 2031 → IPO）
  const y = 5.45;
  const xs = [1.4, 5.0, 8.6, 11.9];
  line(s, xs[0], y, xs[2], y, { color: C.GOLD, width: 1.5 });
  line(s, xs[2], y, xs[3], y, { color: C.SILVER, width: 1.25, dash: "sysDash" });
  node(s, xs[0], y, 0.2, { color: C.GOLD });
  node(s, xs[1], y, 0.2, { color: C.GOLD });
  node(s, xs[2], y, 0.28, { color: C.GOLD });
  node(s, xs[3], y, 0.32, { ring: true, bg: C.DEEP, color: C.GOLD, dot: 0.12 });
  const labels = ["NOW", "2028", "2031", "IPO"];
  const subs = ["経営基盤構築", "親会社設立", "グループ連結売上30億円", "上場"];
  xs.forEach((x, i) => {
    tx(s, labels[i], { x: x - 0.8, y: 5.66, w: 1.6, h: 0.28, font: F.EN, size: 12, bold: true, cs: 2, color: C.GOLD, align: "center", valign: "middle" });
    const w = i === 2 ? 2.4 : 1.6;
    tx(s, subs[i], { x: x - w / 2, y: 5.96, w, h: 0.28, size: 11, color: C.SILVER, align: "center", valign: "middle" });
  });
  tx(s, "2026年9月", { x: 0.8, y: 6.55, w: 3, h: 0.3, size: 12, color: C.SILVER, valign: "middle" });
  s.addNotes(
    "本資料はROOTIVE GROUPの「経営の憲法」である。事業・M&A・人が増え、判断が複雑になっても、向かう先を見失わないために作った。対象は2026–2031年の第一期中期経営計画。下の線は、今（NOW）から2028年の親会社設立、2031年のグループ連結売上30億円、その先の上場までを一本で示している。",
  );
}

function s02() {
  const s = newSlide(2);
  frame(s, {
    n: 2,
    theme: "dark",
    kicker: "OUR PURPOSE",
    notes:
      "理念は「挑戦するすべての人のインフラを創る」。物流は目的ではなく、最初に挑戦する事業である。物流の現場で営業力・採用力・組織構築力・現場運営力・DX力・財務力・資金調達力・経営力・ブランド・信用を蓄積し、その経営能力を次の事業・次の会社・次の経営者へつなげる。",
  });
  tx(s, "挑戦するすべての人の\nインフラを創る。", { x: X0, y: 1.02, w: CW, h: 2.2, font: F.MIN, size: 48, ls: 72, color: C.WHITE });
  tx(
    s,
    [
      { text: "物流は目的ではない。", o: { color: C.GOLD } },
      { text: "ROOTIVE GROUPが最初に挑戦する事業である。", o: { br: true } },
      { text: "物流で蓄積した経営能力を、次の事業、次の会社、次の経営者へつなげていく。" },
    ],
    { x: X0, y: 3.28, w: CW, h: 0.95, font: F.MIN, size: 19, ls: 32, color: C.WHITE },
  );

  // 物流 → 蓄積する経営能力 → 次へ
  rect(s, { x: 0.6, y: 4.75, w: 1.95, h: 1.45, line: C.SILVER, lineW: 0.75 });
  tx(s, "FIRST BUSINESS", { x: 0.78, y: 4.9, w: 1.7, h: 0.25, font: F.EN, size: 10, bold: true, cs: 1, color: C.GOLD, valign: "middle" });
  tx(s, "物流", { x: 0.78, y: 5.2, w: 1.6, h: 0.5, font: F.JPB, bold: true, size: 22, color: C.WHITE, valign: "middle" });
  tx(s, "最初に挑戦する事業", { x: 0.78, y: 5.76, w: 1.72, h: 0.3, size: 11, color: C.SILVER, valign: "middle" });
  line(s, 2.65, 5.47, 3.0, 5.47, { color: C.GOLD, width: 1.5, arrowEnd: true });

  rect(s, { x: 3.1, y: 4.5, w: 6.05, h: 1.95, fill: C.CARD_DK, line: C.GOLD, lineW: 0.75 });
  tx(s, "物流で蓄積する経営能力", { x: 3.35, y: 4.62, w: 5.5, h: 0.32, font: F.JPB, bold: true, size: 13, color: C.GOLD, valign: "middle" });
  const caps = ["営業力", "採用力", "組織構築力", "現場運営力", "DX力", "財務力", "資金調達力", "経営力", "ブランド", "信用"];
  caps.forEach((c, i) => {
    const col = i % 5;
    const row = Math.floor(i / 5);
    tx(s, c, {
      x: 3.35 + col * 1.13,
      y: 5.05 + row * 0.56,
      w: 1.05,
      h: 0.42,
      size: 13,
      color: C.WHITE,
      align: "center",
      valign: "middle",
      line: C.CHIP_DK,
      lineW: 0.75,
    });
  });
  line(s, 9.25, 5.47, 9.6, 5.47, { color: C.GOLD, width: 1.5, arrowEnd: true });
  const nexts = [
    ["次の事業", "NEW BUSINESS"],
    ["次の会社", "M&A"],
    ["次の経営者", "LEADERS"],
  ];
  nexts.forEach(([jp, en], i) => {
    const y = 4.55 + i * 0.65;
    rect(s, { x: 9.7, y, w: 3.03, h: 0.52, fill: C.CARD_DK });
    tx(s, jp, { x: 9.9, y, w: 1.6, h: 0.52, font: F.JPB, bold: true, size: 15, color: C.WHITE, valign: "middle" });
    tx(s, en, { x: 11.25, y, w: 1.3, h: 0.52, font: F.EN, size: 10, bold: true, color: C.GOLD, align: "right", valign: "middle" });
  });
}

function s03() {
  const s = newSlide(3);
  frame(s, {
    n: 3,
    theme: "dark",
    kicker: "LONG TERM NORTH STAR",
    notes:
      "長期目標はROOTIVE GROUPの上場。ただし上場そのものを目的にはしない。特定の個人に依存せず、複数事業で継続的に利益を生み、強い経営陣と内部統制を持つ企業グループを作った結果として、最適なタイミングで上場する。上場の時期は現段階では固定しない。2031年の30億円は、そのための最初の通過点である。",
  });
  tx(
    s,
    [
      { text: "GROUP ", o: { color: C.WHITE } },
      { text: "IPO", o: { color: C.GOLD } },
    ],
    { x: X0, y: 0.9, w: 9, h: 1.2, font: F.NUM, size: 66, bold: true, cs: 3, valign: "middle" },
  );
  tx(s, "長期目標はROOTIVE GROUPの上場。上場は目的ではなく、強い企業グループを作った結果である。", {
    x: X0,
    y: 2.16,
    w: CW,
    h: 0.4,
    size: 16,
    color: C.SILVER_L,
    valign: "middle",
  });

  const y = 3.78;
  const xs = [1.4, 3.15, 4.9, 6.65, 8.4, 10.15, 11.9];
  // 範囲の括弧
  line(s, xs[0], 3.08, xs[2], 3.08, { color: C.GOLD, width: 0.75 });
  line(s, xs[0], 3.08, xs[0], 3.16, { color: C.GOLD, width: 0.75 });
  line(s, xs[2], 3.08, xs[2], 3.16, { color: C.GOLD, width: 0.75 });
  tx(s, "第一期中期経営計画（本計画）2026–2031", { x: 0.85, y: 2.74, w: 4.6, h: 0.3, font: F.JPB, bold: true, size: 12, color: C.GOLD, align: "center", valign: "middle" });
  line(s, xs[3], 3.08, xs[6], 3.08, { color: C.SILVER, width: 0.75, dash: "sysDash" });
  line(s, xs[3], 3.08, xs[3], 3.16, { color: C.SILVER, width: 0.75 });
  line(s, xs[6], 3.08, xs[6], 3.16, { color: C.SILVER, width: 0.75 });
  tx(s, "2031年以降 ─ 時期は現段階では固定しない", { x: 6.78, y: 2.74, w: 5.0, h: 0.3, size: 12, color: C.SILVER, align: "center", valign: "middle" });

  line(s, xs[0], y, xs[2], y, { color: C.GOLD, width: 2 });
  line(s, xs[2], y, xs[6], y, { color: C.SILVER, width: 1.25, dash: "sysDash" });
  ["2026", "2028", "2031"].forEach((yr, i) => {
    tx(s, yr, { x: xs[i] - 0.7, y: 3.22, w: 1.4, h: 0.38, font: F.NUM, size: 20, bold: true, color: i === 2 ? C.GOLD : C.WHITE, align: "center", valign: "middle" });
  });
  xs.forEach((x, i) => {
    if (i < 3) node(s, x, y, 0.24, { color: C.GOLD });
    else if (i < 6) node(s, x, y, 0.24, { ring: true, bg: C.DEEP, color: C.SILVER, lineW: 1.25 });
    else node(s, x, y, 0.42, { ring: true, bg: C.DEEP, color: C.GOLD, lineW: 2, dot: 0.16 });
  });
  const en = ["ROOTIVE", "PARENT CO.", "GROUP ¥3.0B", "¥5.0B", "¥10.0B", "IPO READY", "IPO"];
  const jp = ["経営基盤構築", "親会社設立", "グループ連結\n売上30億円", "50億円", "100億円", "上場できる\n経営体制", "グループ上場"];
  xs.forEach((x, i) => {
    const gold = i < 3 || i === 6;
    tx(s, en[i], { x: x - 0.8, y: 4.04, w: 1.6, h: 0.28, font: F.EN, size: 12, bold: true, color: gold ? C.GOLD : C.SILVER, align: "center", valign: "middle" });
    tx(s, jp[i], { x: x - 0.8, y: 4.34, w: 1.6, h: 0.58, size: 13, ls: 19, color: gold ? C.WHITE : C.SILVER_L, align: "center" });
  });
  VISUALS.add("longterm-roadmap");

  tx(
    s,
    [
      { text: "30億円はゴールではない。", o: { color: C.GOLD, br: true } },
      { text: "上場できる企業グループを作るための最初の通過点。", o: { color: C.WHITE } },
    ],
    { x: X0, y: 5.36, w: CW, h: 1.1, font: F.MIN, size: 24, ls: 38 },
  );
}

function s04() {
  const s = newSlide(4);
  frame(s, {
    n: 4,
    kicker: "GOAL ARCHITECTURE",
    title: "今日の仕事と上場は、一本の線でつながっている。",
    notes:
      "目標は3階層でできている。いちばん上が長期目標の上場企業グループ、その下が5年後の2031年（グループ連結売上30億円・グループ経営基盤の完成）、途中に2028年の親会社設立がある。いちばん下が今。ROOTIVEの自走化、つまり利益・人材・仕組み・信用を積み上げ、代表依存から脱却すること。今日の仕事は、この一本の線の上にある。",
  });
  // 背骨の線（NOW → LONG TERM）
  const sx = 0.95;
  line(s, sx, 5.925, sx, 2.74, { color: C.GOLD_L, width: 1.75, arrowEnd: true });
  node(s, sx, 2.52, 0.34, { ring: true, color: C.GOLD_L, lineW: 2, dot: 0.12 });
  node(s, sx, 3.925, 0.24, { color: C.GOLD_L });
  node(s, sx, 4.9, 0.18, { color: C.GOLD_L });
  node(s, sx, 5.925, 0.3, { color: C.NAVY });

  // LONG TERM
  rect(s, { x: 1.45, y: 1.85, w: 11.28, h: 1.4, fill: C.NAVY });
  tx(s, "LONG TERM", { x: 1.7, y: 1.98, w: 2.2, h: 0.25, font: F.EN, size: 10, bold: true, cs: 2, color: C.GOLD, valign: "middle" });
  tx(s, "IPO", { x: 1.7, y: 2.22, w: 2.2, h: 0.55, font: F.NUM, size: 30, bold: true, color: C.WHITE, valign: "middle" });
  tx(s, "上場企業グループ", { x: 1.7, y: 2.8, w: 2.2, h: 0.3, font: F.JPB, bold: true, size: 13, color: C.WHITE, valign: "middle" });
  tx(s, "上場に値する企業グループの状態", { x: 4.0, y: 1.98, w: 6, h: 0.25, size: 11, color: C.GOLD, valign: "middle" });
  const cond = [
    ["特定個人に依存しない", "複数事業を持つ", "継続的に利益を生む"],
    ["強い経営陣が存在する", "透明な経営管理ができる", "内部統制が機能する"],
    ["社会から信用される", "資本市場から評価される", "創業者がいなくなった後も企業として存続する"],
  ];
  const cx = [4.0, 6.3, 8.75];
  const cw = [2.2, 2.35, 3.9];
  cond.forEach((col, c) =>
    col.forEach((t, r) => {
      const y = 2.3 + r * 0.3;
      node(s, cx[c] + 0.03, y + 0.14, 0.06, { color: C.GOLD });
      tx(s, t, { x: cx[c] + 0.15, y, w: cw[c] - 0.15, h: 0.28, size: 12, color: C.WHITE, valign: "middle" });
    }),
  );

  // 5 YEARS
  rect(s, { x: 1.45, y: 3.4, w: 11.28, h: 1.05, fill: C.NAVY_MID });
  tx(s, "5 YEARS", { x: 1.7, y: 3.5, w: 2.2, h: 0.25, font: F.EN, size: 10, bold: true, cs: 2, color: C.GOLD, valign: "middle" });
  tx(s, "2031", { x: 1.7, y: 3.74, w: 2.2, h: 0.5, font: F.NUM, size: 26, bold: true, color: C.WHITE, valign: "middle" });
  tx(s, "KGI（暫定）", { x: 4.0, y: 3.52, w: 3, h: 0.25, size: 10.5, color: C.GOLD, valign: "middle" });
  tx(
    s,
    [
      { text: "グループ連結売上 ", o: { size: 14 } },
      { text: "30億円", o: { size: 20 } },
    ],
    { x: 4.0, y: 3.8, w: 3.3, h: 0.45, font: F.JPB, bold: true, color: C.WHITE, valign: "middle" },
  );
  tx(s, "PORTFOLIO", { x: 7.45, y: 3.52, w: 2.5, h: 0.25, font: F.EN, size: 10, bold: true, cs: 1, color: C.GOLD, valign: "middle" });
  tx(s, "複数事業・複数経営者", { x: 7.45, y: 3.83, w: 2.65, h: 0.4, font: F.JPB, bold: true, size: 15, color: C.WHITE, valign: "middle" });
  tx(s, "MANAGEMENT", { x: 10.2, y: 3.52, w: 2.4, h: 0.25, font: F.EN, size: 10, bold: true, cs: 1, color: C.GOLD, valign: "middle" });
  tx(s, "グループ経営基盤完成", { x: 10.2, y: 3.83, w: 2.45, h: 0.4, font: F.JPB, bold: true, size: 15, color: C.WHITE, valign: "middle" });

  // 2028
  rect(s, { x: 1.45, y: 4.6, w: 11.28, h: 0.6, fill: C.TINT });
  tx(s, "2028", { x: 1.7, y: 4.62, w: 0.9, h: 0.56, font: F.NUM, size: 18, bold: true, color: C.NAVY, valign: "middle" });
  tx(s, "MILESTONE", { x: 2.55, y: 4.62, w: 1.3, h: 0.56, font: F.EN, size: 10, bold: true, cs: 1, color: C.GOLD_D, valign: "middle" });
  tx(s, "親会社設立", { x: 4.0, y: 4.62, w: 3, h: 0.56, font: F.JPB, bold: true, size: 15, color: C.NAVY, valign: "middle" });
  tx(s, "グループ経営開始", { x: 7.45, y: 4.62, w: 3, h: 0.56, size: 14, color: C.INK, valign: "middle" });

  // NOW
  rect(s, { x: 1.45, y: 5.35, w: 11.28, h: 1.15, fill: C.WHITE, line: C.NAVY, lineW: 1 });
  tx(s, "NOW", { x: 1.7, y: 5.47, w: 2.2, h: 0.25, font: F.EN, size: 10, bold: true, cs: 2, color: C.GOLD_D, valign: "middle" });
  tx(s, "ROOTIVE自走化", { x: 1.7, y: 5.72, w: 2.3, h: 0.38, font: F.JPB, bold: true, size: 16, color: C.NAVY, valign: "middle" });
  tx(s, "代表依存からの脱却", { x: 1.7, y: 6.1, w: 2.3, h: 0.28, size: 11, color: C.MUTED, valign: "middle" });
  const assets = [
    ["MONEY", "利益"],
    ["PEOPLE", "人材"],
    ["SYSTEM", "仕組み"],
    ["TRUST", "信用"],
  ];
  assets.forEach(([en, jp], i) => {
    const x = 4.0 + i * 2.17;
    rect(s, { x, y: 5.5, w: 2.05, h: 0.85, fill: C.TINT });
    tx(s, en, { x: x + 0.18, y: 5.58, w: 1.7, h: 0.24, font: F.EN, size: 10, bold: true, cs: 1, color: C.GOLD_D, valign: "middle" });
    tx(s, jp, { x: x + 0.18, y: 5.84, w: 1.7, h: 0.4, font: F.JPB, bold: true, size: 17, color: C.NAVY, valign: "middle" });
  });
}

function s05() {
  const s = newSlide(5);
  frame(s, {
    n: 5,
    kicker: "2031 SUCCESS DEFINITION",
    title: "2031年の成功は、売上だけでは定義しない。",
    lead: "4つの領域がそろい、50億・100億、そして上場へ進める状態になったとき、2031年を成功とする。",
    marker: { from: 2, to: 2 },
    notes:
      "売上30億円を達成しただけでは成功と定義しない。財務・事業ポートフォリオ・組織・経営管理の4領域がそろい、50億、100億、そして上場へ進められる企業グループになっていることを成功条件とする。数値目標は連結売上30億円（暫定）だけで、それ以外は状態で定義している。",
  });
  const quads = [
    {
      no: "01",
      en: "FINANCIAL",
      jp: "財務",
      rows: [["__KGI__"], ["安定した営業利益", "営業CF創出"], ["十分な現預金", "継続的なM&Aを可能にする\n借入余力"]],
    },
    { no: "02", en: "PORTFOLIO", jp: "事業ポートフォリオ", rows: [["複数業種", "M&Aによる非連続成長"], ["複数事業", "新規事業創出能力"], ["収益源分散"]] },
    { no: "03", en: "ORGANIZATION", jp: "組織", rows: [["各子会社に経営責任者", "創業者非依存"], ["親会社経営陣", "共通管理機能"], ["経営人材育成"]] },
    { no: "04", en: "MANAGEMENT", jp: "経営管理", rows: [["連結管理", "資本配分"], ["予実管理", "PMI"], ["キャッシュ管理", "内部統制"]] },
  ];
  quads.forEach((q, i) => {
    const x = i % 2 === 0 ? 0.6 : 6.815;
    const y = i < 2 ? 1.95 : 4.3;
    const w = 5.918;
    rect(s, { x, y, w, h: 2.2, fill: C.TINT });
    tx(s, q.no, { x: x + 0.3, y: y + 0.18, w: 0.55, h: 0.38, font: F.NUM, size: 16, bold: true, color: C.GOLD_D, valign: "middle" });
    tx(s, q.jp, { x: x + 0.85, y: y + 0.18, w: 3, h: 0.38, font: F.JPB, bold: true, size: 18, color: C.NAVY, valign: "middle" });
    tx(s, q.en, { x: x + 3.3, y: y + 0.18, w: 2.35, h: 0.38, font: F.EN, size: 11, bold: true, cs: 2, color: C.GOLD_D, align: "right", valign: "middle" });
    let ry = y + 0.72;
    q.rows.forEach((row) => {
      if (row[0] === "__KGI__") {
        node(s, x + 0.33, ry + 0.17, 0.08, { color: C.NAVY });
        tx(
          s,
          [
            { text: "グループ連結売上 30億円", o: { font: F.JPB, bold: true, color: C.NAVY, size: 15 } },
            { text: "（暫定）", o: { color: C.GOLD_D, size: 12 } },
          ],
          { x: x + 0.5, y: ry, w: 5.1, h: 0.34, valign: "middle" },
        );
        ry += 0.42;
        return;
      }
      let rowH = 0.34;
      row.forEach((t, c) => {
        const n = t.split("\n").length;
        const h = n > 1 ? (21 / 72) * n : 0.34;
        rowH = Math.max(rowH, h);
        const ix = x + 0.3 + c * 2.8;
        node(s, ix + 0.03, ry + (n > 1 ? 21 / 72 / 2 : 0.17), 0.07, { color: C.GOLD_L });
        tx(s, t, { x: ix + 0.2, y: ry, w: 2.55, h, size: 14, color: C.INK, valign: n > 1 ? "top" : "middle", ls: n > 1 ? 21 : undefined });
      });
      ry += rowH + 0.08;
    });
  });
}

function s06() {
  const s = newSlide(6);
  frame(s, {
    n: 6,
    kicker: "5 YEAR REVENUE TARGET",
    title: "5カ年で、グループ連結売上を2億円から30億円へ。",
    marker: { from: 0, to: 2 },
    notes:
      "グループ連結売上高の暫定経営目標。FY2027 2億円、FY2028 5億円、FY2029 10億円、FY2030 18億円、FY2031 30億円。5年で15倍。前年比は2.5倍から1.7倍へ下がっていく設計で、年平均成長率（FY2027→FY2031）は計算上約97%。いずれも暫定であり、財務モデル策定後に確定する。",
  });
  tx(s, "グループ連結売上高（単位：億円）", { x: X0, y: 1.9, w: 5.5, h: 0.32, font: F.JPB, bold: true, size: 14, color: C.NAVY, valign: "middle" });
  tx(s, "暫定経営目標", { x: 6.95, y: 1.9, w: 1.6, h: 0.32, font: F.JPB, bold: true, size: 11, color: C.GOLD_D, align: "center", valign: "middle", line: C.GOLD_D, lineW: 1 });
  s.addChart(
    pres.ChartType.line,
    [{ name: "グループ連結売上高（暫定）", labels: FY.slice(), values: REV.slice() }],
    {
      x: 0.6,
      y: 2.3,
      w: 8.0,
      h: 3.85,
      chartColors: [C.NAVY],
      lineSize: 3,
      lineDataSymbol: "circle",
      lineDataSymbolSize: 11,
      lineDataSymbolLineColor: C.WHITE,
      lineDataSymbolLineSize: 2,
      showValue: true,
      dataLabelPosition: "l",
      dataLabelFormatCode: '0"億円"',
      dataLabelFontFace: F.JPB,
      dataLabelFontSize: 14,
      dataLabelFontBold: true,
      dataLabelColor: C.NAVY,
      valAxisMinVal: 0,
      valAxisMaxVal: 35,
      valAxisMajorUnit: 5,
      valAxisLabelFormatCode: "0",
      valAxisLabelFontFace: F.EN,
      valAxisLabelFontSize: 11,
      valAxisLabelColor: C.MUTED,
      valAxisLineShow: false,
      valGridLine: { color: C.RULE, size: 0.75 },
      catGridLine: { style: "none" },
      catAxisLabelFontFace: F.EN,
      catAxisLabelFontSize: 12,
      catAxisLabelColor: C.NAVY,
      catAxisLineShow: true,
      showLegend: false,
      showTitle: false,
      altText: "FY2027〜FY2031 グループ連結売上高の暫定経営目標：2億円、5億円、10億円、18億円、30億円",
    },
  );
  VISUALS.add("revenue-line-chart");

  // 右の数字
  rect(s, { x: 8.95, y: 1.9, w: 3.78, h: 4.25, fill: C.TINT });
  tx(s, "5カ年の成長倍率", { x: 9.2, y: 2.05, w: 3.3, h: 0.3, font: F.JPB, bold: true, size: 13, color: C.NAVY, valign: "middle" });
  tx(s, "×15", { x: 9.2, y: 2.33, w: 3.3, h: 1.02, font: F.NUM, size: 60, bold: true, color: C.NAVY, valign: "middle" });
  tx(s, "FY2027 2億円 → FY2031 30億円", { x: 9.2, y: 3.32, w: 3.35, h: 0.28, size: 12, color: C.INK, valign: "middle" });
  const tY = 3.78;
  tx(s, "年度", { x: 9.2, y: tY, w: 1.1, h: 0.26, size: 11, color: C.MUTED, valign: "middle" });
  tx(s, "暫定売上", { x: 10.35, y: tY, w: 1.1, h: 0.26, size: 11, color: C.MUTED, valign: "middle" });
  tx(s, "前年比", { x: 11.5, y: tY, w: 1.0, h: 0.26, size: 11, color: C.MUTED, align: "right", valign: "middle" });
  line(s, 9.2, tY + 0.3, 12.5, tY + 0.3, { color: C.NAVY, width: 0.75 });
  const mult = ["—", "×2.5", "×2.0", "×1.8", "×1.7"];
  REV.forEach((v, i) => {
    const y = tY + 0.34 + i * 0.34;
    const last = i === 4;
    tx(s, FY[i], { x: 9.2, y, w: 1.1, h: 0.3, font: F.EN, size: 12, bold: last, color: last ? C.NAVY : C.INK, valign: "middle" });
    tx(s, `${v}億円`, { x: 10.35, y, w: 1.1, h: 0.3, font: last ? F.JPB : F.JP, size: 12, bold: last, color: last ? C.NAVY : C.INK, valign: "middle" });
    tx(s, mult[i], { x: 11.5, y, w: 1.0, h: 0.3, font: i === 0 ? F.JP : F.EN, size: 12, bold: last, color: last ? C.NAVY : C.INK, align: "right", valign: "middle" });
    if (i < 4) line(s, 9.2, y + 0.32, 12.5, y + 0.32, { color: C.RULE_D, width: 0.5 });
  });
  tx(s, "倍率は暫定目標値からの算出", { x: 9.2, y: 5.8, w: 3.3, h: 0.26, size: 10, color: C.MUTED, valign: "middle" });
  tx(s, "※ FY＝10月〜翌9月の12か月（例：FY2027＝2026年10月〜2027年9月）。数値はすべて暫定経営目標であり、財務モデル策定後に確定する。", {
    x: X0,
    y: 6.28,
    w: CW,
    h: 0.26,
    size: 10,
    color: C.MUTED,
    valign: "middle",
  });
}

function s07() {
  const s = newSlide(7);
  frame(s, {
    n: 7,
    kicker: "GROWTH ENGINE",
    title: "30億円は、3つの成長エンジンを重ねて作る。",
    lead: "既存事業の成長だけでは届かない。新規事業とM&Aを重ね、グループとして売上を形成する。",
    marker: { from: 0, to: 2 },
    notes:
      "30億円を物流単体で作る計画ではない。ROOTIVE既存事業の成長（ORGANIC）、自社で立ち上げる新規事業（NEW BUSINESS）、異業種企業の買収（M&A）の3つが、時間とともに重なってグループ売上を作る。各エンジンの構成比はまだ決めていない。財務モデルを作ってから確定する。",
  });
  const colX = (j) => 3.3 + j * 1.45;
  for (let j = 0; j < 5; j++) {
    if (j % 2 === 0) rect(s, { x: colX(j) - 0.05, y: 1.95, w: 1.45, h: 4.05, fill: "F7F8FA" });
    tx(s, `YEAR ${j + 1}`, { x: colX(j), y: 2.0, w: 1.35, h: 0.26, font: F.EN, size: 11, bold: true, color: C.NAVY, align: "center", valign: "middle" });
    tx(s, FY[j], { x: colX(j), y: 2.25, w: 1.35, h: 0.24, font: F.EN, size: 10, color: C.MUTED, align: "center", valign: "middle" });
  }
  const rows = [
    { cy: 2.98, en: "ORGANIC GROWTH", jp: "ROOTIVE既存事業" },
    { cy: 4.13, en: "NEW BUSINESS", jp: "自社立ち上げ事業" },
    { cy: 5.28, en: "M&A", jp: "異業種企業の買収" },
  ];
  rows.forEach((r) => {
    rect(s, { x: 0.6, y: r.cy - 0.45, w: 2.45, h: 0.9, fill: C.TINT });
    tx(s, r.en, { x: 0.8, y: r.cy - 0.34, w: 2.15, h: 0.3, font: F.EN, size: 12, bold: true, color: C.NAVY, valign: "middle" });
    tx(s, r.jp, { x: 0.8, y: r.cy - 0.02, w: 2.15, h: 0.3, size: 12, color: C.INK, valign: "middle" });
  });
  const bh = 0.62;
  // ORGANIC
  rect(s, { x: colX(0), y: rows[0].cy - bh / 2, w: colX(4) + 1.35 - colX(0), h: bh, fill: C.NAVY });
  tx(s, "既存事業の継続的な成長", { x: colX(0) + 0.2, y: rows[0].cy - bh / 2, w: 5, h: bh, font: F.JPB, bold: true, size: 13, color: C.WHITE, valign: "middle" });
  // NEW BUSINESS
  const nb = rows[1].cy;
  tx(s, "新規事業検討", { x: colX(1), y: nb - bh / 2, w: 1.35, h: bh, font: F.JPB, bold: true, size: 12, color: C.STEEL, align: "center", valign: "middle", line: C.STEEL, lineW: 1 });
  line(s, colX(1) + 1.35, nb, colX(4), nb, { color: C.STEEL, width: 1.25, dash: "sysDash" });
  tx(s, "新規事業の\n創出", { x: colX(4), y: nb - bh / 2, w: 1.35, h: bh, font: F.JPB, bold: true, size: 12, ls: 17, color: C.WHITE, align: "center", valign: "middle", fill: C.NAVY_MID });
  // M&A
  const ma = rows[2].cy;
  tx(s, "ソーシング・\n融資準備", { x: colX(1), y: ma - bh / 2, w: 1.35, h: bh, font: F.JPB, bold: true, size: 12, ls: 17, color: C.GOLD_D, align: "center", valign: "middle", line: C.GOLD_L, lineW: 1 });
  ["最初のM&A", "再現性構築", "継続M&A"].forEach((t, k) => {
    tx(s, t, { x: colX(2 + k), y: ma - bh / 2, w: 1.35, h: bh, font: F.JPB, bold: true, size: 12, color: C.NAVY, align: "center", valign: "middle", fill: C.GOLD });
  });
  // 集まる線
  const endX = colX(4) + 1.35;
  const busX = 10.65;
  rows.forEach((r) => line(s, endX, r.cy, busX, r.cy, { color: C.NAVY, width: 1.25 }));
  line(s, busX, rows[0].cy, busX, rows[2].cy, { color: C.NAVY, width: 1.25 });
  line(s, busX, rows[1].cy, 10.88, rows[1].cy, { color: C.NAVY, width: 1.5, arrowEnd: true });
  rect(s, { x: 10.9, y: 2.45, w: 1.83, h: 3.4, fill: C.NAVY });
  tx(s, "GROUP\nREVENUE", { x: 10.9, y: 2.62, w: 1.83, h: 0.46, font: F.EN, size: 11, bold: true, cs: 1, ls: 15, color: C.GOLD, align: "center" });
  tx(s, "グループ\n連結売上", { x: 10.9, y: 3.2, w: 1.83, h: 0.7, font: F.JPB, bold: true, size: 15, ls: 22, color: C.WHITE, align: "center" });
  tx(s, "FY2031", { x: 10.9, y: 4.12, w: 1.83, h: 0.26, font: F.EN, size: 11, color: C.SILVER, align: "center", valign: "middle" });
  tx(s, "30億円", { x: 10.9, y: 4.4, w: 1.83, h: 0.5, font: F.JPB, bold: true, size: 24, color: C.WHITE, align: "center", valign: "middle" });
  tx(s, "（暫定経営目標）", { x: 10.9, y: 4.95, w: 1.83, h: 0.26, size: 10, color: C.SILVER, align: "center", valign: "middle" });
  tx(s, "※ 各エンジンの構成比は定めていない（財務モデル策定後に確定）。時期は5カ年ロードマップ（P.08）に基づく。", {
    x: X0,
    y: 6.18,
    w: CW,
    h: 0.26,
    size: 10,
    color: C.MUTED,
    valign: "middle",
  });
}

function s08() {
  const s = newSlide(8);
  frame(s, {
    n: 8,
    kicker: "5 YEAR ROADMAP",
    title: "1年ごとに到達点を定め、グループ経営へ段階的に移行する。",
    marker: { from: 0, to: 2 },
    notes:
      "5年間を5つの段階に分ける。YEAR 1でROOTIVEの経営基盤を作り、YEAR 2で親会社を設立してグループ化を始める。YEAR 3で最初のM&Aを成功させてモデルを確立し、YEAR 4でそれを組織の能力にする。YEAR 5で連結30億円とグループ経営基盤を完成させる。最初の18か月（2026.10〜2028.3）が親会社設立までの期間。",
  });
  const colW = 2.187;
  const colX = (k) => 0.6 + k * 2.4865;
  const cx = (k) => colX(k) + colW / 2;
  // FIRST 18 MONTHS
  tx(
    s,
    [
      { text: "FIRST 18 MONTHS", o: { font: F.EN, bold: true, cs: 2, color: C.GOLD_D } },
      { text: "   2026.10–2028.3", o: { font: F.EN, color: C.MUTED } },
    ],
    { x: X0, y: 1.82, w: 5, h: 0.26, size: 11, valign: "middle" },
  );
  line(s, X0, 2.14, cx(1), 2.14, { color: C.GOLD_L, width: 1 });
  line(s, X0, 2.14, X0, 2.24, { color: C.GOLD_L, width: 1 });
  line(s, cx(1), 2.14, cx(1), 2.24, { color: C.GOLD_L, width: 1 });
  const periods = ["2026.10–2027.9", "2027.10–2028.9", "2028.10–2029.9", "2029.10–2030.9", "2030.10–2031.9"];
  for (let k = 0; k < 5; k++) {
    tx(s, `YEAR ${k + 1}`, { x: colX(k), y: 2.3, w: colW, h: 0.38, font: F.NUM, size: 20, bold: true, color: C.NAVY, align: "center", valign: "middle" });
    tx(s, periods[k], { x: colX(k), y: 2.68, w: colW, h: 0.26, font: F.EN, size: 12, color: C.MUTED, align: "center", valign: "middle" });
  }
  const ly = 3.15;
  line(s, X0, ly, X1, ly, { color: C.GOLD_L, width: 1.5, arrowEnd: true });
  for (let k = 0; k < 5; k++) {
    if (k === 1) node(s, cx(k), ly, 0.32, { color: C.GOLD_L, diamond: true });
    else node(s, cx(k), ly, k === 4 ? 0.28 : 0.2, { color: k === 4 ? C.NAVY : C.GOLD_L });
  }
  VISUALS.add("year-timeline");
  const stages = ["ROOTIVE\n経営基盤構築", "親会社設立・\nグループ化開始", "M&Aモデル\n確立", "M&A\n再現性構築", "連結30億・\nグループ経営\n基盤完成"];
  for (let k = 0; k < 5; k++) {
    const x = colX(k);
    const last = k === 4;
    rect(s, { x, y: 3.45, w: colW, h: 3.0, fill: last ? C.NAVY : C.TINT });
    tx(s, `0${k + 1}`, { x: x + 0.2, y: 3.56, w: 0.8, h: 0.4, font: F.NUM, size: 22, bold: true, color: last ? C.GOLD : C.GOLD_D, valign: "middle" });
    tx(s, stages[k], { x: x + 0.2, y: 4.02, w: 1.9, h: 1.0, font: F.JPB, bold: true, size: 15, ls: 22, color: last ? C.WHITE : C.NAVY });
    if (k === 1) tx(s, "2028.3 親会社設立", { x: x + 0.2, y: 5.02, w: 1.75, h: 0.3, font: F.JPB, bold: true, size: 11, color: C.GOLD_D, align: "center", valign: "middle", line: C.GOLD_D, lineW: 1 });
    tx(s, k === 0 ? "売上（暫定）" : "グループ売上（暫定）", { x: x + 0.2, y: 5.4, w: 1.9, h: 0.26, size: 11, color: last ? C.SILVER_L : C.MUTED, valign: "middle" });
    tx(
      s,
      [
        { text: String(REV[k]), o: { font: F.NUM, size: 26, bold: true } },
        { text: "億円", o: { font: F.JPB, size: 14, bold: true } },
      ],
      { x: x + 0.2, y: 5.64, w: 1.9, h: 0.5, color: last ? C.WHITE : C.NAVY, valign: "middle" },
    );
    tx(s, `詳細 P.${10 + k}`, { x: x + 0.2, y: 6.14, w: 1.9, h: 0.24, size: 10, color: last ? C.SILVER : C.MUTED, valign: "middle" });
  }
}

function s09() {
  const s = newSlide(9);
  frame(s, {
    n: 9,
    theme: "dark",
    kicker: "FIRST 18 MONTHS",
    title: "最初の18か月は、「次の会社を買える企業になる18か月」。",
    marker: { from: 0, to: 1 },
    notes:
      "2026年10月から2028年3月の親会社設立までの18か月（YEAR 1とYEAR 2の前半）。この期間の目的は、次の会社を買える企業になること。そのために、金（利益・現預金・営業CF・金融機関の信用・借入余力）、人、仕組み、信用の4つの資産を積み上げる。これらがM&Aの資金調達と実行の前提になる。",
  });
  tx(
    s,
    [
      { text: "2028", o: { font: F.NUM, size: 60, bold: true } },
      { text: "年3月", o: { font: F.JPB, size: 30, bold: true } },
    ],
    { x: X0, y: 1.86, w: 5.8, h: 1.06, color: C.GOLD, valign: "middle" },
  );
  tx(s, "親会社設立", { x: X0, y: 2.88, w: 5.8, h: 0.75, font: F.MIN, size: 40, color: C.WHITE, valign: "middle" });

  // 18か月の物差し
  tx(s, "18 MONTHS", { x: 6.9, y: 1.95, w: 3, h: 0.28, font: F.EN, size: 12, bold: true, cs: 3, color: C.GOLD, valign: "middle" });
  const rx0 = 7.0;
  const rx1 = 12.5;
  const ry = 2.75;
  line(s, rx0, ry, rx1, ry, { color: C.GOLD, width: 1.5 });
  for (let m = 0; m <= 18; m++) {
    const x = rx0 + (m * (rx1 - rx0)) / 18;
    const big = m === 0 || m === 12;
    if (m === 18) continue;
    line(s, x, big ? ry - 0.13 : ry - 0.06, x, big ? ry + 0.13 : ry + 0.06, { color: big ? C.GOLD : C.SILVER, width: big ? 1.25 : 0.75 });
  }
  node(s, rx0, ry, 0.16, { color: C.GOLD });
  node(s, rx1, ry, 0.3, { color: C.GOLD, diamond: true });
  tx(s, "2026.10", { x: 6.9, y: 2.98, w: 1.2, h: 0.26, font: F.EN, size: 11, color: C.SILVER, valign: "middle" });
  tx(s, "YEAR 1 開始", { x: 6.9, y: 3.22, w: 1.4, h: 0.26, size: 11, color: C.SILVER, valign: "middle" });
  const m12 = rx0 + (12 * (rx1 - rx0)) / 18;
  tx(s, "2027.9", { x: m12 - 0.6, y: 2.98, w: 1.2, h: 0.26, font: F.EN, size: 11, color: C.SILVER, align: "center", valign: "middle" });
  tx(s, "YEAR 1 終了", { x: m12 - 0.7, y: 3.22, w: 1.4, h: 0.26, size: 11, color: C.SILVER, align: "center", valign: "middle" });
  tx(s, "2028.3", { x: 11.53, y: 2.98, w: 1.2, h: 0.26, font: F.EN, size: 11, bold: true, color: C.GOLD, align: "right", valign: "middle" });
  tx(s, "親会社設立", { x: 11.33, y: 3.22, w: 1.4, h: 0.26, font: F.JPB, bold: true, size: 11, color: C.GOLD, align: "right", valign: "middle" });

  const cards = [
    { en: "MONEY", jp: "金", list: ["利益", "現預金", "営業CF", "金融機関信用", "借入余力"] },
    { en: "PEOPLE", jp: "人", list: ["幹部", "営業", "採用", "管理人材", "ROOTIVE経営責任者候補"] },
    { en: "SYSTEM", jp: "仕組み", list: ["管理会計", "予実管理", "KPI", "SOP", "月次決算", "経営会議"] },
    { en: "TRUST", jp: "信用", list: ["荷主", "金融機関", "取引実績", "法令遵守", "経営実績"] },
  ];
  cards.forEach((c, k) => {
    const x = 0.6 + k * 3.096;
    rect(s, { x, y: 3.8, w: 2.846, h: 2.7, fill: C.CARD_DK });
    tx(s, c.en, { x: x + 0.25, y: 3.95, w: 1.6, h: 0.36, font: F.EN, size: 13, bold: true, cs: 2, color: C.GOLD, valign: "middle" });
    tx(s, c.jp, { x: x + 1.25, y: 3.95, w: 1.35, h: 0.36, font: F.JPB, bold: true, size: 18, color: C.WHITE, align: "right", valign: "middle" });
    items(s, c.list, { x: x + 0.25, y: 4.48, w: 2.45, size: 13, color: C.SILVER_L, dotColor: C.GOLD, gap: 0.05, dot: 0.06 });
  });
}

// YEAR ページの帯（年・段階・棒グラフ・売上）
function yearStrip(s, k, stage) {
  rect(s, { x: X0, y: 1.72, w: CW, h: 0.88, fill: C.TINT });
  tx(s, `YEAR ${k + 1}`, { x: 0.85, y: 1.8, w: 2.1, h: 0.42, font: F.NUM, size: 24, bold: true, color: C.NAVY, valign: "middle" });
  const periods = ["2026.10–2027.9", "2027.10–2028.9", "2028.10–2029.9", "2029.10–2030.9", "2030.10–2031.9"];
  tx(s, periods[k], { x: 0.85, y: 2.23, w: 2.1, h: 0.26, font: F.EN, size: 12, color: C.MUTED, valign: "middle" });
  line(s, 3.05, 1.88, 3.05, 2.44, { color: C.RULE_D, width: 0.75 });
  tx(s, "STAGE", { x: 3.3, y: 1.84, w: 4.4, h: 0.24, font: F.EN, size: 10, bold: true, cs: 2, color: C.GOLD_D, valign: "middle" });
  tx(s, stage, { x: 3.3, y: 2.1, w: 4.5, h: 0.4, font: F.JPB, bold: true, size: 16, color: C.NAVY, valign: "middle" });
  const colors = REV.map((_, i) => (i === k ? C.GOLD_L : C.BAR_OFF));
  s.addChart(pres.ChartType.bar, [{ name: "グループ連結売上（暫定）", labels: ["Y1", "Y2", "Y3", "Y4", "Y5"], values: REV.slice() }], {
    x: 7.85,
    y: 1.76,
    w: 2.45,
    h: 0.82,
    barDir: "col",
    chartColors: colors,
    barGapWidthPct: 40,
    showValue: false,
    valAxisHidden: true,
    valAxisMinVal: 0,
    valAxisMaxVal: 30,
    valGridLine: { style: "none" },
    catGridLine: { style: "none" },
    catAxisLabelFontFace: F.EN,
    catAxisLabelFontSize: 10,
    catAxisLabelColor: C.MUTED,
    catAxisLineShow: false,
    showLegend: false,
    showTitle: false,
    altText: `グループ連結売上の暫定目標の推移（YEAR ${k + 1} を強調）`,
  });
  line(s, 10.5, 1.88, 10.5, 2.44, { color: C.RULE_D, width: 0.75 });
  tx(s, k === 0 ? "売上（暫定）" : k === 4 ? "連結売上（暫定）" : "グループ売上（暫定）", { x: 10.62, y: 1.84, w: 1.96, h: 0.24, size: 10, color: C.MUTED, align: "right", valign: "middle" });
  tx(
    s,
    [
      { text: String(REV[k]), o: { font: F.NUM, size: 26, bold: true } },
      { text: "億円", o: { font: F.JPB, size: 14, bold: true } },
    ],
    { x: 10.62, y: 2.07, w: 1.96, h: 0.46, color: C.NAVY, align: "right", valign: "middle" },
  );
}

function tiles(s, list, o) {
  // list: 名前の配列。o: {x, y, cols, w, h, gapX, gapY, hi:Set}
  list.forEach((t, i) => {
    const c = i % o.cols;
    const r = Math.floor(i / o.cols);
    const x = o.x + c * (o.w + o.gapX);
    const y = o.y + r * (o.h + o.gapY);
    const hi = o.hi && o.hi.has(i);
    rect(s, { x, y, w: o.w, h: o.h, fill: hi ? C.NAVY_MID : C.WHITE, line: hi ? undefined : C.RULE_D, lineW: 1 });
    tx(s, String(i + 1).padStart(2, "0"), { x: x + 0.18, y, w: 0.42, h: o.h, font: F.NUM, size: 13, bold: true, color: hi ? C.GOLD : C.GOLD_D, valign: "middle" });
    tx(s, t, { x: x + 0.62, y, w: o.w - 0.72, h: o.h, font: F.JPB, bold: true, size: 14, color: hi ? C.WHITE : C.NAVY, valign: "middle" });
  });
}

function sectionHead(s, jp, en, x, y, w, dark) {
  tx(
    s,
    [
      { text: jp, o: { font: F.JPB, bold: true, size: 14, color: dark ? C.WHITE : C.NAVY } },
      { text: `   ${en}`, o: { font: F.EN, bold: true, size: 10, cs: 2, color: dark ? C.GOLD : C.GOLD_D } },
    ],
    { x, y, w, h: 0.3, valign: "middle" },
  );
}

function s10() {
  const s = newSlide(10);
  frame(s, {
    n: 10,
    kicker: "YEAR 1  |  2026–2027",
    title: "ROOTIVEを「代表が回す会社」から「組織で回る会社」へ。",
    marker: { from: 0, to: 0 },
    notes:
      "YEAR 1のテーマは、ROOTIVEを代表が回す会社から組織で回る会社に変えること。暫定売上は2億円。営業組織・荷主への直営業・採用導線・ドライバー供給力・運行管理を固め、幹部を育て、請求支払・管理会計・資金繰り・月次経営管理・SOPを整える。終了条件は、代表が1週間日常オペレーションに入らなくても会社が回ること。",
  });
  yearStrip(s, 0, "ROOTIVE経営基盤構築");
  sectionHead(s, "重点施策（12）", "KEY INITIATIVES", X0, 2.85, 7.5);
  const list = ["営業組織構築", "荷主直営業", "採用導線", "ドライバー供給力", "運行管理", "幹部育成", "請求支払", "管理会計", "資金繰り", "月次経営管理", "SOP", "代表現場離脱"];
  tiles(s, list, { x: X0, y: 3.25, cols: 3, w: 2.45, h: 0.64, gapX: 0.17, gapY: 0.14, hi: new Set([11]) });
  rect(s, { x: 8.6, y: 2.85, w: 4.13, h: 3.65, fill: C.NAVY });
  tx(s, "EXIT CONDITION", { x: 8.9, y: 3.05, w: 3.5, h: 0.3, font: F.EN, size: 12, bold: true, cs: 2, color: C.GOLD, valign: "middle" });
  tx(s, "YEAR 1 の終了条件", { x: 8.9, y: 3.38, w: 3.5, h: 0.3, size: 12, color: C.SILVER_L, valign: "middle" });
  tx(s, "代表が1週間、\n日常オペレーションに\n入らなくても\n会社が回る。", { x: 8.9, y: 3.95, w: 3.6, h: 2.1, font: F.MIN, size: 22, ls: 36, color: C.WHITE });
}

function s11() {
  const s = newSlide(11);
  frame(s, {
    n: 11,
    kicker: "YEAR 2  |  2027–2028",
    title: "事業経営者から、グループ経営者へ。",
    marker: { from: 1, to: 1 },
    notes:
      "YEAR 2のテーマは、事業経営者からグループ経営者になること。暫定グループ売上は5億円。最大のイベントは2028年3月の親会社設立で、ROOTIVEを子会社化してグループ管理を始める。同時に金融機関との取引を強化し、M&A融資の準備とソーシングを進め、経営者候補の育成と新規事業の検討に着手する。",
  });
  yearStrip(s, 1, "親会社設立・グループ化開始");
  tx(s, "最大イベント", { x: X0, y: 2.85, w: 3, h: 0.28, font: F.JPB, bold: true, size: 12, color: C.GOLD_D, valign: "middle" });
  tx(s, "2028年3月 親会社設立", { x: X0, y: 3.13, w: 5.6, h: 0.5, font: F.MIN, size: 22, color: C.NAVY, valign: "middle" });
  // BEFORE
  tx(s, "BEFORE", { x: X0, y: 3.72, w: 1.9, h: 0.24, font: F.EN, size: 10, bold: true, cs: 2, color: C.MUTED, valign: "middle" });
  tx(s, "創業者", { x: X0, y: 4.0, w: 1.9, h: 0.42, font: F.JPB, bold: true, size: 13, color: C.NAVY, align: "center", valign: "middle", line: C.NAVY, lineW: 1 });
  line(s, 1.55, 4.42, 1.55, 5.5, { color: C.NAVY, width: 1 });
  tx(s, "株式会社ROOTIVE", { x: X0, y: 5.5, w: 1.9, h: 0.48, font: F.JPB, bold: true, size: 12, color: C.NAVY, align: "center", valign: "middle", line: C.NAVY, lineW: 1 });
  line(s, 2.75, 4.99, 3.3, 4.99, { color: C.GOLD_L, width: 2, arrowEnd: true });
  // AFTER
  tx(s, "AFTER", { x: 3.5, y: 3.72, w: 2.7, h: 0.24, font: F.EN, size: 10, bold: true, cs: 2, color: C.GOLD_D, valign: "middle" });
  tx(s, "創業者", { x: 3.5, y: 4.0, w: 2.7, h: 0.42, font: F.JPB, bold: true, size: 13, color: C.NAVY, align: "center", valign: "middle", line: C.NAVY, lineW: 1 });
  line(s, 4.85, 4.42, 4.85, 4.72, { color: C.NAVY, width: 1 });
  tx(s, "100%", { x: 4.95, y: 4.45, w: 0.7, h: 0.24, font: F.EN, size: 10, bold: true, color: C.GOLD_D, valign: "middle" });
  tx(s, "親会社", { x: 3.5, y: 4.72, w: 2.7, h: 0.48, font: F.JPB, bold: true, size: 13, color: C.WHITE, align: "center", valign: "middle", fill: C.NAVY });
  line(s, 4.85, 5.2, 4.85, 5.5, { color: C.NAVY, width: 1 });
  tx(s, "100%", { x: 4.95, y: 5.23, w: 0.7, h: 0.24, font: F.EN, size: 10, bold: true, color: C.GOLD_D, valign: "middle" });
  tx(s, "株式会社ROOTIVE", { x: 3.5, y: 5.5, w: 2.7, h: 0.48, font: F.JPB, bold: true, size: 12, color: C.NAVY, align: "center", valign: "middle", line: C.NAVY, lineW: 1 });
  tx(s, "親会社を設立し、ROOTIVEを子会社化する。", { x: X0, y: 6.1, w: 5.6, h: 0.28, size: 11, color: C.MUTED, valign: "middle" });

  sectionHead(s, "重点施策（8）", "KEY INITIATIVES", 6.75, 2.85, 5.9);
  const list = ["親会社設立", "ROOTIVE子会社化", "グループ管理", "金融機関取引強化", "M&A融資準備", "M&Aソーシング", "経営者候補育成", "新規事業検討"];
  tiles(s, list, { x: 6.75, y: 3.25, cols: 2, w: 2.9, h: 0.64, gapX: 0.18, gapY: 0.14, hi: new Set([0, 1]) });
}

function s12() {
  const s = newSlide(12);
  frame(s, {
    n: 12,
    kicker: "YEAR 3  |  2028–2029",
    title: "最初のM&Aを成功させる。",
    marker: { seg: [1, 2] },
    notes:
      "YEAR 3のテーマは最初のM&Aを成功させること。暫定グループ売上は10億円。案件の発掘からデューデリジェンス、企業価値評価、資金調達、買収、買収後100日の統合（PMI）、成長までを一通りやり切る。重要なのは買収件数ではない。買う・任せる・改善する・成長させる、というモデルを完成させることが目的。",
  });
  yearStrip(s, 2, "M&Aモデル確立");
  tx(
    s,
    [
      { text: "M&A PROCESS", o: { font: F.EN, bold: true, size: 11, cs: 2, color: C.GOLD_D } },
      { text: "   案件の発掘から、買収後の成長までの7段階", o: { size: 12, color: C.MUTED } },
    ],
    { x: X0, y: 2.85, w: 9, h: 0.3, valign: "middle" },
  );
  const steps = [
    ["SOURCING", "案件発掘"],
    ["DD", "買収監査"],
    ["VALUATION", "企業価値評価"],
    ["FINANCING", "資金調達"],
    ["ACQUISITION", "買収実行"],
    ["100 DAYS PMI", "統合後100日"],
    ["GROWTH", "成長"],
  ];
  steps.forEach(([en, jp], k) => {
    const x = 0.6 + k * 1.742;
    const last = k === 6;
    slideShape(s, pres.ShapeType.homePlate, { x, y: 3.3, w: 1.68, h: 0.82, fill: last ? C.GOLD : C.NAVY });
    tx(s, `0${k + 1}`, { x: x + 0.14, y: 3.36, w: 0.6, h: 0.26, font: F.NUM, size: 11, bold: true, color: last ? C.NAVY : C.GOLD, valign: "middle" });
    tx(s, en, { x: x + 0.14, y: 3.64, w: 1.2, h: 0.36, font: F.EN, size: 11, bold: true, color: last ? C.NAVY : C.WHITE, valign: "middle" });
    tx(s, jp, { x: x, y: 4.2, w: 1.5, h: 0.3, size: 12, color: C.INK, align: "center", valign: "middle" });
  });
  VISUALS.add("ma-process");
  tx(s, "重要なのは、\n買収件数ではない。", { x: X0, y: 4.72, w: 4.4, h: 1.1, font: F.MIN, size: 24, ls: 38, color: C.NAVY });
  tx(s, "「買う→任せる→改善する→成長させる」\nというモデルを完成させる。", { x: X0, y: 5.9, w: 4.5, h: 0.58, size: 13, ls: 20, color: C.INK });
  tx(
    s,
    [
      { text: "完成させるモデル", o: { font: F.JPB, bold: true, size: 12, color: C.GOLD_D } },
      { text: "   MODEL", o: { font: F.EN, bold: true, size: 10, cs: 2, color: C.GOLD_D } },
    ],
    { x: 5.3, y: 4.72, w: 5, h: 0.3, valign: "middle" },
  );
  const model = [
    ["BUY", "買う"],
    ["DELEGATE", "任せる"],
    ["IMPROVE", "改善する"],
    ["GROW", "成長させる"],
  ];
  model.forEach(([en, jp], k) => {
    const x = 5.3 + k * 1.9;
    const last = k === 3;
    rect(s, { x, y: 5.12, w: 1.6, h: 1.1, fill: last ? C.NAVY : C.TINT });
    tx(s, en, { x: x + 0.18, y: 5.24, w: 1.3, h: 0.24, font: F.EN, size: 10, bold: true, cs: 1, color: last ? C.GOLD : C.GOLD_D, valign: "middle" });
    tx(s, jp, { x: x + 0.18, y: 5.55, w: 1.4, h: 0.45, font: F.JPB, bold: true, size: 17, color: last ? C.WHITE : C.NAVY, valign: "middle" });
    if (k < 3) line(s, x + 1.64, 5.67, x + 1.86, 5.67, { color: C.GOLD_L, width: 1.5, arrowEnd: true });
  });
}

function slideShape(s, shape, o) {
  const opts = { x: o.x, y: o.y, w: o.w, h: o.h };
  if (o.fill) opts.fill = { color: o.fill };
  if (o.line) opts.line = { color: o.line, width: o.lineW ?? 1 };
  s.addShape(shape, opts);
}

function s13() {
  const s = newSlide(13);
  frame(s, {
    n: 13,
    kicker: "YEAR 4  |  2029–2030",
    title: "M&Aを、個人技から組織能力へ。",
    marker: { seg: [1, 2] },
    notes:
      "YEAR 4のテーマは、M&Aを創業者の個人技から組織の能力に変えること。暫定グループ売上は18億円。親会社に経営企画・財務・M&A・人事・PMI・DX・法務・管理の8つの機能を置き、複数の案件が同時並行で進んでも、創業者本人が全てを処理しなくても回る状態を作る。",
  });
  yearStrip(s, 3, "M&A再現性構築");
  sectionHead(s, "親会社に置く機能（8）", "PARENT FUNCTIONS", X0, 2.85, 7);
  const ccx = 4.15;
  const ccy = 4.78;
  const r = 0.85;
  const left = ["経営企画", "財務", "M&A", "人事"];
  const right = ["PMI", "DX", "法務", "管理"];
  const rowsY = [3.3, 4.05, 4.8, 5.55];
  rowsY.forEach((y, i) => {
    const cy = y + 0.275;
    // 円の縁まで線を引く
    const ang = Math.atan2(cy - ccy, 2.5 - ccx);
    line(s, 2.5, cy, ccx + r * Math.cos(ang), ccy + r * Math.sin(ang), { color: C.SILVER, width: 1 });
    const ang2 = Math.atan2(cy - ccy, 5.8 - ccx);
    line(s, 5.8, cy, ccx + r * Math.cos(ang2), ccy + r * Math.sin(ang2), { color: C.SILVER, width: 1 });
    tx(s, left[i], { x: 0.6, y, w: 1.9, h: 0.55, font: F.JPB, bold: true, size: 14, color: C.NAVY, align: "center", valign: "middle", fill: C.TINT });
    tx(s, right[i], { x: 5.8, y, w: 1.9, h: 0.55, font: F.JPB, bold: true, size: 14, color: C.NAVY, align: "center", valign: "middle", fill: C.TINT });
  });
  s.addShape(pres.ShapeType.ellipse, { x: ccx - r, y: ccy - r, w: 2 * r, h: 2 * r, fill: { color: C.NAVY } });
  tx(s, "PARENT\nCOMPANY", { x: ccx - r, y: ccy - 0.5, w: 2 * r, h: 0.42, font: F.EN, size: 10, bold: true, cs: 1, ls: 14, color: C.GOLD, align: "center" });
  tx(s, "親会社機能", { x: ccx - r, y: ccy - 0.02, w: 2 * r, h: 0.36, font: F.JPB, bold: true, size: 15, color: C.WHITE, align: "center", valign: "middle" });

  rect(s, { x: 8.0, y: 2.85, w: 4.73, h: 3.65, fill: C.TINT });
  tx(s, "目指す状態", { x: 8.3, y: 3.03, w: 4, h: 0.3, font: F.JPB, bold: true, size: 13, color: C.GOLD_D, valign: "middle" });
  tx(s, "複数案件が同時並行で進み、\n創業者本人が全てを\n処理しなくても回る状態。", { x: 8.3, y: 3.45, w: 4.25, h: 1.35, font: F.MIN, size: 19, ls: 31, color: C.NAVY });
  tx(s, "個人技", { x: 8.3, y: 5.2, w: 1.6, h: 0.44, font: F.JPB, bold: true, size: 14, color: C.MUTED, align: "center", valign: "middle", fill: C.WHITE, line: C.RULE_D, lineW: 1 });
  line(s, 9.98, 5.42, 10.52, 5.42, { color: C.GOLD_L, width: 1.5, arrowEnd: true });
  tx(s, "組織能力", { x: 10.6, y: 5.2, w: 1.8, h: 0.44, font: F.JPB, bold: true, size: 14, color: C.WHITE, align: "center", valign: "middle", fill: C.NAVY });
  tx(s, "創業者が処理", { x: 8.2, y: 5.72, w: 1.8, h: 0.26, size: 11, color: C.MUTED, align: "center", valign: "middle" });
  tx(s, "親会社機能が処理", { x: 10.4, y: 5.72, w: 2.2, h: 0.26, size: 11, color: C.MUTED, align: "center", valign: "middle" });
}

function s14() {
  const s = newSlide(14);
  frame(s, {
    n: 14,
    kicker: "YEAR 5  |  2030–2031",
    title: "30億を作るのではない。30億を運営できるグループを作る。",
    marker: { from: 2, to: 2 },
    notes:
      "YEAR 5のテーマは、30億円を作ることではなく、30億円を運営できるグループを作ること。連結売上30億円（暫定）に加えて、複数事業・複数経営者・親会社機能・子会社の自走・継続的なM&A・新規事業・管理会計・資本配分・次の50億円への投資余力の9つがそろって、第一期の完成とする。",
  });
  yearStrip(s, 4, "連結30億・グループ経営基盤完成");
  sectionHead(s, "成功条件（9）", "SUCCESS CONDITIONS", X0, 2.85, 7.5);
  const conds = ["複数事業", "複数経営者", "親会社機能", "子会社自走", "継続M&A", "新規事業", "管理会計", "資本配分", "次の50億への\n投資余力"];
  conds.forEach((t, i) => {
    const c = i % 3;
    const r = Math.floor(i / 3);
    const x = 0.6 + c * 2.55;
    const y = 3.3 + r * 1.05;
    rect(s, { x, y, w: 2.4, h: 0.9, fill: C.TINT });
    tx(s, String(i + 1).padStart(2, "0"), { x: x + 0.18, y, w: 0.45, h: 0.9, font: F.NUM, size: 13, bold: true, color: C.GOLD_D, valign: "middle" });
    tx(s, t, { x: x + 0.62, y: y + (t.includes("\n") ? 0.16 : 0), w: 1.7, h: t.includes("\n") ? 0.6 : 0.9, font: F.JPB, bold: true, size: 15, ls: t.includes("\n") ? 21 : undefined, color: C.NAVY, valign: t.includes("\n") ? "top" : "middle" });
  });
  rect(s, { x: 8.5, y: 2.85, w: 4.23, h: 3.65, fill: C.NAVY });
  tx(s, "FY2031", { x: 8.8, y: 3.02, w: 3.6, h: 0.28, font: F.EN, size: 12, bold: true, cs: 2, color: C.GOLD, valign: "middle" });
  tx(s, "グループ連結売上", { x: 8.8, y: 3.32, w: 3.6, h: 0.3, size: 13, color: C.SILVER_L, valign: "middle" });
  tx(
    s,
    [
      { text: "30", o: { font: F.NUM, size: 80, bold: true } },
      { text: "億円", o: { font: F.JPB, size: 24, bold: true } },
    ],
    { x: 8.8, y: 3.55, w: 3.7, h: 1.42, color: C.WHITE, valign: "middle" },
  );
  tx(s, "暫定経営目標", { x: 8.8, y: 4.98, w: 3.6, h: 0.26, size: 11, color: C.SILVER, valign: "middle" });
  line(s, 8.8, 5.38, 12.43, 5.38, { color: C.CHIP_DK, width: 0.75 });
  tx(s, "次のフェーズ：50億円 → 100億円", { x: 8.8, y: 5.52, w: 3.75, h: 0.3, font: F.JPB, bold: true, size: 13, color: C.GOLD, valign: "middle" });
  tx(s, "詳細 P.22", { x: 8.8, y: 5.88, w: 3.6, h: 0.24, size: 10, color: C.SILVER, valign: "middle" });
}

function s15() {
  const s = newSlide(15);
  frame(s, {
    n: 15,
    kicker: "GROUP STRUCTURE",
    title: "親会社が原則100%保有し、各子会社は別の社長が経営する。",
    marker: { from: 1, to: 2 },
    notes:
      "グループの資本構造。創業者が親会社の株式を100%持ち、親会社の代表取締役を務める。親会社は各子会社を原則100%保有する。各子会社には別の代表取締役社長を置き、創業者は代表権を持たず、日常経営も行わない。原則として子会社の取締役にも入らず、必要に応じて会長として経営監督と社長支援を行う。A〜D社は構造を示す例示で、社数・業種の目標ではない。",
  });
  const cx = 4.25;
  tx(s, "創業者", { x: 3.35, y: 1.9, w: 1.8, h: 0.36, font: F.JPB, bold: true, size: 15, color: C.NAVY, align: "center", valign: "middle" });
  rect(s, { x: 3.35, y: 1.9, w: 1.8, h: 0.66, line: C.NAVY, lineW: 1.25 });
  tx(s, "親会社100%株主", { x: 3.35, y: 2.24, w: 1.8, h: 0.26, size: 10.5, color: C.MUTED, align: "center", valign: "middle" });
  line(s, cx, 2.56, cx, 3.05, { color: C.NAVY, width: 1.25 });
  tx(s, "100%", { x: cx + 0.12, y: 2.68, w: 0.8, h: 0.26, font: F.EN, size: 12, bold: true, color: C.GOLD_D, valign: "middle" });
  rect(s, { x: 2.65, y: 3.05, w: 3.2, h: 0.95, fill: C.NAVY });
  tx(s, "PARENT COMPANY", { x: 2.65, y: 3.12, w: 3.2, h: 0.24, font: F.EN, size: 10, bold: true, cs: 2, color: C.GOLD, align: "center", valign: "middle" });
  tx(s, "親会社", { x: 2.65, y: 3.36, w: 3.2, h: 0.38, font: F.JPB, bold: true, size: 18, color: C.WHITE, align: "center", valign: "middle" });
  tx(s, "代表取締役：創業者", { x: 2.65, y: 3.72, w: 3.2, h: 0.24, size: 11, color: C.SILVER_L, align: "center", valign: "middle" });
  line(s, cx, 4.0, cx, 4.35, { color: C.NAVY, width: 1.25 });
  const subX = (k) => 0.6 + k * 1.49;
  line(s, subX(0) + 0.67, 4.35, subX(4) + 0.67, 4.35, { color: C.NAVY, width: 1.25 });
  const names = ["A社", "B社", "C社", "D社"];
  for (let k = 0; k < 5; k++) {
    const x = subX(k);
    const c = x + 0.67;
    line(s, c, 4.35, c, 4.8, { color: C.NAVY, width: 1 });
    tx(s, "100%", { x: c + 0.06, y: 4.44, w: 0.62, h: 0.24, font: F.EN, size: 10.5, bold: true, color: C.GOLD_D, valign: "middle" });
    if (k === 0) {
      tx(s, "株式会社\nROOTIVE", { x, y: 4.8, w: 1.34, h: 0.95, font: F.JPB, bold: true, size: 13, ls: 19, color: C.NAVY, align: "center", valign: "middle", line: C.NAVY, lineW: 1.5 });
    } else {
      rect(s, { x, y: 4.8, w: 1.34, h: 0.95, line: C.SILVER, lineW: 1, dash: "dash" });
      tx(s, names[k - 1], { x, y: 4.95, w: 1.34, h: 0.36, font: F.JPB, bold: true, size: 15, color: C.NAVY, align: "center", valign: "middle" });
      tx(s, "例示", { x, y: 5.33, w: 1.34, h: 0.24, size: 10, color: C.MUTED, align: "center", valign: "middle" });
    }
  }
  VISUALS.add("org-chart");
  tx(s, "※ A社〜D社は構造を示す例示であり、社数・業種・時期の目標ではない。", { x: X0, y: 6.05, w: 7.3, h: 0.26, size: 10, color: C.MUTED, valign: "middle" });

  rect(s, { x: 8.3, y: 1.9, w: 4.43, h: 1.75, fill: C.TINT });
  tx(s, "CAPITAL", { x: 8.55, y: 2.02, w: 2, h: 0.24, font: F.EN, size: 10, bold: true, cs: 2, color: C.GOLD_D, valign: "middle" });
  tx(s, "資本の基本", { x: 8.55, y: 2.26, w: 3.5, h: 0.34, font: F.JPB, bold: true, size: 15, color: C.NAVY, valign: "middle" });
  items(s, ["親会社が各子会社を原則100%保有", "創業者は親会社の100%株主", "創業者は親会社の代表取締役"], { x: 8.55, y: 2.68, w: 4.0, size: 13, gap: 0.03, dot: 0.06 });
  rect(s, { x: 8.3, y: 3.85, w: 4.43, h: 2.65, fill: C.TINT });
  tx(s, "SUBSIDIARIES", { x: 8.55, y: 3.97, w: 2.5, h: 0.24, font: F.EN, size: 10, bold: true, cs: 2, color: C.GOLD_D, valign: "middle" });
  tx(s, "各子会社の原則", { x: 8.55, y: 4.21, w: 3.5, h: 0.34, font: F.JPB, bold: true, size: 15, color: C.NAVY, valign: "middle" });
  items(
    s,
    ["別の代表取締役社長を配置", "創業者は代表権を持たない", "日常経営を行わない", "原則として子会社取締役には入らない", "必要に応じて会長として\n経営監督・社長支援"],
    { x: 8.55, y: 4.63, w: 4.0, size: 13, gap: 0.03, dot: 0.06 },
  );
}

function s16() {
  const s = newSlide(16);
  frame(s, {
    n: 16,
    theme: "dark",
    kicker: "OWNERSHIP × EXECUTION",
    title: "所有と執行を分ける。",
    lead: "資本を持つ親会社と、日常を経営する子会社社長の役割を明確に分ける。",
    marker: { from: 1, to: 2 },
    notes:
      "所有と執行を分ける。親会社が持つのは、資本・社長人事・M&A・大型投資・戦略・財務・撤退判断。子会社の社長が持つのは、売上・利益・顧客・人材・現場・日常経営。オーナーはオペレーターではない（OWNER ≠ OPERATOR）。これがグループを創業者一人に依存させないための原則である。",
  });
  const col = (x, en, jp, list) => {
    rect(s, { x, y: 2.05, w: 4.6, h: 4.45, fill: C.CARD_DK });
    tx(s, en, { x: x + 0.3, y: 2.22, w: 4, h: 0.3, font: F.EN, size: 14, bold: true, cs: 2, color: C.GOLD, valign: "middle" });
    tx(s, jp, { x: x + 0.3, y: 2.55, w: 4, h: 0.42, font: F.JPB, bold: true, size: 20, color: C.WHITE, valign: "middle" });
    list.forEach((t, i) => {
      const y = 3.15 + i * 0.46;
      tx(s, t, { x: x + 0.3, y, w: 4, h: 0.44, size: 17, color: C.WHITE, valign: "middle" });
      if (i < list.length - 1) line(s, x + 0.3, y + 0.45, x + 4.3, y + 0.45, { color: C.LINE_DK, width: 0.75 });
    });
  };
  col(0.6, "PARENT COMPANY", "親会社｜所有", ["資本", "社長人事", "M&A", "大型投資", "戦略", "財務", "撤退判断"]);
  col(8.13, "SUBSIDIARY CEO", "子会社社長｜執行", ["売上", "利益", "顧客", "人材", "現場", "日常経営"]);
  tx(s, "OWNER", { x: 5.3, y: 2.95, w: 2.73, h: 0.5, font: F.NUM, size: 26, bold: true, color: C.WHITE, align: "center", valign: "middle" });
  tx(s, "所有", { x: 5.3, y: 3.45, w: 2.73, h: 0.28, size: 12, color: C.SILVER, align: "center", valign: "middle" });
  tx(s, "≠", { x: 5.3, y: 3.78, w: 2.73, h: 0.96, font: F.JPB, size: 54, bold: true, color: C.GOLD, align: "center", valign: "middle" });
  tx(s, "OPERATOR", { x: 5.3, y: 4.78, w: 2.73, h: 0.5, font: F.NUM, size: 26, bold: true, color: C.WHITE, align: "center", valign: "middle" });
  tx(s, "執行", { x: 5.3, y: 5.28, w: 2.73, h: 0.28, size: 12, color: C.SILVER, align: "center", valign: "middle" });
}

function s17() {
  const s = newSlide(17);
  frame(s, {
    n: 17,
    kicker: "CAPITAL ALLOCATION",
    title: "親会社の最大の仕事は、資本配分である。",
    lead: "利益として生まれたキャッシュを、どこへどう配分すれば企業価値が最大になるかを判断する。",
    marker: { from: 1, to: 2 },
    notes:
      "親会社の最大の仕事は資本配分。事業が利益として生んだキャッシュを、既存事業・M&A・新規事業・人材・DX・借入返済・現預金のどこへどれだけ配分すれば企業価値が最大になるかを判断する。配分の比率や金額は、財務モデルを作ってから決める。",
  });
  rect(s, { x: 0.6, y: 3.5, w: 2.0, h: 1.5, fill: C.TINT });
  tx(s, "CASH", { x: 0.8, y: 3.64, w: 1.7, h: 0.42, font: F.EN, size: 20, bold: true, cs: 1, color: C.NAVY, valign: "middle" });
  tx(s, "利益として\n生まれたキャッシュ", { x: 0.8, y: 4.15, w: 1.75, h: 0.6, size: 12, ls: 18, color: C.INK });
  line(s, 2.65, 4.25, 3.05, 4.25, { color: C.GOLD_L, width: 2, arrowEnd: true });
  rect(s, { x: 3.1, y: 3.0, w: 2.5, h: 2.5, fill: C.NAVY });
  tx(s, "CAPITAL\nALLOCATION", { x: 3.1, y: 3.25, w: 2.5, h: 0.52, font: F.EN, size: 13, bold: true, cs: 1, ls: 18, color: C.GOLD, align: "center" });
  tx(s, "資本配分", { x: 3.1, y: 3.88, w: 2.5, h: 0.6, font: F.MIN, size: 28, color: C.WHITE, align: "center", valign: "middle" });
  tx(s, "親会社の最大の仕事", { x: 3.1, y: 4.62, w: 2.5, h: 0.26, size: 11, color: C.SILVER_L, align: "center", valign: "middle" });
  const dest = [
    ["ORGANIC GROWTH", "既存事業"],
    ["M&A", "企業買収"],
    ["NEW BUSINESS", "新規事業"],
    ["PEOPLE", "人材"],
    ["TECH", "DX"],
    ["BALANCE SHEET", "借入返済・現預金"],
  ];
  const cys = dest.map((_, i) => 2.2 + i * 0.72 + 0.28);
  line(s, 5.6, 4.25, 5.95, 4.25, { color: C.NAVY, width: 1.25 });
  line(s, 5.95, cys[0], 5.95, cys[5], { color: C.NAVY, width: 1.25 });
  dest.forEach(([en, jp], i) => {
    const y = 2.2 + i * 0.72;
    line(s, 5.95, cys[i], 6.28, cys[i], { color: C.NAVY, width: 1.25, arrowEnd: true });
    rect(s, { x: 6.3, y, w: 3.85, h: 0.56, fill: C.WHITE, line: C.RULE_D, lineW: 1 });
    tx(s, en, { x: 6.48, y, w: 1.75, h: 0.56, font: F.EN, size: 11, bold: true, color: C.GOLD_D, valign: "middle" });
    tx(s, jp, { x: 8.28, y, w: 1.8, h: 0.56, font: F.JPB, bold: true, size: 14, color: C.NAVY, valign: "middle" });
    line(s, 10.15, cys[i], 10.35, cys[i], { color: C.NAVY, width: 1.25 });
  });
  line(s, 10.35, cys[0], 10.35, cys[5], { color: C.NAVY, width: 1.25 });
  line(s, 10.35, 4.25, 10.58, 4.25, { color: C.NAVY, width: 1.5, arrowEnd: true });
  rect(s, { x: 10.6, y: 3.4, w: 2.13, h: 1.7, fill: C.WHITE, line: C.GOLD_L, lineW: 1.75 });
  tx(s, "ENTERPRISE\nVALUE", { x: 10.6, y: 3.55, w: 2.13, h: 0.48, font: F.EN, size: 12, bold: true, cs: 1, ls: 16, color: C.GOLD_D, align: "center" });
  tx(s, "企業価値の\n最大化", { x: 10.6, y: 4.15, w: 2.13, h: 0.72, font: F.JPB, bold: true, size: 17, ls: 25, color: C.NAVY, align: "center" });
  VISUALS.add("capital-allocation");
  tx(s, "※ 配分の比率・金額は財務モデル策定後に確定する。", { x: X0, y: 5.9, w: 5, h: 0.26, size: 10, color: C.MUTED, valign: "middle" });
}

function s18() {
  const s = newSlide(18);
  frame(s, {
    n: 18,
    kicker: "M&A STRATEGY",
    title: "良い会社を適正価格で買い、長期保有し、企業価値を高める。",
    marker: { from: 1, to: 2 },
    notes:
      "M&Aの基本思想は、良い会社を適正価格で買い、長期保有し、経営改善によって企業価値を高めること。対象は物流企業に限定しない。候補の条件は11項目で、事業が続くこと（需要・継続収益・キャッシュ創出力・顧客基盤・過度な設備投資が要らないこと）、改善の余地（営業・採用・DX）、承継と移植（後継者不足・経営者交代が可能・ROOTIVE GROUPの経営能力を移植できること）に分けて見る。",
  });
  rect(s, { x: 0.6, y: 1.9, w: 4.2, h: 4.6, fill: C.NAVY });
  tx(s, "PHILOSOPHY", { x: 0.9, y: 2.08, w: 3, h: 0.26, font: F.EN, size: 11, bold: true, cs: 2, color: C.GOLD, valign: "middle" });
  tx(s, "基本思想", { x: 0.9, y: 2.38, w: 3.5, h: 0.36, font: F.JPB, bold: true, size: 16, color: C.WHITE, valign: "middle" });
  tx(s, "良い会社を、\n適正価格で買い、\n長期保有し、\n経営改善によって\n企業価値を高める。", { x: 0.9, y: 2.95, w: 3.7, h: 2.45, font: F.MIN, size: 20, ls: 34, color: C.WHITE });
  tx(s, "物流企業だけに限定しない。", { x: 0.9, y: 5.72, w: 3.7, h: 0.36, font: F.JPB, bold: true, size: 15, color: C.GOLD, valign: "middle" });
  sectionHead(s, "候補企業の条件（11）", "CRITERIA", 5.15, 1.9, 7.5);
  const groups = [
    { en: "SUSTAINABILITY", jp: "事業の持続性", list: ["需要が消えにくい", "継続収益", "キャッシュ創出力", "顧客基盤", "過度なCAPEX不要"] },
    { en: "UPSIDE", jp: "改善の余地", list: ["営業改善余地", "採用改善余地", "DX余地"] },
    { en: "TRANSFERABILITY", jp: "承継と移植", list: ["後継者不足", "経営者交代可能", { t: "ROOTIVE GROUPの\n経営能力を\n移植できる", bold: true, color: C.NAVY, font: F.JPB }] },
  ];
  groups.forEach((g, i) => {
    const x = 5.15 + i * 2.593;
    rect(s, { x, y: 2.35, w: 2.393, h: 4.15, fill: C.TINT });
    tx(s, g.en, { x: x + 0.2, y: 2.53, w: 2.05, h: 0.24, font: F.EN, size: 10, bold: true, cs: 1, color: C.GOLD_D, valign: "middle" });
    tx(s, g.jp, { x: x + 0.2, y: 2.8, w: 2.05, h: 0.34, font: F.JPB, bold: true, size: 15, color: C.NAVY, valign: "middle" });
    items(s, g.list, { x: x + 0.2, y: 3.4, w: 2.1, size: 13.5, gap: 0.22, dot: 0.06 });
  });
}

function s19() {
  const s = newSlide(19);
  frame(s, {
    n: 19,
    kicker: "INVESTMENT DISCIPLINE",
    title: "買える会社と、買うべき会社は違う。",
    marker: { from: 1, to: 2 },
    notes:
      "買える会社と買うべき会社は違う。買収の判断では、収益力・キャッシュと財務・価値とリターン・依存リスクの12指標を確認する。あわせて、簿外債務・重大な法令違反・未払い残業・社会保険問題・顧客集中・オーナー依存・慢性的なCF赤字・重大訴訟・大型設備更新・重要人材の流出の10項目をRED FLAGSとして確認する。各指標の判断水準は財務モデル策定後に設定する。",
  });
  sectionHead(s, "確認指標（12）", "KEY METRICS", X0, 1.9, 6.5);
  const hy = 2.3;
  tx(s, "区分", { x: 0.75, y: hy, w: 1.4, h: 0.3, size: 11, color: C.MUTED, valign: "middle" });
  tx(s, "指標", { x: 2.3, y: hy, w: 2.7, h: 0.3, size: 11, color: C.MUTED, valign: "middle" });
  tx(s, "意味", { x: 5.2, y: hy, w: 2.2, h: 0.3, size: 11, color: C.MUTED, valign: "middle" });
  line(s, 0.6, 2.63, 7.5, 2.63, { color: C.NAVY, width: 1 });
  const groups = [
    { name: "収益力", rows: [["Revenue", "売上高"], ["Operating Profit", "営業利益"], ["EBITDA", "償却前営業利益"]] },
    { name: "キャッシュ・\n財務", rows: [["Operating Cash Flow", "営業キャッシュフロー"], ["Net Debt", "純有利子負債"], ["CAPEX", "設備投資"]] },
    { name: "価値・\nリターン", rows: [["Enterprise Value", "企業価値"], ["EV / EBITDA", "EV倍率"], ["ROIC", "投下資本利益率"], ["Payback Period", "投資回収期間"]] },
    { name: "依存リスク", rows: [["Customer Concentration", "顧客集中度"], ["Management Dependence", "経営者依存度"]] },
  ];
  let y = 2.68;
  const rh = 0.31;
  groups.forEach((g, gi) => {
    const gh = g.rows.length * rh;
    if (gi % 2 === 0) rect(s, { x: 0.6, y, w: 6.9, h: gh, fill: C.TINT });
    tx(s, g.name, { x: 0.75, y, w: 1.4, h: gh, font: F.JPB, bold: true, size: 12, ls: g.name.includes("\n") ? 16 : undefined, color: C.NAVY, valign: "middle" });
    g.rows.forEach(([en, jp], ri) => {
      const ry = y + ri * rh;
      tx(s, en, { x: 2.3, y: ry, w: 2.8, h: rh, font: F.EN, size: 12, bold: true, color: C.NAVY, valign: "middle" });
      tx(s, jp, { x: 5.2, y: ry, w: 2.25, h: rh, size: 12, color: C.INK, valign: "middle" });
      if (ri < g.rows.length - 1) line(s, 2.3, ry + rh, 7.5, ry + rh, { color: C.RULE, width: 0.5 });
    });
    y += gh;
    line(s, 0.6, y, 7.5, y, { color: C.RULE_D, width: 0.75 });
  });
  tx(s, "※ 判断水準は財務モデル策定後に設定する", { x: 4.3, y: 1.9, w: 3.2, h: 0.3, size: 10, color: C.MUTED, align: "right", valign: "middle" });

  rect(s, { x: 7.85, y: 1.9, w: 4.88, h: 4.6, fill: C.BLACK });
  tx(s, "RED FLAGS", { x: 8.15, y: 2.08, w: 2.5, h: 0.3, font: F.EN, size: 14, bold: true, cs: 3, color: C.RED, valign: "middle" });
  tx(s, "重大なリスクの兆候（10）", { x: 8.15, y: 2.42, w: 4.3, h: 0.36, font: F.JPB, bold: true, size: 15, color: C.WHITE, valign: "middle" });
  const flags = ["簿外債務", "重大な法令違反", "未払い残業", "社会保険問題", "顧客集中", "オーナー依存", "慢性的CF赤字", "重大訴訟", "大型設備更新", "重要人材流出"];
  flags.forEach((t, i) => {
    const c = Math.floor(i / 5);
    const r = i % 5;
    const x = c === 0 ? 8.1 : 10.35;
    const fy = 3.05 + r * 0.66;
    tx(s, String(i + 1).padStart(2, "0"), { x, y: fy, w: 0.42, h: 0.4, font: F.NUM, size: 13, bold: true, color: C.RED, valign: "middle" });
    tx(s, t, { x: x + 0.45, y: fy, w: 1.75, h: 0.4, size: 14, color: C.WHITE, valign: "middle" });
    if (r < 4) line(s, x, fy + 0.53, x + 2.1, fy + 0.53, { color: "2A2F38", width: 0.75 });
  });
}

function s20() {
  const s = newSlide(20);
  frame(s, {
    n: 20,
    kicker: "GROUP KPI DASHBOARD",
    title: "売上30億円だけを追わない。5つの視点で経営を測る。",
    marker: { from: 2, to: 2 },
    notes:
      "グループのKPIは売上だけでは見ない。成長・利益・キャッシュ・組織・M&Aの5つの視点で経営を測る。目標値が決まっているのは連結売上（FY2031 30億円・暫定）だけで、ほかのKPIの目標値・算定方法・見る頻度は財務モデルを作ってから確定する。",
  });
  const panels = [
    { en: "GROWTH", jp: "成長", list: ["連結売上", "成長率", "M&A寄与売上", "新規事業売上"] },
    { en: "PROFIT", jp: "利益", list: ["営業利益", "営業利益率", "EBITDA", "ROIC"] },
    { en: "CASH", jp: "キャッシュ", list: ["営業CF", "現預金", "Net Debt", "借入余力"] },
    { en: "ORGANIZATION", jp: "組織", list: ["子会社社長配置率", "幹部人数", "重要ポジション\n充足率", "創業者依存業務数"] },
    { en: "M&A", jp: "M&A", list: ["案件パイプライン", "DD案件数", "成約数", "PMI進捗", "買収後利益成長", "投資回収"] },
  ];
  panels.forEach((p, k) => {
    const x = 0.6 + k * 2.476;
    rect(s, { x, y: 1.9, w: 2.226, h: 4.2, fill: C.TINT });
    tx(s, p.en, { x: x + 0.2, y: 2.03, w: 1.9, h: 0.3, font: F.EN, size: 13, bold: true, cs: 1, color: C.NAVY, valign: "middle" });
    tx(s, p.jp, { x: x + 0.2, y: 2.33, w: 1.9, h: 0.28, size: 12, color: C.MUTED, valign: "middle" });
    p.list.forEach((t, i) => {
      const y = 2.78 + i * 0.55;
      const kgi = k === 0 && i === 0;
      rect(s, { x: x + 0.14, y, w: 1.946, h: 0.48, fill: C.WHITE, line: kgi ? C.GOLD_L : undefined, lineW: 1.25 });
      node(s, x + 0.32, y + 0.24, 0.08, { color: C.GOLD_L });
      const multi = t.includes("\n");
      tx(s, t, { x: x + 0.46, y: multi ? y + 0.03 : y, w: kgi ? 0.95 : 1.58, h: multi ? 0.42 : 0.48, font: F.JPB, bold: true, size: 12, ls: multi ? 15 : undefined, color: C.NAVY, valign: multi ? "top" : "middle" });
      if (kgi) tx(s, "30億円", { x: x + 1.3, y, w: 0.72, h: 0.48, font: F.JPB, bold: true, size: 12, color: C.GOLD_D, align: "right", valign: "middle" });
    });
  });
  VISUALS.add("kpi-dashboard");
  tx(s, "※ 連結売上の目標（FY2031 30億円）は暫定経営目標。その他のKPIの目標値・算定方法・モニタリング頻度は、財務モデル策定後に確定する。", {
    x: X0,
    y: 6.24,
    w: CW,
    h: 0.26,
    size: 10,
    color: C.MUTED,
    valign: "middle",
  });
}

function s21() {
  const s = newSlide(21);
  frame(s, {
    n: 21,
    kicker: "FOUNDER TRANSFORMATION",
    title: "創業者の役割を、5つの段階で変えていく。",
    marker: { from: 0, to: 3 },
    notes:
      "創業者の役割の変化。2026年は現場・営業・採用・資金・トラブル対応・経営のすべてを自分で担っている。2027年は組織づくりと幹部育成に移り、2028年に親会社のCEOとしてM&A・金融機関・経営者採用を担う。2029〜2031年はグループCEOとして資本配分・M&A・社長人事・グループ戦略に集中し、その先は上場企業グループのCEOになる。自分が事業を回すのではなく、経営者と資本を配置する。",
  });
  const cards = [
    { yr: "2026", en: "", jp: "ROOTIVE代表", list: ["現場", "営業", "採用", "資金", "トラブル", "経営"], fill: C.TINT },
    { yr: "2027", en: "", jp: "ROOTIVE代表", list: ["組織", "幹部育成", "営業", "財務", "経営"], fill: C.TINT },
    { yr: "2028", en: "PARENT COMPANY CEO", jp: "親会社CEO", list: ["M&A", "金融機関", "経営者採用"], fill: C.NAVY_MID, dark: true },
    { yr: "2029–2031", en: "GROUP CEO", jp: "グループCEO", list: ["CAPITAL ALLOCATION", "M&A", "CEO APPOINTMENT", "GROUP STRATEGY"], fill: C.NAVY, dark: true, latin: true },
    { yr: "FUTURE", en: "PUBLIC COMPANY\nGROUP CEO", jp: "上場企業グループCEO", list: [], fill: C.WHITE, future: true },
  ];
  const ys = cards.map((_, k) => 2.9 - 0.22 * k);
  const cxs = cards.map((_, k) => 0.6 + k * 2.476 + 1.113);
  // 線（カードの上のノードを結ぶ）
  for (let k = 0; k < 4; k++) {
    line(s, cxs[k], ys[k] - 0.2, cxs[k + 1], ys[k + 1] - 0.2, { color: k < 3 ? C.GOLD_L : C.SILVER, width: 1.5, dash: k < 3 ? undefined : "sysDash" });
  }
  cards.forEach((c, k) => {
    const x = 0.6 + k * 2.476;
    const y = ys[k];
    if (c.future) rect(s, { x, y, w: 2.226, h: 2.75, fill: C.WHITE, line: C.SILVER, lineW: 1, dash: "dash" });
    else rect(s, { x, y, w: 2.226, h: 2.75, fill: c.fill });
    if (c.future) node(s, cxs[k], y - 0.2, 0.22, { ring: true, color: C.GOLD_L, lineW: 1.5, dot: 0.08 });
    else node(s, cxs[k], y - 0.2, 0.16, { color: C.GOLD_L });
    const txt = c.dark ? C.WHITE : C.NAVY;
    tx(s, c.yr, { x: x + 0.2, y: y + 0.14, w: 1.9, h: 0.4, font: F.NUM, size: c.future ? 18 : 20, bold: true, color: c.future ? C.GOLD_D : txt, valign: "middle" });
    let iy = y + 0.6;
    if (c.en) {
      const n = c.en.split("\n").length;
      tx(s, c.en, { x: x + 0.2, y: iy, w: 1.9, h: 0.22 * n + 0.02, font: F.EN, size: 10, bold: true, ls: n > 1 ? 13 : undefined, color: c.dark ? C.GOLD : C.GOLD_D, valign: n > 1 ? "top" : "middle" });
      iy += 0.22 * n + 0.06;
    }
    const jpLines = c.jp.length > 9 ? "上場企業グループ\nCEO" : c.jp;
    const jn = jpLines.split("\n").length;
    tx(s, jpLines, { x: x + 0.2, y: iy, w: 1.9, h: jn > 1 ? 0.52 : 0.3, font: F.JPB, bold: true, size: 12, ls: jn > 1 ? 18 : undefined, color: txt, valign: jn > 1 ? "top" : "middle" });
    iy += jn > 1 ? 0.62 : 0.4;
    if (c.list.length) {
      items(s, c.list, { x: x + 0.2, y: iy, w: 1.95, size: c.latin ? 10.5 : 12, font: c.latin ? F.EN : F.JP, color: c.dark ? C.SILVER_L : C.INK, dotColor: c.dark ? C.GOLD : C.GOLD_L, gap: 0.0, dot: 0.06, indent: 0.17 });
    }
  });
  VISUALS.add("founder-roles");
  tx(
    s,
    [
      { text: "「自分が事業を回す」から、", o: { color: C.GOLD_D } },
      { text: "「経営者と資本を配置する」へ。", o: { color: C.NAVY } },
    ],
    { x: X0, y: 5.85, w: CW, h: 0.6, font: F.MIN, size: 26, valign: "middle" },
  );
}

function s22() {
  const s = newSlide(22);
  frame(s, {
    n: 22,
    theme: "dark",
    kicker: "BEYOND 2031",
    title: "2031年以降は、成長と経営体制の整備を同時に進める。",
    marker: { from: 2, to: 3 },
    notes:
      "2031年以降の考え方。PHASE 1（2026–2031）でグループを形成し連結売上30億円を作る。PHASE 2で50億、100億へ複数事業を成長させる。同時に、連結会計・監査・内部統制・コンプライアンス・法務・取締役会・ガバナンス・経営陣の強化・IR・資本政策を整備し、IPO READYの状態を作ってから上場する。売上規模だけでは上場しない。上場できる経営体制を先に作る。",
  });
  const py = 1.9;
  const ph = 1.35;
  rect(s, { x: 0.6, y: py, w: 3.1, h: ph, fill: C.CARD_DK, line: C.GOLD, lineW: 1 });
  tx(s, "PHASE 1", { x: 0.85, y: 2.02, w: 1.4, h: 0.26, font: F.EN, size: 11, bold: true, cs: 2, color: C.GOLD, valign: "middle" });
  tx(s, "2026–2031", { x: 2.2, y: 2.02, w: 1.3, h: 0.26, font: F.EN, size: 11, color: C.SILVER, align: "right", valign: "middle" });
  tx(s, "グループ形成", { x: 0.85, y: 2.35, w: 2.7, h: 0.4, font: F.JPB, bold: true, size: 18, color: C.WHITE, valign: "middle" });
  tx(s, "連結売上30億円（暫定）", { x: 0.85, y: 2.8, w: 2.7, h: 0.28, size: 12, color: C.SILVER_L, valign: "middle" });
  line(s, 3.75, py + ph / 2, 4.05, py + ph / 2, { color: C.GOLD, width: 1.5, arrowEnd: true });
  rect(s, { x: 4.1, y: py, w: 3.9, h: ph, fill: C.CARD_DK, line: C.SILVER, lineW: 1 });
  tx(s, "PHASE 2", { x: 4.35, y: 2.02, w: 1.4, h: 0.26, font: F.EN, size: 11, bold: true, cs: 2, color: C.GOLD, valign: "middle" });
  tx(s, "複数事業の成長", { x: 4.35, y: 2.35, w: 3.4, h: 0.4, font: F.JPB, bold: true, size: 18, color: C.WHITE, valign: "middle" });
  tx(s, "50億円 → 100億円", { x: 4.35, y: 2.8, w: 3.4, h: 0.28, size: 13, color: C.SILVER_L, valign: "middle" });
  line(s, 8.05, py + ph / 2, 8.35, py + ph / 2, { color: C.GOLD, width: 1.5, arrowEnd: true });
  rect(s, { x: 8.4, y: py, w: 2.0, h: ph, fill: C.CARD_DK, line: C.SILVER, lineW: 1, dash: "dash" });
  tx(s, "IPO READY", { x: 8.6, y: 2.02, w: 1.7, h: 0.26, font: F.EN, size: 12, bold: true, color: C.GOLD, valign: "middle" });
  tx(s, "上場できる\n経営体制", { x: 8.6, y: 2.4, w: 1.7, h: 0.62, font: F.JPB, bold: true, size: 14, ls: 21, color: C.WHITE });
  line(s, 10.45, py + ph / 2, 10.75, py + ph / 2, { color: C.GOLD, width: 1.5, arrowEnd: true });
  rect(s, { x: 10.8, y: py, w: 1.93, h: ph, fill: C.CARD_DK, line: C.GOLD, lineW: 1.75 });
  tx(s, "IPO", { x: 10.8, y: 2.05, w: 1.93, h: 0.6, font: F.NUM, size: 30, bold: true, color: C.GOLD, align: "center", valign: "middle" });
  tx(s, "グループ上場", { x: 10.8, y: 2.72, w: 1.93, h: 0.3, font: F.JPB, bold: true, size: 13, color: C.WHITE, align: "center", valign: "middle" });

  tx(s, "GOVERNANCE", { x: X0, y: 3.62, w: 3, h: 0.26, font: F.EN, size: 11, bold: true, cs: 2, color: C.GOLD, valign: "middle" });
  tx(s, "上場できる\n経営体制の整備", { x: X0, y: 3.92, w: 3.2, h: 0.75, font: F.JPB, bold: true, size: 17, ls: 25, color: C.WHITE });
  tx(s, "PHASE 2と同時に整備する10項目", { x: X0, y: 4.7, w: 3.3, h: 0.26, size: 11, color: C.SILVER, valign: "middle" });
  const gov = ["連結会計", "監査", "内部統制", "コンプライアンス", "法務", "取締役会", "ガバナンス", "経営陣強化", "IR", "資本政策"];
  gov.forEach((t, i) => {
    const c = i % 5;
    const r = Math.floor(i / 5);
    tx(s, t, { x: 4.1 + c * 1.7525, y: 3.65 + r * 0.62, w: 1.62, h: 0.48, size: 13, color: C.WHITE, align: "center", valign: "middle", fill: C.CARD_DK, line: C.CHIP_DK, lineW: 0.75 });
  });
  tx(
    s,
    [
      { text: "売上規模だけでは上場しない。", o: { color: C.SILVER_L, br: true } },
      { text: "上場できる経営体制を先に作る。", o: { color: C.GOLD } },
    ],
    { x: X0, y: 5.35, w: CW, h: 1.05, font: F.MIN, size: 24, ls: 38 },
  );
}

function s23() {
  const s = newSlide(23);
  frame(s, {
    n: 23,
    theme: "dark",
    kicker: "MANAGEMENT COMPASS",
    title: "迷ったら、ここへ戻る。",
    lead: "重要な経営判断をする際は、次の5つの問いで判断する。",
    notes:
      "重要な経営判断に迷ったら、この5つの問いに戻る。2031年のグループ30億円に近づくか。上場できる企業グループに近づくか。金・人・仕組み・信用のどれかが積み上がるか。創業者依存を減らすか、増やすか。5年後、10年後にも残る経営資産になるか。右の番号は、判断の根拠になるページ。",
  });
  const qs = [
    ["2031年グループ30億に近づくか。", "関連 P.06–08"],
    ["上場できる企業グループに近づくか。", "関連 P.03・22"],
    ["金・人・仕組み・信用のどれかが積み上がるか。", "関連 P.04・09"],
    ["創業者依存を減らすか、増やすか。", "関連 P.15–16・21"],
    ["5年後、10年後にも残る経営資産になるか。", "関連 P.02・05"],
  ];
  const y0 = 2.05;
  const step = 0.62;
  line(s, 0.8, y0 + 0.275, 0.8, y0 + 4 * step + 0.275, { color: C.GOLD, width: 1.25 });
  qs.forEach(([q, ref], k) => {
    const y = y0 + k * step;
    node(s, 0.8, y + 0.275, 0.14, { color: C.GOLD });
    tx(s, `0${k + 1}`, { x: 1.1, y, w: 0.7, h: 0.55, font: F.NUM, size: 22, bold: true, color: C.GOLD, valign: "middle" });
    tx(s, q, { x: 1.85, y, w: 8.4, h: 0.55, size: 19, color: C.WHITE, valign: "middle" });
    tx(s, ref, { x: 10.3, y, w: 2.43, h: 0.55, size: 11, color: C.SILVER, align: "right", valign: "middle" });
    if (k < 4) line(s, 1.1, y + 0.585, X1, y + 0.585, { color: C.LINE_DK, width: 0.75 });
  });
  tx(
    s,
    [
      { text: "ROOTIVEを大きくすることが目的ではない。", o: { size: 18, color: C.GOLD, br: true } },
      { text: "強い事業を生み、良い会社を買い、経営者を育て、永続する企業グループを作る。", o: { size: 21, color: C.WHITE } },
    ],
    { x: X0, y: 5.4, w: CW, h: 1.05, font: F.MIN, size: 21, ls: 34 },
  );
}

function s24() {
  const s = newSlide(24);
  frame(s, {
    n: 24,
    theme: "black",
    kicker: "AND AFTER ALL OF THAT",
    title: "その先に、個人として何を残すのか。",
    titleFont: F.MIN,
    titleSize: 28,
    notes:
      "最後の1ページだけ、創業者個人の思い。会社を大きくすること、30億円、企業グループ、上場は、その時々で本気で追い続ける目標である。そのすべての先に、経験を一冊の本として残したい。成功だけでなく途中の現実を書き、読んだ誰かが挑戦するきっかけになるものにしたい。",
  });
  const para = (lines, last) =>
    lines.map((t, i) => ({ text: t, o: { br: !(last && i === lines.length - 1), paraAfter: i === lines.length - 1 ? 12 : undefined } }));
  const left = [
    ...para(["会社を大きくすることも、30億円を達成することも、", "企業グループを作ることも、上場することも、", "その時々では本気で追い続ける目標である。"]),
    ...para(["ただ、それらをすべて成し遂げた先で、", "最後に個人として残したいものがある。"]),
    ...para(["自分が何を考え、何に迷い、何に失敗し、", "どう決断し、どう前に進んだのか。"], true),
  ];
  const right = [
    ...para(["会社を始めた時から、企業を成長させ、", "人と出会い、失敗し、苦しみ、経営者として成長し、", "最終的に上場へ至るまでの経験を、", "いつか一冊の本として残したい。"]),
    ...para(["成功だけを書く本ではない。", "その途中にあった現実を残したい。"]),
    ...para(["そして、その本を読んだ誰かが、", "「自分も挑戦してみよう」「自分にもできるかもしれない」", "と思えるものにしたい。"], true),
  ];
  tx(s, left, { x: X0, y: 1.8, w: 5.8, h: 3.4, font: F.MIN, size: 14, ls: 24, color: C.SILVER_L });
  tx(s, right, { x: 6.93, y: 1.8, w: 5.8, h: 3.6, font: F.MIN, size: 14, ls: 24, color: C.SILVER_L });
  tx(s, "会社だけではなく、挑戦した証明を残す。", { x: X0, y: 5.55, w: CW, h: 0.62, font: F.MIN, size: 30, color: C.WHITE, valign: "middle" });
  line(s, X0, 6.47, 2.25, 6.47, { color: C.STEEL, width: 1, dash: "sysDash" });
  node(s, 2.35, 6.47, 0.13, { color: C.GOLD });
  tx(s, "WRITE THE STORY.", { x: 2.6, y: 6.33, w: 4, h: 0.28, font: F.NUM, size: 12, cs: 6, color: C.GOLD, valign: "middle" });
}

// ---------- 組み立て ----------
async function main() {
  pres = new pptxgen();
  pres.layout = "LAYOUT_WIDE";
  pres.author = "ROOTIVE GROUP";
  pres.company = "ROOTIVE GROUP";
  pres.title = "ROOTIVE GROUP 5カ年経営計画 2026–2031";
  pres.subject = "第一期中期経営計画";
  pres.theme = { headFontFace: F.JPB, bodyFontFace: F.JP };

  [s01, s02, s03, s04, s05, s06, s07, s08, s09, s10, s11, s12, s13, s14, s15, s16, s17, s18, s19, s20, s21, s22, s23, s24].forEach((f) => f());

  const required = ["revenue-line-chart", "longterm-roadmap", "year-timeline", "org-chart", "ma-process", "capital-allocation", "kpi-dashboard", "founder-roles"];
  for (const r of required) if (!VISUALS.has(r)) ISSUES.push(`[visual] 必須の図がない: ${r}`);

  // 東アジアの文字セットを日本語（Shift_JIS）に直す（pptxgenjs は簡体字の値を書く）
  const buf = await pres.write({ outputType: "nodebuffer" });
  const zip = await JSZip.loadAsync(buf);
  const names = Object.keys(zip.files).filter((n) => /^ppt\/(slides|notesSlides)\/.*\.xml$/.test(n));
  for (const n of names) {
    const xml = await zip.file(n).async("string");
    zip.file(n, xml.replaceAll('pitchFamily="34" charset="-122"', 'charset="-128"'));
  }
  // グラフの文字に東アジアのフォントも指定する（「億円」が代替フォントにならないように）
  const charts = Object.keys(zip.files).filter((n) => /^ppt\/charts\/chart\d+\.xml$/.test(n));
  for (const n of charts) {
    const xml = await zip.file(n).async("string");
    zip.file(n, xml.replace(/<a:latin typeface="([^"]+)"\/>(?!<a:ea)/g, '<a:latin typeface="$1"/><a:ea typeface="$1"/>'));
  }
  const out = await zip.generateAsync({ type: "nodebuffer", compression: "DEFLATE" });
  writeFileSync(OUT, out);

  if (ISSUES.length) {
    console.log(`点検で ${ISSUES.length} 件：`);
    for (const i of ISSUES) console.log("  " + i);
  } else {
    console.log("点検：問題なし");
  }
  console.log(`書き出し：${OUT}（${TOTAL} ページ）`);
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
