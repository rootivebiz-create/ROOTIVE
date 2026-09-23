/**
 * 取り込み：決めた読み方で表を 1 件ずつに読む（純関数。DB に触らない）。
 * 取り込まない行は、行番号と理由を残す。ファイル自身の合計（合計の行・「計」の列）と照らし合わせる。
 */
import { isBlankRow, isTotalRow, parseDateCell, parseNumberCell } from "~/server/tabular";
import { colLetter, dayColumnDates, dayOfHeader, effectiveHeader, isTotalHeader, mappingProblem } from "./detect";
import { layoutOf, type ColumnRole, type ParseResult, type RawRecord, type SkippedRow, type TotalCheck, type WorkMapping } from "./types";

const EPS = 1e-6;
const NEGATIVE = "数量がマイナス（取り込めません。差し引きは「稼働と調整」の調整で入れてください）";

function round4(n: number): number {
  return Math.round(n * 1e4) / 1e4;
}

function fmt(n: number): string {
  return round4(n).toLocaleString("ja-JP");
}

function cellOf(row: string[], col: number): string {
  return col >= 0 ? (row[col] ?? "").trim() : "";
}

/** 数として読めないセルの説明（番地つき）。よくある打ち間違いには、その可能性を添える */
export function unreadableQty(address: string, raw: string): string {
  const v = raw.normalize("NFKC").replace(/[,\s]/g, "");
  let hint = "";
  if (/[oO]/.test(v) && parseNumberCell(v.replace(/[oO]/g, "0")) !== null) hint = "英字の O（オー）が混じっている可能性があります";
  else if (/[lI|]/.test(v) && parseNumberCell(v.replace(/[lI|]/g, "1")) !== null) hint = "英字の l（エル）か I（アイ）が混じっている可能性があります";
  else if (/[〜~]|\d-\d/.test(v)) hint = "範囲や記号の入った値は読めません。数だけにしてください";
  else if (!/\d/.test(v)) hint = "数字が入っていません";
  else hint = "数だけにしてください";
  return `${address}「${raw}」は数字ではありません。${hint}`;
}

function totalLabel(row: string[]): string {
  return row.find((c) => /^(総?合計|小計|計|total|sum)$/i.test(c.normalize("NFKC").replace(/\s/g, ""))) ?? "合計";
}

function monthLabel(ym: string): string {
  const [y, m] = ym.split("-").map(Number);
  return `${y}年${m}月`;
}

export function emptyParse(problem: string | null): ParseResult {
  return { records: [], skipped: [], emptyCells: 0, checks: [], warnings: [], dateMonths: {}, problem };
}

/** 読み方（mapping）で表を読む。month は取り込む月（YYYY-MM-01。日だけの見出しの年月に使う） */
export function parseWithMapping(rows: string[][], mapping: WorkMapping, month: string): ParseResult {
  const problem = mappingProblem(mapping);
  if (problem) return emptyParse(problem);
  const header = effectiveHeader(rows, mapping.headerRow, mapping.headerDepth);
  const roles = mapping.roles;
  const col = (r: ColumnRole) => roles.indexOf(r);
  const driverCol = col("driver");
  const codeCol = col("driverCode");
  const projectCol = col("project");
  const qtyCol = col("qty");
  const dateCol = col("date");
  const noteCol = col("note");
  const layout = layoutOf(roles);
  const fixed = mapping.fixedProjectId;
  const warnings: string[] = [];

  // 横持ちの数の列：日付の見出しか、案件名の見出しか
  const valueCols = roles.flatMap((r, i) => (r === "value" ? [i] : []));
  const dayDates = dayColumnDates(
    valueCols.map((c) => ({ col: c, header: header[c] ?? "" })),
    month,
  );
  const activeCols: number[] = [];
  const badDays: string[] = [];
  const blankHeads: string[] = [];
  for (const c of valueCols) {
    const h = header[c] ?? "";
    if (dayOfHeader(h) && !dayDates.has(c)) badDays.push(`${colLetter(c)}列「${h}」`);
    else if (!h.trim() && !fixed) blankHeads.push(`${colLetter(c)}列`);
    else activeCols.push(c);
  }
  if (badDays.length) warnings.push(`${badDays.join("、")}は、取り込む月に無い日なので取り込みません`);
  if (blankHeads.length) warnings.push(`${blankHeads.join("、")}は見出しが空なので、どの案件か分からず取り込みません`);

  const needsRowProject = layout === "long" || activeCols.some((c) => dayDates.has(c));
  if (needsRowProject && projectCol < 0 && !fixed) {
    return emptyParse(
      layout === "long"
        ? "案件の列を選ぶか、「この表はすべて同じ案件」で案件を選んでください"
        : "日付ごとの表です。案件の列を選ぶか、「この表はすべて同じ案件」で案件を選んでください",
    );
  }

  const start = mapping.headerRow + mapping.headerDepth;
  const year = Number(month.slice(0, 4));
  const records: RawRecord[] = [];
  const skipped: SkippedRow[] = [];
  const totalRows: { rowNo: number; label: string; row: string[] }[] = [];
  const dateMonths: Record<string, number> = {};
  const badDates: string[] = [];
  let emptyCells = 0;
  let readSum = 0;
  const importedByCol = new Map<number, number>();
  const rowTotalCol = layout === "wide" ? header.findIndex((h, i) => roles[i] !== "value" && isTotalHeader(h)) : -1;
  let rowTotalExpected = 0;
  let rowTotalActual = 0;
  let rowTotalRows = 0;
  const rowTotalBad: string[] = [];

  for (let i = start; i < rows.length; i++) {
    const row = rows[i];
    const rowNo = i + 1;
    if (isBlankRow(row)) {
      skipped.push({ rowNo, reason: "空の行" });
      continue;
    }
    if (isTotalRow(row)) {
      const label = totalLabel(row);
      totalRows.push({ rowNo, label, row });
      skipped.push({ rowNo, reason: /小計/.test(label) ? "小計の行" : "合計の行（取り込まず、合計の確かめに使います）" });
      continue;
    }
    const driver = cellOf(row, driverCol);
    const code = cellOf(row, codeCol);
    const note = cellOf(row, noteCol) || null;
    const rowProject = cellOf(row, projectCol);
    let date: string | null = null;
    if (dateCol >= 0) {
      const rawDate = cellOf(row, dateCol);
      if (rawDate) {
        const d = parseDateCell(rawDate, year);
        if (d) {
          date = d;
          dateMonths[d.slice(0, 7)] = (dateMonths[d.slice(0, 7)] ?? 0) + 1;
        } else badDates.push(`${colLetter(dateCol)}${rowNo}「${rawDate}」`);
      }
    }
    const rowDate = mapping.useDates ? date : null;

    if (layout === "long") {
      const raw = cellOf(row, qtyCol);
      const addr = `${colLetter(qtyCol)}${rowNo}`;
      if (!driver && !code && !raw && !rowProject) {
        skipped.push({ rowNo, reason: "空の行" });
        continue;
      }
      if (!raw) {
        skipped.push({ rowNo, cell: addr, reason: "数量が空" });
        continue;
      }
      const n = parseNumberCell(raw);
      if (n === null) {
        skipped.push({ rowNo, cell: addr, reason: unreadableQty(addr, raw) });
        continue;
      }
      readSum += n;
      if (n === 0) {
        skipped.push({ rowNo, cell: addr, reason: "数量が 0" });
        continue;
      }
      if (n < 0) {
        skipped.push({ rowNo, cell: addr, reason: NEGATIVE });
        continue;
      }
      if (!driver && !code) {
        skipped.push({ rowNo, cell: addr, reason: "ドライバーの名前が空" });
        continue;
      }
      if (!fixed && !rowProject) {
        skipped.push({ rowNo, cell: addr, reason: "案件が空" });
        continue;
      }
      records.push({ rowNo, cell: addr, driver, code, project: fixed ? "" : rowProject, qty: round4(n), date: rowDate, note });
      continue;
    }

    // 横持ち：数の列を 1 つずつ
    const rowRecords: RawRecord[] = [];
    const rowSkips: SkippedRow[] = [];
    let rowSum = 0;
    let anyValue = false;
    for (const c of activeCols) {
      const raw = cellOf(row, c);
      const addr = `${colLetter(c)}${rowNo}`;
      if (!raw) {
        emptyCells++;
        continue;
      }
      const n = parseNumberCell(raw);
      if (n === null) {
        anyValue = true;
        rowSkips.push({ rowNo, cell: addr, reason: unreadableQty(addr, raw) });
        continue;
      }
      rowSum += n;
      if (n === 0) {
        emptyCells++;
        continue;
      }
      anyValue = true;
      if (n < 0) {
        rowSkips.push({ rowNo, cell: addr, reason: NEGATIVE });
        continue;
      }
      const dayDate = dayDates.get(c) ?? null;
      const project = fixed ? "" : dayDate ? rowProject : (header[c] ?? "").trim();
      if (!fixed && !project) {
        rowSkips.push({ rowNo, cell: addr, reason: "案件が空" });
        continue;
      }
      rowRecords.push({ rowNo, cell: addr, driver, code, project, qty: round4(n), date: dayDate ?? rowDate, note });
    }
    if (!driver && !code) {
      skipped.push({ rowNo, reason: anyValue ? "ドライバーの名前が空" : "空の行" });
      continue;
    }
    skipped.push(...rowSkips);
    for (const r of rowRecords) {
      const c = activeCols.find((x) => r.cell === `${colLetter(x)}${rowNo}`)!;
      importedByCol.set(c, (importedByCol.get(c) ?? 0) + r.qty);
    }
    records.push(...rowRecords);
    if (rowTotalCol >= 0) {
      const expected = parseNumberCell(cellOf(row, rowTotalCol));
      if (expected !== null) {
        rowTotalRows++;
        rowTotalExpected += expected;
        rowTotalActual += rowSum;
        if (Math.abs(expected - rowSum) > EPS)
          rowTotalBad.push(`${rowNo}行目（${driver || code}）：「${header[rowTotalCol]}」は ${fmt(expected)}、読み取りは ${fmt(rowSum)}`);
      }
    }
  }

  // ---- ファイルの合計との照合
  const checks: TotalCheck[] = [];
  const imported = round4(records.reduce((s, r) => s + r.qty, 0));
  const grand = [...totalRows].reverse().find((t) => !/小計/.test(t.label));
  if (grand && layout === "long") {
    const expected = parseNumberCell(cellOf(grand.row, qtyCol));
    if (expected !== null) {
      const ok = Math.abs(expected - imported) < EPS;
      checks.push({
        label: `ファイルの${grand.label}（${grand.rowNo}行目）`,
        expected,
        actual: imported,
        ok,
        note: !ok && Math.abs(expected - readSum) < EPS ? "差は、取り込まない行（数量が 0・名前が空・マイナス など）の分です" : undefined,
      });
    }
  }
  if (grand && layout === "wide") {
    let expected = 0;
    let found = false;
    const badCols: string[] = [];
    for (const c of activeCols) {
      const v = parseNumberCell(cellOf(grand.row, c));
      if (v === null) continue;
      found = true;
      expected += v;
      const got = round4(importedByCol.get(c) ?? 0);
      if (Math.abs(v - got) > EPS) badCols.push(`「${header[c]}」は ${fmt(v)}、読み取りは ${fmt(got)}`);
    }
    if (found) {
      checks.push({
        label: `ファイルの${grand.label}（${grand.rowNo}行目）`,
        expected: round4(expected),
        actual: imported,
        ok: badCols.length === 0 && Math.abs(expected - imported) < EPS,
        note: badCols.length ? badCols.slice(0, 5).join("／") : undefined,
      });
    }
  }
  if (rowTotalRows > 0) {
    checks.push({
      label: `各行の「${header[rowTotalCol]}」の列（${rowTotalRows}行）`,
      expected: round4(rowTotalExpected),
      actual: round4(rowTotalActual),
      ok: rowTotalBad.length === 0,
      note: rowTotalBad.length ? rowTotalBad.slice(0, 5).join("／") + (rowTotalBad.length > 5 ? ` ほか ${rowTotalBad.length - 5} 行` : "") : undefined,
    });
  }

  // ---- 気づいたこと
  if (badDates.length) {
    warnings.push(
      `日付として読めないセルがあります：${badDates.slice(0, 5).join("、")}${badDates.length > 5 ? ` ほか ${badDates.length - 5} か所` : ""}（その行は日付なしで取り込みます）`,
    );
  }
  const target = month.slice(0, 7);
  const datedMonths = new Map<string, number>();
  for (const r of records) if (r.date) datedMonths.set(r.date.slice(0, 7), (datedMonths.get(r.date.slice(0, 7)) ?? 0) + 1);
  const others = [...datedMonths.entries()].filter(([ym]) => ym !== target);
  if (others.length) {
    warnings.push(
      `取り込む月（${monthLabel(target)}分）と別の月の日付の行があります：${others.map(([ym, n]) => `${monthLabel(ym)} ${n}行`).join("、")}。締め日が月末でなければ、そのままで構いません`,
    );
  }
  const dup = new Map<string, number>();
  for (const r of records) {
    const k = `${r.driver}|${r.code}|${r.project}|${r.date ?? ""}`;
    dup.set(k, (dup.get(k) ?? 0) + 1);
  }
  const dupDated = [...dup.entries()].filter(([k, n]) => n > 1 && !k.endsWith("|"));
  if (dupDated.length) {
    const ex = dupDated.slice(0, 3).map(([k, n]) => {
      const [d, c, p, date] = k.split("|");
      return `${d || c}・${p || "（同じ案件）"}・${date}（${n}行）`;
    });
    warnings.push(
      `同じ日・同じ人・同じ案件の行が 2 行以上あります：${ex.join("、")}。二重に書いていないか確かめてください（このまま取り込むと足し合わせます）`,
    );
  }

  return { records, skipped, emptyCells, checks, warnings, dateMonths, problem: null };
}
