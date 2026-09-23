import { parseAmount } from "./money";
import type { Driver, Project, WorkRow } from "./types";

/**
 * Excel やスプレッドシートからコピーした稼働表（タブ区切り）を読む。
 * 列は「ドライバー・案件・数量」の順。1 行目が見出しなら飛ばす。名前は空白の違いを無視して照合する。
 */
export type PasteResult = { rows: WorkRow[]; errors: { line: number; message: string }[] };

const norm = (s: string) => s.normalize("NFKC").replace(/\s+/g, "").toLowerCase();

export function parseWorkPaste(text: string, drivers: Driver[], projects: Project[]): PasteResult {
  const driverByName = new Map(drivers.map((d) => [norm(d.name), d]));
  const projectByName = new Map(projects.map((p) => [norm(p.name), p]));
  const rows: WorkRow[] = [];
  const errors: PasteResult["errors"] = [];
  const lines = text.replace(/\r\n?/g, "\n").split("\n");
  lines.forEach((raw, i) => {
    const line = i + 1;
    if (!raw.trim()) return;
    const cols = raw.includes("\t") ? raw.split("\t") : raw.split(",");
    if (cols.length < 3) {
      errors.push({ line, message: "「ドライバー・案件・数量」の 3 列が必要です" });
      return;
    }
    const [dName, pName, qtyText] = cols.map((c) => c.trim());
    const qty = parseAmount(qtyText);
    if (i === 0 && qty === null) return; // 見出し
    const d = driverByName.get(norm(dName));
    const p = projectByName.get(norm(pName));
    if (!d) errors.push({ line, message: `ドライバー「${dName}」が見つかりません` });
    if (!p) errors.push({ line, message: `案件「${pName}」が見つかりません` });
    if (qty === null || qty < 0) errors.push({ line, message: `数量「${qtyText}」が数字ではありません` });
    if (d && p && qty !== null && qty >= 0) rows.push({ driverId: d.id, projectId: p.id, qty });
  });
  return { rows, errors };
}
