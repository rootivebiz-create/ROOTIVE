/** 月の扱い。画面の URL は ?m=YYYY-MM、DB は月初日 YYYY-MM-01 */
export function monthFromParam(value: string | string[] | undefined, today = new Date()): string {
  const v = Array.isArray(value) ? value[0] : value;
  if (v && /^\d{4}-(0[1-9]|1[0-2])$/.test(v)) return `${v}-01`;
  // 既定は先月（月末の締めは、たいてい前の月の分）
  const d = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth() - 1, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-01`;
}

export function monthParam(month: string): string {
  return month.slice(0, 7);
}

export function shiftMonth(month: string, delta: number): string {
  const [y, m] = month.slice(0, 7).split("-").map(Number);
  const d = new Date(Date.UTC(y, m - 1 + delta, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-01`;
}

export function monthLabelJa(month: string): string {
  const [y, m] = month.slice(0, 7).split("-").map(Number);
  return `${y}年${m}月`;
}
