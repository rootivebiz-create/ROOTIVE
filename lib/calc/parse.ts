/** 全角数字・カンマ・円記号・空白を含む入力を数値へ正規化する */
export function normalizeNumericString(raw: string): string {
  return raw
    .replace(/[０-９]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xfee0))
    .replace(/[．]/g, ".")
    .replace(/[－ー−‐]/g, "-")
    .replace(/[，,\s¥￥円]/g, "")
    .replace(/[％%]/g, "")
    .trim();
}

/** 数値入力を number へ。空・不正は null */
export function parseNumberInput(raw: string | number | null | undefined): number | null {
  if (raw == null) return null;
  if (typeof raw === "number") return Number.isFinite(raw) ? raw : null;
  const s = normalizeNumericString(raw);
  if (s === "" || s === "-" || s === ".") return null;
  if (!/^-?\d*(\.\d+)?$/.test(s)) return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

/** パーセント入力（"10", "12.5%", "１０％"）を率（0.1, 0.125）へ */
export function parsePercentInput(raw: string | number | null | undefined): number | null {
  const n = parseNumberInput(raw);
  if (n == null) return null;
  return Math.round(n * 100) / 10_000; // 小数 4 桁の率
}

/** 率（0.125）をパーセント表示用の数値（12.5）へ */
export function rateToPercent(rate: number): number {
  return Math.round(rate * 100_000) / 1_000;
}
