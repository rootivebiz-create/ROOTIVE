/**
 * 利益の画面と社長の 1 枚で使う言い方（純関数。サーバーでもブラウザでも使える）。
 * 円は lib の en（1,234円・マイナスは −）、率は pct（10.5%）を使う。
 */
import { en } from "@/lib/engine/types";
import { pct } from "@/lib/payroll/money";
import type { Change } from "~/server/features/profit/summary";

/** +12,000円 ／ −3,000円 ／ ±0円 */
export function signedYen(value: number): string {
  if (value === 0) return "±0円";
  return value > 0 ? `+${en(value)}` : en(value);
}

/** 利益率（売上が無ければ —） */
export function rateText(rate: number | null): string {
  return rate === null ? "—" : pct(rate);
}

/** 増えた割合：+3.2% ／ −1.5% ／ ±0%（割合が出せなければ null） */
export function ratioText(change: Change | null): string | null {
  if (!change || change.ratio === null) return null;
  const sign = change.ratio > 0 ? "+" : change.ratio < 0 ? "−" : "±";
  return `${sign}${pct(Math.abs(change.ratio))}`;
}

/** 前の月との差：「前月より +12,000円（+3.2%）」 */
export function changeText(change: Change | null): string {
  if (!change) return "前月の記録なし";
  const ratio = ratioText(change);
  return `前月より ${signedYen(change.diff)}${ratio ? `（${ratio}）` : ""}`;
}

/** 利益率の差：「前月より +1.2ポイント」 */
export function pointChangeText(change: Change | null): string {
  if (!change) return "前月の記録なし";
  const v = Math.round(change.diff * 1000) / 10;
  if (v === 0) return "前月と同じ";
  return `前月より ${v > 0 ? "+" : "−"}${Math.abs(v).toFixed(1)}ポイント`;
}

/** 前の月との差の向き（色分けに使う） */
export function changeTone(change: Change | null): "up" | "down" | "flat" | "none" {
  if (!change) return "none";
  return change.diff > 0 ? "up" : change.diff < 0 ? "down" : "flat";
}

/** 数量（小数は 2 桁まで） */
export function qtyText(value: number): string {
  return new Intl.NumberFormat("ja-JP", { maximumFractionDigits: 2 }).format(value);
}

/** 「10月」（推移のグラフの目盛り）。年が変わる月は「2027年1月」 */
export function shortMonthLabel(month: string, index: number): string {
  const [y, m] = month.slice(0, 7).split("-").map(Number);
  return index === 0 || m === 1 ? `${y}年${m}月` : `${m}月`;
}

const WEEKDAYS = ["日", "月", "火", "水", "木", "金", "土"];

/** 2026-11-25 → 2026年11月25日(水) */
export function dateWithWeekday(date: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  if (!m) return date;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  return `${y}年${mo}月${d}日(${WEEKDAYS[new Date(Date.UTC(y, mo - 1, d)).getUTCDay()]})`;
}

const jst = new Intl.DateTimeFormat("ja-JP", { timeZone: "Asia/Tokyo", year: "numeric", month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" });

/** 日時を日本時間で：2026/10/5 09:00 */
export function jstDateTime(value: Date): string {
  return jst.format(value);
}

/** 棒の長さ（最大の絶対値に対する割合。0〜1） */
export function barRatio(value: number, max: number): number {
  if (max <= 0) return 0;
  return Math.min(1, Math.abs(value) / max);
}
