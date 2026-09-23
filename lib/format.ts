import { roundDisplay } from "./calc/money";

const jpNumber = new Intl.NumberFormat("ja-JP", { maximumFractionDigits: 0 });

/** 円表示：整数へ四捨五入（負数は 0 から遠い方向）、カンマ区切り、¥ 付き */
export function yen(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n)) return "¥0";
  const r = roundDisplay(n);
  return r < 0 ? `-¥${jpNumber.format(-r)}` : `¥${jpNumber.format(r)}`;
}

/**
 * 小さな場所に出す円（月の切り替えの表など）：1 万円以上は「256万」、1 億円以上は「1.2億」。
 * 正確な金額は画面の表で出す（ここは目安）
 */
export function yenCompact(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n)) return "¥0";
  const sign = n < 0 ? "-" : "";
  const a = Math.abs(n);
  if (a >= 100_000_000) return `${sign}${(Math.floor(a / 10_000_000) / 10).toFixed(1).replace(/\.0$/, "")}億`;
  if (a >= 10_000) return `${sign}${jpNumber.format(Math.floor(a / 10_000))}万`;
  return yen(n);
}

/** 円表示（¥ なし） */
export function yenPlain(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n)) return "0";
  const r = roundDisplay(n);
  return r < 0 ? `-${jpNumber.format(-r)}` : jpNumber.format(r);
}

/** 率を小数 1 桁 % で */
export function pct(rate: number | null | undefined, digits = 1): string {
  if (rate == null || !Number.isFinite(rate)) return "0.0%";
  return `${(rate * 100).toFixed(digits)}%`;
}

/** 数量表示：小数があれば最大 2 桁 */
export function qty(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n)) return "0";
  return new Intl.NumberFormat("ja-JP", { maximumFractionDigits: 2 }).format(n);
}

/** CSV 用の生の値：最大 4 桁、末尾の 0 を除去、カンマなし */
export function rawNumber(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n)) return "0";
  const s = (Math.round(n * 10_000) / 10_000).toFixed(4);
  return s.replace(/\.?0+$/, "");
}

/** 前月比の差分表示用 */
export function diffText(current: number, previous: number | null | undefined): string {
  if (previous == null) return "—";
  const d = current - previous;
  const sign = d > 0 ? "+" : "";
  return `${sign}${yenPlain(d)}`;
}

export function formatDateTimeJa(iso: string | null | undefined): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return new Intl.DateTimeFormat("ja-JP", {
    timeZone: "Asia/Tokyo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(d);
}

export function formatDateOnlyJa(iso: string | null | undefined): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return new Intl.DateTimeFormat("ja-JP", { timeZone: "Asia/Tokyo", year: "numeric", month: "2-digit", day: "2-digit" }).format(d);
}
