/**
 * 取り込み：Excel の控除の列に残っている数式（「=E5*0.1」「=ROUNDDOWN(E5*10%,0)」など）を読む（純関数。DB に触らない）。
 * 数式は「こう計算しているらしい」という手がかりにだけ使い、決めるのは値との照らし合わせ（deductions.ts）。
 * 読めるのは「ある列 × 数」「ある列 ÷ 数」と、それを端数の関数（ROUNDDOWN・ROUND・ROUNDUP・INT など）で包んだものだけ。
 */
import type { Rounding } from "@/lib/payroll/types";

export type FormulaGuess = {
  /** 掛ける数（=E5*0.1 → 0.1、=E5*10% → 0.1、=E5/10 → 0.1） */
  factor: number;
  /** 掛けている列（0 始まり） */
  col: number;
  /** 掛けている行（1 始まり。ふつうは数式と同じ行） */
  row: number;
  /** 端数の処理（ROUNDDOWN・INT → 切り捨て など。包んでいなければ null） */
  rounding: Rounding | null;
};

const ROUNDING_FN: Record<string, Rounding> = {
  ROUNDDOWN: "floor",
  INT: "floor",
  TRUNC: "floor",
  FLOOR: "floor",
  ROUND: "round",
  ROUNDUP: "ceil",
  CEILING: "ceil",
};

/** 列の文字（A・AB）を 0 始まりの番号に */
function colIndex(letters: string): number {
  let n = 0;
  for (const ch of letters) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n - 1;
}

/** いちばん外側のかっこを外す（「(E5*0.1)」→「E5*0.1」） */
function unwrap(t: string): string {
  let v = t;
  while (v.startsWith("(") && v.endsWith(")")) {
    let depth = 0;
    let wraps = true;
    for (let i = 0; i < v.length; i++) {
      if (v[i] === "(") depth++;
      else if (v[i] === ")") depth--;
      if (depth === 0 && i < v.length - 1) {
        wraps = false;
        break;
      }
    }
    if (!wraps) break;
    v = v.slice(1, -1);
  }
  return v;
}

/** 関数の中身を、いちばん外側のカンマで分ける */
function splitArgs(inner: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let start = 0;
  for (let i = 0; i < inner.length; i++) {
    if (inner[i] === "(") depth++;
    else if (inner[i] === ")") depth--;
    else if (inner[i] === "," && depth === 0) {
      out.push(inner.slice(start, i));
      start = i + 1;
    }
  }
  out.push(inner.slice(start));
  return out;
}

const NUM = String.raw`(\d+(?:\.\d+)?)`;
const REF = String.raw`([A-Z]{1,3})(\d+)`;

/** 控除の式として読めれば、掛ける数と列を返す（読めなければ null） */
export function parseDeductionFormula(formula: string): FormulaGuess | null {
  let t = formula.normalize("NFKC").trim().replace(/^=/, "").replace(/\$/g, "").replace(/\s+/g, "").toUpperCase();
  if (!t || t.length > 200) return null;
  t = unwrap(t).replace(/^-/, "");
  let rounding: Rounding | null = null;
  const fn = t.match(/^([A-Z]+)\((.*)\)$/);
  if (fn) {
    const mode = ROUNDING_FN[fn[1]];
    if (!mode) return null;
    const args = splitArgs(fn[2]);
    // 円未満の端数だけ（ROUND(x,0)・FLOOR(x,1)・INT(x)）。10 円単位などは、ルールで表せないので読まない
    const digits = args[1]?.trim();
    const ok =
      fn[1] === "INT" || fn[1] === "TRUNC"
        ? args.length === 1 || (args.length === 2 && digits === "0")
        : fn[1] === "FLOOR" || fn[1] === "CEILING"
          ? args.length === 2 && digits === "1"
          : args.length === 2 && digits === "0";
    if (!ok) return null;
    rounding = mode;
    t = unwrap(args[0]).replace(/^-/, "");
  }
  let m = t.match(new RegExp(`^${REF}\\*${NUM}(%?)$`));
  if (m) return guess(m[1], m[2], Number(m[3]) / (m[4] ? 100 : 1), rounding);
  m = t.match(new RegExp(`^${NUM}(%?)\\*${REF}$`));
  if (m) return guess(m[3], m[4], Number(m[1]) / (m[2] ? 100 : 1), rounding);
  m = t.match(new RegExp(`^${REF}/${NUM}$`));
  if (m && Number(m[3]) > 0) return guess(m[1], m[2], 1 / Number(m[3]), rounding);
  return null;
}

function guess(letters: string, row: string, factor: number, rounding: Rounding | null): FormulaGuess | null {
  if (!Number.isFinite(factor) || factor <= 0 || factor >= 1000) return null;
  return { factor: Math.round(factor * 1e6) / 1e6, col: colIndex(letters), row: Number(row), rounding };
}
