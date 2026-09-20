/** 書類の索引簿 CSV の URL（絞り込みの条件をそのままクエリに載せる） */
import type { RecordFilter } from "@/lib/records";

export function recordsCsvUrl(filter: RecordFilter = {}): string {
  const p = new URLSearchParams();
  if (filter.from) p.set("from", filter.from);
  if (filter.to) p.set("to", filter.to);
  if (filter.minAmount != null && Number.isFinite(filter.minAmount)) p.set("min", String(filter.minAmount));
  if (filter.maxAmount != null && Number.isFinite(filter.maxAmount)) p.set("max", String(filter.maxAmount));
  if (filter.q) p.set("q", filter.q);
  if (filter.kinds && filter.kinds.length > 0) p.set("kinds", filter.kinds.join(","));
  if (filter.missingFileOnly) p.set("missing", "1");
  const qs = p.toString();
  return `/api/export/records.csv${qs ? `?${qs}` : ""}`;
}
