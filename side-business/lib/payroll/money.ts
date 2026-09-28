import type { Rounding } from "./types";

/** 浮動小数の誤差（0.1+0.2 など）を消してから円に丸める。負の数は 0 に向けて切り捨て・0 から離して切り上げ */
export function roundYen(value: number, mode: Rounding): number {
  const v = Math.round(value * 1e6) / 1e6;
  const sign = v < 0 ? -1 : 1;
  const abs = Math.abs(v);
  let out: number;
  if (mode === "floor") out = Math.floor(abs);
  else if (mode === "ceil") out = Math.ceil(abs);
  else out = Math.floor(abs + 0.5);
  return sign * out || 0;
}

export function sum(values: number[]): number {
  return values.reduce((a, b) => a + b, 0);
}

const yenFormat = new Intl.NumberFormat("ja-JP");

/** ¥1,234（マイナスは -¥1,234） */
export function yen(value: number): string {
  const v = Math.round(value);
  return `${v < 0 ? "-" : ""}¥${yenFormat.format(Math.abs(v))}`;
}

/** 0.105 → 10.5%（小数 1 桁。整数なら 10%） */
export function pct(rate: number): string {
  const v = Math.round(rate * 1000) / 10;
  return `${Number.isInteger(v) ? v.toFixed(0) : v.toFixed(1)}%`;
}

/** 全角数字・カンマ・円記号を許して数値にする。数値でなければ null */
export function parseAmount(input: string): number | null {
  const s = input
    .replace(/[０-９．－]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xfee0))
    .replace(/[,，¥￥円\s]/g, "")
    .replace(/[ー−]/g, "-");
  if (s === "" || !/^-?\d+(\.\d+)?$/.test(s)) return null;
  return Number(s);
}
