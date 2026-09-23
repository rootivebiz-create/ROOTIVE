/**
 * 「Excel に戻す」：月の稼働を、取り込んだときと同じ列の並び（読み方を逆にたどる）の表にする（純関数。DB に触らない）。
 * - 1 行 1 件の表（数量の列がある）：稼働の 1 行を 1 行に。ドライバー・案件・数量・日付・備考を元の見出しの位置に
 * - 人ごとに案件が横に並ぶ表：人ごとに 1 行、元の案件の見出しの列に数量
 * - 人ごとに日付が横に並ぶ表：人 × 案件ごとに 1 行、日付の列にその日の数量
 * 読み方が無ければ、ふつうの形（日付・ドライバー・案件・数量・単位・備考）にする。
 */
import { matchName, type Candidate } from "~/server/names";
import { dayColumnDates, dayOfHeader, isTotalHeader } from "./detect";
import { layoutOf, type ColumnRole } from "./types";

export type ExportLayout = {
  /** profile：取り込んだときの形／plain：ふつうの形 */
  source: "profile" | "plain";
  /** 元のファイルの名前（画面に「◯◯ の形で出します」と出す） */
  fileName: string | null;
  /** 元の見出し（左から順に） */
  labels: string[];
  roles: ColumnRole[];
  headerDepth: 1 | 2;
  fixedProjectId: string | null;
};

export type ExportEntry = { driverId: string; projectId: string; qty: number; workDate: string | null; note: string | null };
export type ExportDriver = Candidate & { kana?: string | null };
export type ExportProject = Candidate & { unit: string };

export type Cell = string | number | null;

export type ExportSheet = {
  /** 見出しの行（2 段の見出しなら 2 行） */
  header: Cell[][];
  rows: Cell[][];
  /** 合計の行（無ければ null） */
  total: Cell[] | null;
  /** 数量の列（書式を付けるため。0 始まり） */
  numberCols: number[];
  /** 日付の列（0 始まり） */
  dateCols: number[];
  /** 画面・ファイルに添える一言（元の形に入らなかった列を足した など） */
  notes: string[];
};

export const PLAIN_LABELS = ["日付", "ドライバー", "案件", "数量", "単位", "備考"];

function round4(n: number): number {
  return Math.round(n * 1e4) / 1e4;
}

function slashDate(d: string | null): string | null {
  return d ? d.replace(/-/g, "/") : null;
}

function sorter(drivers: Map<string, ExportDriver>, projects: Map<string, ExportProject>) {
  const dKey = (id: string) => drivers.get(id)?.kana || drivers.get(id)?.name || "";
  return (a: ExportEntry, b: ExportEntry) =>
    dKey(a.driverId).localeCompare(dKey(b.driverId), "ja") ||
    (a.workDate ?? "").localeCompare(b.workDate ?? "") ||
    (projects.get(a.projectId)?.name ?? "").localeCompare(projects.get(b.projectId)?.name ?? "", "ja");
}

/** ふつうの形：日付・ドライバー・案件・数量・単位・備考 */
export function plainSheet(entries: ExportEntry[], drivers: ExportDriver[], projects: ExportProject[]): ExportSheet {
  const d = new Map(drivers.map((x) => [x.id, x]));
  const p = new Map(projects.map((x) => [x.id, x]));
  const rows = [...entries]
    .sort(sorter(d, p))
    .map((e) => [slashDate(e.workDate), d.get(e.driverId)?.name ?? "", p.get(e.projectId)?.name ?? "", round4(e.qty), p.get(e.projectId)?.unit ?? "", e.note ?? null]);
  return { header: [PLAIN_LABELS], rows, total: null, numberCols: [3], dateCols: [0], notes: [] };
}

/** 「1」「1日」「10/1」「10月1日」の書き方をまねて、日付の見出しを作る */
function dayLabel(sample: string, date: string): string {
  const [, m, d] = date.split("-").map(Number);
  const v = sample.normalize("NFKC").trim();
  if (/^\d{1,2}\/\d{1,2}/.test(v)) return `${m}/${d}`;
  if (/^\d{1,2}月\d{1,2}日?/.test(v)) return `${m}月${d}日`;
  if (/^\d{1,2}日/.test(v)) return `${d}日`;
  return String(d);
}

function daysBetween(from: string, to: string): string[] {
  const out: string[] = [];
  const d = new Date(`${from}T00:00:00Z`);
  const end = new Date(`${to}T00:00:00Z`);
  while (d <= end && out.length < 62) {
    out.push(d.toISOString().slice(0, 10));
    d.setUTCDate(d.getUTCDate() + 1);
  }
  return out;
}

function monthEnd(month: string): string {
  const [y, m] = month.split("-").map(Number);
  return new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10);
}

/**
 * 日付の列を、書き出す月に合わせて作り直す（30 日の月の表でも、31 日の月は 31 日まで）。
 * 元の表が 21 日始まり（20 日締め）なら、前の月の 21 日から今月の 20 日まで。
 */
function dayColumns(labels: string[], dayCols: number[], month: string): { label: string; date: string }[] {
  const dates = dayColumnDates(
    dayCols.map((c) => ({ col: c, header: labels[c] ?? "" })),
    month,
  );
  const first = dayCols.map((c) => dates.get(c)).find((x): x is string => !!x);
  const sample = labels[dayCols[0]] ?? "1";
  const startDay = first ? Number(first.slice(8, 10)) : 1;
  let from = `${month.slice(0, 7)}-01`;
  let to = monthEnd(month);
  if (startDay > 1) {
    const [y, m] = month.split("-").map(Number);
    const prev = new Date(Date.UTC(y, m - 2, 1)).toISOString().slice(0, 7);
    const prevEnd = monthEnd(`${prev}-01`);
    from = `${prev}-${String(Math.min(startDay, Number(prevEnd.slice(8)))).padStart(2, "0")}`;
    to = `${month.slice(0, 7)}-${String(Math.min(startDay - 1, Number(to.slice(8)))).padStart(2, "0")}`;
  }
  return daysBetween(from, to).map((date) => ({ label: dayLabel(sample, date), date }));
}

/**
 * 取り込んだときの形で表を作る。形に入らないもの（案件の列が無い形での別の案件・日付の無い稼働 など）は、
 * 右に列を足して落とさない（足したことは notes に書く）。
 */
export function buildExportSheet(
  layout: ExportLayout,
  month: string,
  entries: ExportEntry[],
  drivers: ExportDriver[],
  projects: ExportProject[],
): ExportSheet {
  if (layout.source === "plain" || layout.labels.length === 0) return plainSheet(entries, drivers, projects);
  const d = new Map(drivers.map((x) => [x.id, x]));
  const p = new Map(projects.map((x) => [x.id, x]));
  const roles = layout.labels.map((_, i) => layout.roles[i] ?? "ignore");
  const col = (r: ColumnRole) => roles.indexOf(r);
  const driverName = (id: string) => d.get(id)?.name ?? "";
  const driverCode = (id: string) => d.get(id)?.code ?? "";
  const projectName = (id: string) => p.get(id)?.name ?? "";
  const notes: string[] = [];
  const isNo = (h: string) => /^(no\.?|#|連番|行|行番号|順|順番)$/i.test(h.normalize("NFKC").replace(/\s/g, ""));

  if (layoutOf(roles) === "long") {
    const labels = [...layout.labels];
    const extra: ("project" | "date" | "note" | "driver")[] = [];
    const needsProject = col("project") < 0 && entries.some((e) => e.projectId !== layout.fixedProjectId);
    if (needsProject) extra.push("project");
    if (col("driver") < 0 && entries.some((e) => !driverCode(e.driverId))) extra.push("driver");
    if (col("date") < 0 && entries.some((e) => e.workDate)) extra.push("date");
    if (col("note") < 0 && entries.some((e) => e.note)) extra.push("note");
    const extraLabel = { project: "案件", date: "日付", note: "備考", driver: "ドライバー" } as const;
    for (const x of extra) labels.push(extraLabel[x]);
    if (extra.length) notes.push(`元の表に無い「${extra.map((x) => extraLabel[x]).join("」「")}」の列を右に足しました`);
    const sorted = [...entries].sort(sorter(d, p));
    const qtyCol = col("qty");
    const rows = sorted.map((e, n) => {
      const row: Cell[] = roles.map((r, i) => {
        if (r === "driver") return driverName(e.driverId);
        if (r === "driverCode") return driverCode(e.driverId) || null;
        if (r === "project") return projectName(e.projectId);
        if (r === "qty") return round4(e.qty);
        if (r === "date") return slashDate(e.workDate);
        if (r === "note") return e.note ?? null;
        if (r === "ignore" && isNo(layout.labels[i] ?? "")) return n + 1;
        return null;
      });
      for (const x of extra) {
        if (x === "project") row.push(projectName(e.projectId));
        else if (x === "driver") row.push(driverName(e.driverId));
        else if (x === "date") row.push(slashDate(e.workDate));
        else row.push(e.note ?? null);
      }
      return row;
    });
    const total: Cell[] = labels.map(() => null);
    const labelAt = [col("driver"), col("driverCode"), col("project")].find((i) => i >= 0 && i !== qtyCol) ?? (qtyCol > 0 ? 0 : -1);
    if (labelAt >= 0) total[labelAt] = "合計";
    total[qtyCol] = round4(entries.reduce((a, e) => a + e.qty, 0));
    return {
      header: headerRows(labels, roles, layout.headerDepth, month),
      rows,
      total: labelAt >= 0 ? total : null,
      numberCols: [qtyCol],
      dateCols: [col("date"), ...extra.flatMap((x, k) => (x === "date" ? [roles.length + k] : []))].filter((i) => i >= 0),
      notes,
    };
  }

  // ---- 横持ち
  const valueCols = roles.flatMap((r, i) => (r === "value" ? [i] : []));
  const dayCols = valueCols.filter((c) => dayOfHeader(layout.labels[c] ?? ""));
  const byDays = dayCols.length > 0 && dayCols.length >= valueCols.length / 2;
  const nameCols = roles.flatMap((r, i) => (r === "driver" || r === "driverCode" ? [i] : []));

  if (byDays) {
    // 人 × 案件ごとに 1 行。日付の列は、書き出す月に合わせて作り直す
    const days = dayColumns(layout.labels, dayCols, month);
    const firstDay = dayCols[0];
    const lastDay = dayCols[dayCols.length - 1];
    const before = layout.labels.slice(0, firstDay).map((l, i) => ({ label: l, role: roles[i] }));
    const after = layout.labels.slice(lastDay + 1).map((l, i) => ({ label: l, role: roles[lastDay + 1 + i] }));
    const undated = entries.filter((e) => !e.workDate || !days.some((x) => x.date === e.workDate));
    const needsProject = !before.some((c) => c.role === "project") && !after.some((c) => c.role === "project") && entries.some((e) => e.projectId !== layout.fixedProjectId);
    const labels = [...before.map((c) => c.label), ...days.map((x) => x.label), ...after.map((c) => c.label)];
    const outRoles: ColumnRole[] = [...before.map((c) => c.role), ...days.map(() => "value" as ColumnRole), ...after.map((c) => c.role)];
    if (undated.length) {
      labels.push("日付なし");
      outRoles.push("value");
      notes.push("日付の無い稼働（またはこの月の表に無い日の稼働）は、右の「日付なし」の列に入れました");
    }
    if (needsProject) {
      labels.push("案件");
      outRoles.push("project");
      notes.push("元の表に案件の列が無いため、右に「案件」の列を足しました");
    }
    const groups = new Map<string, ExportEntry[]>();
    for (const e of [...entries].sort(sorter(d, p))) {
      const k = `${e.driverId}:${e.projectId}`;
      groups.set(k, [...(groups.get(k) ?? []), e]);
    }
    const dayStart = before.length;
    const rows: Cell[][] = [];
    const sums: number[] = labels.map(() => 0);
    for (const list of groups.values()) {
      const e0 = list[0];
      const row: Cell[] = labels.map(() => null);
      outRoles.forEach((r, i) => {
        if (r === "driver") row[i] = driverName(e0.driverId);
        else if (r === "driverCode") row[i] = driverCode(e0.driverId) || null;
        else if (r === "project") row[i] = projectName(e0.projectId);
      });
      let rowSum = 0;
      for (const e of list) {
        const k = days.findIndex((x) => x.date === e.workDate);
        const at = k >= 0 ? dayStart + k : labels.indexOf("日付なし");
        row[at] = round4(((row[at] as number | null) ?? 0) + e.qty);
        sums[at] = round4(sums[at] + e.qty);
        rowSum = round4(rowSum + e.qty);
      }
      outRoles.forEach((r, i) => {
        if (r === "ignore" && isTotalHeader(labels[i] ?? "")) row[i] = rowSum;
      });
      rows.push(row);
    }
    const valueAt = outRoles.flatMap((r, i) => (r === "value" ? [i] : []));
    const totalAt = outRoles.flatMap((r, i) => (r === "ignore" && isTotalHeader(labels[i] ?? "") ? [i] : []));
    const total: Cell[] = labels.map((_, i) => (valueAt.includes(i) ? sums[i] : null));
    for (const i of totalAt) total[i] = round4(entries.reduce((a, e) => a + e.qty, 0));
    const labelAt = nameCols[0] ?? outRoles.indexOf("project");
    if (labelAt >= 0) total[labelAt] = "合計";
    return {
      header: headerRows(labels, outRoles, layout.headerDepth, month),
      rows,
      total,
      numberCols: [...valueAt, ...totalAt],
      dateCols: [],
      notes,
    };
  }

  // 人ごとに 1 行、案件の見出しの列に数量（日付の列があって日ごとに読んでいた表は、人 × 日ごとに 1 行）
  const projectCands = projects.map((x) => ({ id: x.id, name: x.name, aliases: x.aliases ?? [] }));
  const colProject = new Map<number, string>();
  for (const c of valueCols) {
    if (layout.fixedProjectId && valueCols.length === 1) {
      colProject.set(c, layout.fixedProjectId);
      continue;
    }
    const m = matchName(layout.labels[c] ?? "", projectCands);
    if (m && m.how !== "partial" && ![...colProject.values()].includes(m.id)) colProject.set(c, m.id);
  }
  const labels = [...layout.labels];
  const outRoles = [...roles];
  const missing = [...new Set(entries.map((e) => e.projectId))].filter((id) => ![...colProject.values()].includes(id));
  for (const id of missing.sort((a, b) => projectName(a).localeCompare(projectName(b), "ja"))) {
    colProject.set(labels.length, id);
    labels.push(projectName(id));
    outRoles.push("value");
  }
  if (missing.length) notes.push(`元の表に無い案件（${missing.map(projectName).join("・")}）の列を右に足しました`);
  const dateCol = outRoles.indexOf("date");
  const byDate = dateCol >= 0 && entries.some((e) => e.workDate);
  const groups = new Map<string, ExportEntry[]>();
  for (const e of [...entries].sort(sorter(d, p))) {
    const k = byDate ? `${e.driverId}:${e.workDate ?? ""}` : e.driverId;
    groups.set(k, [...(groups.get(k) ?? []), e]);
  }
  const colOf = new Map([...colProject.entries()].map(([c, id]) => [id, c]));
  const rows: Cell[][] = [];
  const sums: number[] = labels.map(() => 0);
  for (const list of groups.values()) {
    const e0 = list[0];
    const row: Cell[] = labels.map(() => null);
    outRoles.forEach((r, i) => {
      if (r === "driver") row[i] = driverName(e0.driverId);
      else if (r === "driverCode") row[i] = driverCode(e0.driverId) || null;
      else if (r === "date") row[i] = byDate ? slashDate(e0.workDate) : null;
    });
    let rowSum = 0;
    for (const e of list) {
      const at = colOf.get(e.projectId)!;
      row[at] = round4(((row[at] as number | null) ?? 0) + e.qty);
      sums[at] = round4(sums[at] + e.qty);
      rowSum = round4(rowSum + e.qty);
    }
    // 空のセルは 0（元の表と同じく、横に並ぶ表は 0 で埋める）
    for (const c of colProject.keys()) if (row[c] === null) row[c] = 0;
    outRoles.forEach((r, i) => {
      if (r === "ignore" && isTotalHeader(labels[i] ?? "")) row[i] = rowSum;
    });
    rows.push(row);
  }
  const valueAt = [...colProject.keys()].sort((a, b) => a - b);
  const totalAt = outRoles.flatMap((r, i) => (r === "ignore" && isTotalHeader(labels[i] ?? "") ? [i] : []));
  const total: Cell[] = labels.map((_, i) => (valueAt.includes(i) ? sums[i] : null));
  for (const i of totalAt) total[i] = round4(entries.reduce((a, e) => a + e.qty, 0));
  const labelAt = nameCols[0] ?? -1;
  if (labelAt >= 0) total[labelAt] = "合計";
  return {
    header: headerRows(labels, outRoles, layout.headerDepth, month),
    rows,
    total: labelAt >= 0 ? total : null,
    numberCols: [...valueAt, ...totalAt],
    dateCols: byDate ? [dateCol] : [],
    notes,
  };
}

/** 見出しの行。2 段の見出し（上に月、下に日付）だった表は、同じく 2 段にする */
function headerRows(labels: string[], roles: ColumnRole[], depth: 1 | 2, month: string): Cell[][] {
  const firstDay = labels.findIndex((l, i) => roles[i] === "value" && dayOfHeader(l));
  if (depth === 1 || firstDay < 0) return [labels];
  const top: Cell[] = labels.map((l, i) => (roles[i] === "value" && dayOfHeader(l) ? null : l));
  const bottom: Cell[] = labels.map((l, i) => (roles[i] === "value" && dayOfHeader(l) ? l : null));
  top[firstDay] = `${Number(month.slice(5, 7))}月`;
  return [top, bottom];
}
