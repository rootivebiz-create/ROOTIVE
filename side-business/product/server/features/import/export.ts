import "server-only";
import ExcelJS from "exceljs";
import { and, asc, count, desc, eq, isNotNull, sql } from "drizzle-orm";
import type { Db } from "~/db/client";
import * as s from "~/db/schema";
import { monthLabelJa } from "~/server/month";
import { effectiveHeader } from "./detect";
import { buildExportSheet, type ExportLayout, type ExportSheet } from "./export-layout";
import { COLUMN_ROLES, type ColumnRole, type WorkMapping } from "./types";

/**
 * 「Excel に戻す」：月の稼働を xlsx にする。いちばん最近反映した取り込み（覚えた読み方を使ったもの）と同じ列の並び・見出しにする。
 * 取り込みが無ければ、ふつうの形（日付・ドライバー・案件・数量・単位・備考）。
 * しめ日ラボをやめても、いつでも今の Excel に戻れるように。
 */

function isRole(v: unknown): v is ColumnRole {
  return typeof v === "string" && (COLUMN_ROLES as string[]).includes(v);
}

/**
 * 書き出しに使う形：その月に反映した取り込み（覚えた読み方つき）の、見出しと列の役目。
 * その月に取り込みが無ければ、いちばん最近反映した取り込みの形（month を渡さないときも）。
 */
export async function loadExportLayout(db: Db, tenantId: string, month?: string): Promise<ExportLayout> {
  const rows = await db
    .select({
      fileName: s.importBatches.fileName,
      mapping: sql<WorkMapping | null>`${s.importBatches.summary}->'mapping'`,
      // 見出しのあたり（上の 41 行）だけを読む（シートの中身をまるごと読まない）
      head: sql<string[][] | null>`jsonb_path_query_array(${s.importBatches.summary}->'sheets'->((${s.importBatches.summary}->>'sheetIndex')::int)->'rows', '$[0 to 40]')`,
    })
    .from(s.importBatches)
    .where(
      and(
        eq(s.importBatches.tenantId, tenantId),
        eq(s.importBatches.kind, "work"),
        eq(s.importBatches.status, "applied"),
        isNotNull(s.importBatches.mappingProfileId),
        sql`${s.importBatches.summary}->>'v' = '1'`,
      ),
    )
    // その月の取り込みを先に（9 月を出すのに、あとで使い始めた 10 月の別の形にしない）
    .orderBy(...(month ? [sql`(${s.importBatches.month} = ${month}) desc`] : []), desc(s.importBatches.createdAt))
    .limit(1);
  const r = rows[0];
  const m = r?.mapping;
  // 人が横に並ぶ表・1 人 1 枚の表・シートごとに別の人の表は、月の全員を同じ形では書き出せない（ふつうの 1 行 1 件の表にする）
  const byPerson = Array.isArray(m?.roles) && (m.roles.includes("driverValue") || !!m.sheetDrivers || !!m.fixedDriverId);
  if (!r || !m || !Array.isArray(r.head) || !Array.isArray(m.roles) || r.head.length <= m.headerRow || byPerson) {
    return { source: "plain", fileName: null, labels: [], roles: [], headerDepth: 1, fixedProjectId: null };
  }
  const head = r.head.map((row) => (Array.isArray(row) ? row.map((c) => String(c ?? "")) : []));
  const depth = m.headerDepth === 2 ? 2 : 1;
  const labels = effectiveHeader(head, m.headerRow, depth);
  // 右の空の列（見出しも役目も無い列）は落とす
  let width = labels.length;
  while (width > 0 && !labels[width - 1].trim() && (m.roles[width - 1] ?? "ignore") === "ignore") width--;
  return {
    source: "profile",
    fileName: r.fileName,
    labels: labels.slice(0, width),
    roles: labels.slice(0, width).map((_, i) => (isRole(m.roles[i]) ? m.roles[i] : "ignore")),
    headerDepth: depth,
    fixedProjectId: m.fixedProjectId ?? null,
  };
}

/** その月の稼働の行の数（「Excel に戻す」を出すかどうか） */
export async function monthEntryCount(db: Db, tenantId: string, month: string): Promise<number> {
  const [row] = await db
    .select({ n: count() })
    .from(s.workEntries)
    .where(and(eq(s.workEntries.tenantId, tenantId), eq(s.workEntries.month, month)));
  return Number(row?.n ?? 0);
}

export type WorkExport = { bytes: Uint8Array; fileName: string; rows: number; entries: number; layout: ExportLayout; notes: string[] };

/** 月の稼働を xlsx にする */
export async function buildWorkExport(db: Db, tenantId: string, month: string): Promise<WorkExport> {
  const [layout, entries, drivers, projects] = await Promise.all([
    loadExportLayout(db, tenantId, month),
    db
      .select({ driverId: s.workEntries.driverId, projectId: s.workEntries.projectId, qty: s.workEntries.qty, workDate: s.workEntries.workDate, note: s.workEntries.note })
      .from(s.workEntries)
      .where(and(eq(s.workEntries.tenantId, tenantId), eq(s.workEntries.month, month)))
      .orderBy(asc(s.workEntries.workDate), asc(s.workEntries.createdAt)),
    db
      .select({ id: s.drivers.id, name: s.drivers.name, code: s.drivers.code, kana: s.drivers.kana, aliases: s.drivers.aliases })
      .from(s.drivers)
      .where(eq(s.drivers.tenantId, tenantId)),
    db
      .select({ id: s.projects.id, name: s.projects.name, aliases: s.projects.aliases, unit: s.projects.unit })
      .from(s.projects)
      .where(eq(s.projects.tenantId, tenantId)),
  ]);
  const sheet = buildExportSheet(layout, month, entries, drivers, projects);
  const bytes = await workbookBytes(sheet, month, layout);
  return {
    bytes,
    fileName: `稼働_${monthLabelJa(month)}分.xlsx`,
    rows: sheet.rows.length,
    entries: entries.length,
    layout,
    notes: sheet.notes,
  };
}

function isoToDate(v: string): Date | null {
  const m = v.match(/^(\d{4})\/(\d{2})\/(\d{2})$/);
  return m ? new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]))) : null;
}

/** 表を xlsx のバイト列にする。1 行目に表題（何月分か）、その下に見出し、最後に合計の行 */
export async function workbookBytes(sheet: ExportSheet, month: string, layout: ExportLayout): Promise<Uint8Array> {
  const wb = new ExcelJS.Workbook();
  wb.creator = "しめ日ラボ";
  const ws = wb.addWorksheet(`${monthLabelJa(month)}`.slice(0, 31));
  ws.addRow([`${monthLabelJa(month)}分 稼働`]);
  ws.getRow(1).font = { bold: true };
  for (const h of sheet.header) {
    const row = ws.addRow(h.map((c) => c ?? ""));
    row.font = { bold: true };
  }
  const dateCols = new Set(sheet.dateCols);
  for (const r of sheet.rows) {
    ws.addRow(r.map((c, i) => (dateCols.has(i) && typeof c === "string" ? (isoToDate(c) ?? c) : (c ?? ""))));
  }
  if (sheet.total) {
    const row = ws.addRow(sheet.total.map((c) => c ?? ""));
    row.font = { bold: true };
  }
  for (const c of sheet.dateCols) ws.getColumn(c + 1).numFmt = "yyyy/m/d";
  for (const c of sheet.numberCols) ws.getColumn(c + 1).numFmt = "#,##0.####";
  const width = Math.max(...sheet.header.map((h) => h.length), 1);
  for (let c = 1; c <= width; c++) {
    const label = String(sheet.header.map((h) => h[c - 1] ?? "").find(Boolean) ?? "");
    ws.getColumn(c).width = Math.min(30, Math.max(8, label.length * 2 + 2));
  }
  // 説明のシートは作らない（取り込み直したときに、別のシートを選ばないように）。どの形で出したかは画面に出す
  wb.description = layout.source === "profile" ? `列の並びは「${layout.fileName ?? ""}」と同じ` : "日付・ドライバー・案件・数量・単位・備考";
  const buf = await wb.xlsx.writeBuffer();
  return new Uint8Array(buf as ArrayBuffer);
}
