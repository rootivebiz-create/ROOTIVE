import "server-only";
import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { and, asc, desc, eq, inArray, ne, or, sql } from "drizzle-orm";
import { roundYen, yen } from "@/lib/payroll/money";
import type { Db } from "~/db/client";
import * as s from "~/db/schema";
import { UserError } from "~/server/action";
import { buildStatementDrafts, type BuildInput } from "~/server/calc/statement";
import { saveParallelChecks } from "~/server/features/parallel";
import { monthLabelJa, shiftMonth } from "~/server/month";
import { isMonthClosed, loadBuildInput } from "~/server/repo";
import { readTable, TableReadError } from "~/server/tabular";
import {
  baseName,
  chooseSheet,
  dataRowCount,
  effectiveHeader,
  findProfile,
  guessMapping,
  mappingProblem,
  profileData,
  shapeSignature,
  sheetWidth,
  suggestMonth,
  trimSheet,
  type ProfileLike,
} from "./detect";
import { readPayout, type PayoutRead } from "./columns";
import { emptyParse, parseWithMapping } from "./parse";
import { moneyExtras, type DeductionProposal, type MoneyExtras } from "./proposals";
import {
  compareWithPrev,
  registrableDrivers,
  resolveRecords,
  totalsOf,
  type CompareRow,
  type Known,
  type Resolution,
  type ResolvedRecord,
} from "./resolve";
import {
  MAX_FILE_BYTES,
  MAX_SHEET_ROWS,
  SAMPLE_FILES,
  type ApplyMode,
  type BatchStats,
  type ColumnRole,
  type DraftSummary,
  type Learned,
  type ParseResult,
  type PayoutSaved,
  type RestoreEntry,
  type SampleKey,
  type StoredSheet,
  type WorkMapping,
} from "./types";

/**
 * 取り込み（稼働の Excel・CSV）の DB の処理。Server Action からも、テストからも呼ぶ。
 * 流れ：ファイルを置く（下書き）→ 読み方・名前を決める → 確かめる → 反映（稼働に書く）→ 必要なら取り消し。
 * 下書きは import_batches（status='draft'）の summary にシートの中身と読み方を持つので、読み直しても続きから進められる。
 */

const MAX_STORED_CELLS = 400_000;
const INSERT_CHUNK = 500;
const READABLE = /\.(xlsx|xlsm|csv|tsv|txt)$/i;

export type ImportUser = { id: string | null; name?: string | null };

// ---------------------------------------------------------------- 台帳

export async function loadKnown(db: Db, tenantId: string): Promise<Known> {
  const [drivers, projects] = await Promise.all([
    db
      .select({ id: s.drivers.id, name: s.drivers.name, code: s.drivers.code, kana: s.drivers.kana, aliases: s.drivers.aliases, active: s.drivers.active })
      .from(s.drivers)
      .where(eq(s.drivers.tenantId, tenantId))
      .orderBy(asc(s.drivers.name)),
    db
      .select({ id: s.projects.id, name: s.projects.name, aliases: s.projects.aliases, unit: s.projects.unit, active: s.projects.active })
      .from(s.projects)
      .where(eq(s.projects.tenantId, tenantId))
      .orderBy(asc(s.projects.name)),
  ]);
  return { drivers, projects };
}

async function loadProfiles(db: Db, tenantId: string): Promise<ProfileLike[]> {
  const rows = await db
    .select()
    .from(s.mappingProfiles)
    .where(and(eq(s.mappingProfiles.tenantId, tenantId), eq(s.mappingProfiles.kind, "work")))
    .orderBy(desc(s.mappingProfiles.updatedAt));
  return rows.map((r) => ({ id: r.id, headerSignature: r.headerSignature, mapping: r.mapping, options: r.options }));
}

// ---------------------------------------------------------------- 読み取り（純）

export type Computed = {
  rows: string[][];
  header: string[];
  parse: ParseResult;
  resolution: Resolution;
  problem: string | null;
};

/** 下書きの中身（シート・読み方・取り込まない名前）から、行と名前の当たりを出す */
export function computeDraft(summary: DraftSummary, month: string, known: Known): Computed {
  const rows = summary.sheets[summary.sheetIndex]?.rows ?? null;
  const emptyRes = resolveRecords([], known, null, { drivers: [], projects: [] });
  if (!rows) {
    const problem = "このシートの中身は保存していません。シートを切り替えるには、ファイルをもう一度置いてください";
    return { rows: [], header: [], parse: emptyParse(problem), resolution: emptyRes, problem };
  }
  const header = effectiveHeader(rows, summary.mapping.headerRow, summary.mapping.headerDepth);
  const parse = parseWithMapping(rows, summary.mapping, month);
  const resolution = resolveRecords(parse.records, known, summary.mapping.fixedProjectId, summary.skip);
  const truncated = summary.sheets[summary.sheetIndex]?.truncated
    ? `このシートは ${MAX_SHEET_ROWS.toLocaleString("ja-JP")} 行を超えていて、途中から先を読めていないおそれがあります。月の前半・後半などに分けたファイルにして、1 つずつ置いてください`
    : null;
  let problem =
    truncated ?? parse.problem ?? (resolution.fixedProjectMissing ? "「この表はすべて同じ案件」で選んだ案件が見つかりません。選び直してください" : null);
  // 人の列が無く、単価・金額の列がある表は、元請の支払通知のことが多い
  const roles = summary.mapping.roles;
  if (problem && !roles.includes("driver") && !roles.includes("driverCode") && header.some((h) => /単価|金額|支払額|請求/.test(h))) {
    problem += "。元請からの支払通知なら、「元請との突合」の画面で取り込みます";
  }
  return { rows, header, parse, resolution, problem };
}

export function statsOf(c: Computed, known: Known): BatchStats {
  const pInfo = new Map(known.projects.map((p) => [p.id, p]));
  const totals = new Map<string, { name: string; unit: string; qty: number }>();
  const drivers = new Set<string>();
  for (const r of c.resolution.resolved) {
    drivers.add(r.driverId);
    const p = pInfo.get(r.projectId);
    const t = totals.get(r.projectId) ?? { name: p?.name ?? "", unit: p?.unit ?? "", qty: 0 };
    t.qty = Math.round((t.qty + r.qty) * 1e4) / 1e4;
    totals.set(r.projectId, t);
  }
  return {
    records: c.resolution.resolved.length,
    totalQty: Math.round(c.resolution.resolved.reduce((a, r) => a + r.qty, 0) * 1e4) / 1e4,
    drivers: drivers.size,
    projects: totals.size,
    skippedRows: c.parse.skipped.length,
    unresolved: c.resolution.unresolvedRecords,
    byProject: [...totals.values()].sort((a, b) => a.name.localeCompare(b.name, "ja")),
  };
}

// ---------------------------------------------------------------- ファイルを置く

export async function readSampleFile(key: SampleKey): Promise<{ fileName: string; bytes: Uint8Array }> {
  const fileName = SAMPLE_FILES[key];
  const bytes = await fs.readFile(path.join(process.cwd(), "public", "samples", fileName));
  return { fileName, bytes: new Uint8Array(bytes) };
}

/** 置いたファイルの形に合わないときの、やさしい説明 */
function fileProblem(fileName: string, size: number): string | null {
  const lower = fileName.toLowerCase();
  if (size === 0) return "ファイルが空です（0 バイト）。保存し直したファイルを置いてください";
  if (size > MAX_FILE_BYTES) return "ファイルが大きすぎます（10MB まで）。使っていないシートや画像を消してから置いてください";
  if (lower.endsWith(".xls")) return "古い形式の Excel（.xls）は読めません。Excel で「名前を付けて保存」→「Excel ブック（.xlsx）」にしてから置いてください";
  if (lower.endsWith(".pdf"))
    return "PDF は読めません。元の Excel か、CSV で書き出したファイルを置いてください（元請の画面なら、CSV のダウンロードがないか確かめてください）";
  if (/\.(numbers|ods)$/.test(lower)) return "この形式は読めません。「書き出す」で Excel（.xlsx）か CSV にしてから置いてください";
  if (/\.(png|jpe?g|heic|gif|webp)$/.test(lower)) return "写真・画像は読めません。元の Excel か CSV を置いてください";
  if (!READABLE.test(lower)) return "読めるのは Excel（.xlsx）と CSV（.csv）です。Excel で「名前を付けて保存」から、どちらかにしてください";
  return null;
}

export async function createDraftFromFile(
  db: Db,
  tenantId: string,
  user: ImportUser,
  input: { fileName: string; bytes: Uint8Array; pageMonth: string; sample?: boolean },
): Promise<{ id: string; month: string }> {
  const fileName = input.fileName.trim().slice(0, 200) || "ファイル";
  const problem = fileProblem(fileName, input.bytes.byteLength);
  if (problem) throw new UserError(problem);

  let read;
  try {
    read = await readTable(fileName, input.bytes);
  } catch (error) {
    if (error instanceof TableReadError) throw new UserError(error.message);
    throw new UserError("ファイルを読めませんでした。Excel で開けるか確かめて、保存し直したファイルを置いてください");
  }
  const sheets = read.sheets
    .map((sh) => {
      const rows = trimSheet(sh.rows);
      // 上限の行まで中身があるシートは、その先を読めていないおそれがある（黙って少なく取り込まないように印を付ける）
      return { name: sh.name, rows, truncated: rows.length >= MAX_SHEET_ROWS };
    })
    .filter((sh) => sh.rows.length > 0);
  if (sheets.length === 0) throw new UserError("ファイルの中に表がありませんでした（空のファイルのようです）。中身を確かめてください");

  const counted = sheets.map((sh) => ({ ...sh, dataRows: dataRowCount(sh.rows) }));
  // 月ごとにシートを足していくブックなら、開いていた月のシートを先に選ぶ（無ければデータの行がいちばん多いシート）
  const sheetIndex = chooseSheet(counted, input.pageMonth);
  const byMonth = counted.length > 1 && chooseSheet(counted) !== sheetIndex;
  // 大きなファイルは、選んだシートの中身だけ持つ
  const cellCount = (rows: string[][]) => rows.reduce((a, r) => a + r.length, 0);
  let cells = cellCount(counted[sheetIndex].rows);
  const stored: StoredSheet[] = counted.map((sh, i) => {
    const flag = sh.truncated ? { truncated: true } : {};
    if (i === sheetIndex) return { name: sh.name, rows: sh.rows, dataRows: sh.dataRows, ...flag };
    const n = cellCount(sh.rows);
    const keep = cells + n <= MAX_STORED_CELLS;
    if (keep) cells += n;
    return { name: sh.name, rows: keep ? sh.rows : null, dataRows: sh.dataRows, ...flag };
  });

  const known = await loadKnown(db, tenantId);
  const profiles = await loadProfiles(db, tenantId);
  const rows = counted[sheetIndex].rows;
  const { mapping, from, profileId } = readingFor(rows, known, profiles);
  const header = effectiveHeader(rows, mapping.headerRow, mapping.headerDepth);
  // シート名の月（「10月」）は Excel のときだけ見る（CSV のシート名はファイル名と同じ）
  const sheetHint = read.encoding === "xlsx" ? { name: counted[sheetIndex].name, near: input.pageMonth } : undefined;
  const guessMonth = suggestMonth(rows, mapping, fileName, sheetHint);
  const month = guessMonth?.month ?? input.pageMonth;

  // 置いたファイルそのもののハッシュ（同じファイルの二重の取り込みを見つける）
  const fileHash = createHash("sha256").update(input.bytes).digest("hex");
  const summary: DraftSummary = {
    v: 1,
    file: {
      name: fileName,
      size: input.bytes.byteLength,
      hash: fileHash,
      encoding: read.encoding,
      uploadedAt: new Date().toISOString(),
      ...(input.sample ? { sample: true } : {}),
    },
    sheets: stored,
    sheetIndex,
    sheetFrom: byMonth ? "month" : "rows",
    signature: shapeSignature(header),
    mapping,
    mappingFrom: from,
    profileId,
    monthFrom: guessMonth?.from ?? "page",
    skip: { drivers: [], projects: [] },
    learned: [],
  };
  summary.stats = statsOf(computeDraft(summary, month, known), known);

  const [batch] = await db
    .insert(s.importBatches)
    .values({
      tenantId,
      month,
      kind: "work",
      fileName,
      fileHash,
      mappingProfileId: profileId,
      rowCount: summary.stats.records,
      status: "draft",
      summary: summary as unknown as Record<string, unknown>,
      createdBy: user.id,
    })
    .returning({ id: s.importBatches.id });
  return { id: batch.id, month };
}

/** 覚えた読み方があればそれ、無ければ推測 */
function readingFor(
  rows: string[][],
  known: Known,
  profiles: ProfileLike[],
): { mapping: WorkMapping; from: DraftSummary["mappingFrom"]; profileId: string | null } {
  const found = findProfile(rows, profiles);
  if (found) {
    const width = sheetWidth(rows);
    const roles = [...found.mapping.roles];
    while (roles.length < width) roles.push("ignore");
    const knownFixed = found.mapping.fixedProjectId && known.projects.some((p) => p.id === found.mapping.fixedProjectId) ? found.mapping.fixedProjectId : null;
    return { mapping: { ...found.mapping, roles, fixedProjectId: knownFixed }, from: "profile", profileId: found.profile.id };
  }
  return { mapping: guessMapping(rows, known).mapping, from: "guess", profileId: null };
}

// ---------------------------------------------------------------- 下書きを読む・書く

type BatchRecord = typeof s.importBatches.$inferSelect;

async function getBatch(db: Db, tenantId: string, batchId: string): Promise<BatchRecord> {
  if (!/^[0-9a-f-]{36}$/i.test(batchId)) throw new UserError("取り込みが見つかりません");
  const rows = await db
    .select()
    .from(s.importBatches)
    .where(and(eq(s.importBatches.id, batchId), eq(s.importBatches.tenantId, tenantId), eq(s.importBatches.kind, "work")))
    .limit(1);
  const b = rows[0];
  if (!b || (b.summary as { v?: number }).v !== 1) throw new UserError("取り込みが見つかりません");
  return b;
}

async function getDraft(db: Db, tenantId: string, batchId: string): Promise<{ batch: BatchRecord; summary: DraftSummary }> {
  const batch = await getBatch(db, tenantId, batchId);
  if (batch.status === "applied") throw new UserError("この取り込みは反映済みです。直すときは、取り消してから置き直してください");
  if (batch.status !== "draft") throw new UserError("この取り込みはやめたか、取り消し済みです。ファイルをもう一度置いてください");
  return { batch, summary: batch.summary as unknown as DraftSummary };
}

async function saveDraft(db: Db, tenantId: string, batchId: string, month: string, summary: DraftSummary, known?: Known): Promise<void> {
  const k = known ?? (await loadKnown(db, tenantId));
  summary.stats = statsOf(computeDraft(summary, month, k), k);
  await db
    .update(s.importBatches)
    .set({
      month,
      summary: summary as unknown as Record<string, unknown>,
      rowCount: summary.stats.records,
      mappingProfileId: summary.profileId,
    })
    .where(and(eq(s.importBatches.id, batchId), eq(s.importBatches.tenantId, tenantId), eq(s.importBatches.status, "draft")));
}

/** シートを切り替える（読み方は、覚えたものか推測でやり直す） */
export async function selectSheet(db: Db, tenantId: string, batchId: string, sheetIndex: number): Promise<void> {
  const { batch, summary } = await getDraft(db, tenantId, batchId);
  const sheet = summary.sheets[sheetIndex];
  if (!sheet) throw new UserError("そのシートは見つかりません");
  if (!sheet.rows) throw new UserError("このシートの中身は保存していません（ファイルが大きいため）。このシートだけにしたファイルを置いてください");
  const known = await loadKnown(db, tenantId);
  const { mapping, from, profileId } = readingFor(sheet.rows, known, await loadProfiles(db, tenantId));
  summary.sheetIndex = sheetIndex;
  summary.sheetFrom = "user";
  summary.mapping = mapping;
  summary.mappingFrom = from;
  summary.profileId = profileId;
  summary.signature = shapeSignature(effectiveHeader(sheet.rows, mapping.headerRow, mapping.headerDepth));
  summary.skip = { drivers: [], projects: [] };
  // 月は、利用者が選んだのでなければ、そのシートから読み直す（「9月」のシートから「10月」のシートに替えたとき）
  let month = batch.month;
  if (summary.monthFrom !== "user") {
    const sheetHint = summary.file.encoding === "xlsx" ? { name: sheet.name, near: batch.month } : undefined;
    const guess = suggestMonth(sheet.rows, mapping, summary.file.name, sheetHint);
    if (guess) {
      month = guess.month;
      summary.monthFrom = guess.from;
    }
  }
  await saveDraft(db, tenantId, batchId, month, summary, known);
}

/** 見出しの行を選び直す（列の役目は推測し直す） */
export async function setHeaderRow(db: Db, tenantId: string, batchId: string, headerRow: number): Promise<void> {
  const { batch, summary } = await getDraft(db, tenantId, batchId);
  const rows = summary.sheets[summary.sheetIndex]?.rows;
  if (!rows) throw new UserError("このシートの中身は保存していません");
  if (!Number.isInteger(headerRow) || headerRow < 0 || headerRow >= rows.length - 1)
    throw new UserError("その行は選べません。見出しの行（その下にデータがある行）を選んでください");
  const known = await loadKnown(db, tenantId);
  const g = guessMapping(rows, known, { headerRow });
  summary.mapping = { ...g.mapping, fixedProjectId: summary.mapping.fixedProjectId };
  summary.mappingFrom = "user";
  summary.signature = shapeSignature(g.header);
  await saveDraft(db, tenantId, batchId, batch.month, summary, known);
}

export type MappingInput = { roles: ColumnRole[]; fixedProjectId: string | null; useDates: boolean; remember: boolean };

/** 列の役目を決める。remember なら、同じ形のファイルに次から使う */
export async function updateMapping(db: Db, tenantId: string, batchId: string, input: MappingInput): Promise<{ problem: string | null }> {
  const { batch, summary } = await getDraft(db, tenantId, batchId);
  const rows = summary.sheets[summary.sheetIndex]?.rows;
  if (!rows) throw new UserError("このシートの中身は保存していません");
  const width = sheetWidth(rows);
  if (input.roles.length > width) throw new UserError("列の数が合いません。画面を読み直してください");
  if (input.fixedProjectId) await assertProject(db, tenantId, input.fixedProjectId);
  const roles = [...input.roles];
  while (roles.length < width) roles.push("ignore");
  const mapping: WorkMapping = { ...summary.mapping, roles, fixedProjectId: input.fixedProjectId, useDates: input.useDates };
  summary.mapping = mapping;
  summary.mappingFrom = "user";
  summary.remember = input.remember;
  const problem = mappingProblem(mapping);
  if (input.remember && !problem) {
    const header = effectiveHeader(rows, mapping.headerRow, mapping.headerDepth);
    summary.profileId = await upsertProfile(db, tenantId, summary, header);
  }
  await saveDraft(db, tenantId, batchId, batch.month, summary);
  return { problem };
}

/** 書き込む月を変える */
export async function setBatchMonth(db: Db, tenantId: string, batchId: string, month: string): Promise<void> {
  if (!/^\d{4}-(0[1-9]|1[0-2])-01$/.test(month)) throw new UserError("月の形が正しくありません");
  const { summary } = await getDraft(db, tenantId, batchId);
  summary.monthFrom = "user";
  await saveDraft(db, tenantId, batchId, month, summary);
}

/** 下書きをやめる（消さずに「やめた」として残す） */
export async function discardDraft(db: Db, tenantId: string, user: ImportUser, batchId: string): Promise<void> {
  const { summary } = await getDraft(db, tenantId, batchId);
  summary.discarded = { at: new Date().toISOString(), by: user.id, reason: "cancel" };
  await db
    .update(s.importBatches)
    .set({ status: "discarded", summary: summary as unknown as Record<string, unknown> })
    .where(and(eq(s.importBatches.id, batchId), eq(s.importBatches.tenantId, tenantId), eq(s.importBatches.status, "draft")));
}

// ---------------------------------------------------------------- 名前を決める

async function assertDriver(db: Db, tenantId: string, id: string) {
  if (!/^[0-9a-f-]{36}$/i.test(id)) throw new UserError("選んだドライバーが見つかりません");
  const rows = await db
    .select()
    .from(s.drivers)
    .where(and(eq(s.drivers.id, id), eq(s.drivers.tenantId, tenantId)))
    .limit(1);
  if (!rows[0]) throw new UserError("選んだドライバーが見つかりません");
  return rows[0];
}

async function assertProject(db: Db, tenantId: string, id: string) {
  if (!/^[0-9a-f-]{36}$/i.test(id)) throw new UserError("選んだ案件が見つかりません");
  const rows = await db
    .select()
    .from(s.projects)
    .where(and(eq(s.projects.id, id), eq(s.projects.tenantId, tenantId)))
    .limit(1);
  if (!rows[0]) throw new UserError("選んだ案件が見つかりません");
  return rows[0];
}

/** 空白・全角半角・大文字小文字を無視して比べる形 */
function looseText(v: string): string {
  return v.normalize("NFKC").toLowerCase().replace(/\s/g, "");
}

/** 別名に足す（同じ書き方がもう名前・別名にあれば足さない） */
function withAliases(name: string, aliases: string[], spellings: string[]): string[] {
  const loose = looseText;
  const have = new Set([name, ...aliases].map(loose));
  const out = [...aliases];
  for (const sp of spellings) {
    const v = sp.trim();
    if (!v || have.has(loose(v))) continue;
    have.add(loose(v));
    out.push(v);
  }
  return out;
}

export type ResolveInput =
  | { kind: "driver" | "project"; key: string; action: "match"; targetId: string }
  | { kind: "driver" | "project"; key: string; action: "skip" }
  | { kind: "driver" | "project"; key: string; action: "unskip" }
  | { kind: "driver"; key: string; action: "create"; name: string; kana: string | null; code: string | null }
  | { kind: "project"; key: string; action: "create"; name: string; unit: string; billRate: number; payRate: number; clientId: string | null };

/**
 * 名前を決める：候補を選ぶ（その書き方を別名として覚える）・新しく登録する・取り込まない。
 * 返し値は画面に出す一言。
 */
export async function resolveName(db: Db, tenantId: string, batchId: string, input: ResolveInput): Promise<{ message: string; learned?: Learned }> {
  const { batch, summary } = await getDraft(db, tenantId, batchId);
  const known = await loadKnown(db, tenantId);
  const computed = computeDraft(summary, batch.month, known);
  const groups = input.kind === "driver" ? computed.resolution.drivers : computed.resolution.projects;
  const g = groups.find((x) => x.key === input.key);
  if (!g) throw new UserError("この名前はもう表にありません。画面を読み直してください");
  const spellings = g.spellings.filter(Boolean);
  const list = input.kind === "driver" ? summary.skip.drivers : summary.skip.projects;

  if (input.action === "skip" || input.action === "unskip") {
    const next = list.filter((k) => k !== g.key);
    if (input.action === "skip") next.push(g.key);
    if (input.kind === "driver") summary.skip.drivers = next;
    else summary.skip.projects = next;
    await saveDraft(db, tenantId, batchId, batch.month, summary);
    return { message: input.action === "skip" ? `「${g.raw}」の行（${g.rows}行）は取り込みません` : `「${g.raw}」を取り込む対象に戻しました` };
  }

  let learned: Learned;
  if (input.action === "match") {
    if (input.kind === "driver") {
      const d = await assertDriver(db, tenantId, input.targetId);
      await db
        .update(s.drivers)
        .set({ aliases: withAliases(d.name, d.aliases, spellings), updatedAt: new Date() })
        .where(and(eq(s.drivers.id, d.id), eq(s.drivers.tenantId, tenantId)));
      learned = { kind: "driver", raw: g.raw, id: d.id, name: d.name, how: "alias" };
    } else {
      const p = await assertProject(db, tenantId, input.targetId);
      await db
        .update(s.projects)
        .set({ aliases: withAliases(p.name, p.aliases, spellings) })
        .where(and(eq(s.projects.id, p.id), eq(s.projects.tenantId, tenantId)));
      learned = { kind: "project", raw: g.raw, id: p.id, name: p.name, how: "alias" };
    }
  } else if (input.kind === "driver") {
    const name = input.name.trim();
    if (!name) throw new UserError("名前を入れてください");
    const code = input.code?.trim() || null;
    // 同じ人を 2 回登録しない（明細・振込が 2 つに分かれてしまう）
    if (code) {
      const owner = known.drivers.find((d) => d.code && looseText(d.code) === looseText(code));
      if (owner) throw new UserError(`番号「${code}」は、もう「${owner.name}」さんに使っています。別の番号にするか、上の候補から選んでください`);
    }
    const same = known.drivers.find((d) => looseText(d.name) === looseText(name));
    if (same && !code) {
      throw new UserError(`「${same.name}」さんはもう台帳にいます。上の候補から選んでください（同じ名前の別の方なら、社内の番号も入れて登録してください）`);
    }
    const [d] = await db
      .insert(s.drivers)
      .values({ tenantId, name, kana: input.kana?.trim() || null, code, aliases: withAliases(name, [], spellings) })
      .returning({ id: s.drivers.id, name: s.drivers.name });
    learned = { kind: "driver", raw: g.raw, id: d.id, name: d.name, how: "new" };
  } else {
    const name = input.name.trim();
    if (!name) throw new UserError("案件の名前を入れてください");
    const same = known.projects.find((p) => looseText(p.name) === looseText(name));
    if (same) throw new UserError(`「${same.name}」はもう台帳にあります。上の候補から選んでください（選ぶと、この書き方を覚えます）`);
    if (input.clientId) {
      const c = await db
        .select({ id: s.clients.id })
        .from(s.clients)
        .where(and(eq(s.clients.id, input.clientId), eq(s.clients.tenantId, tenantId)))
        .limit(1);
      if (!c[0]) throw new UserError("選んだ元請が見つかりません");
    }
    const [p] = await db
      .insert(s.projects)
      .values({
        tenantId,
        name,
        unit: input.unit.trim() || "個",
        billRate: input.billRate,
        payRate: input.payRate,
        clientId: input.clientId,
        aliases: withAliases(name, [], spellings),
      })
      .returning({ id: s.projects.id, name: s.projects.name });
    learned = { kind: "project", raw: g.raw, id: p.id, name: p.name, how: "new" };
  }
  // 取り込まないにしていたら戻す
  if (input.kind === "driver") summary.skip.drivers = summary.skip.drivers.filter((k) => k !== g.key);
  else summary.skip.projects = summary.skip.projects.filter((k) => k !== g.key);
  summary.learned = [...summary.learned.filter((l) => !(l.kind === learned.kind && l.raw === learned.raw)), learned];
  await saveDraft(db, tenantId, batchId, batch.month, summary);
  return {
    message:
      learned.how === "new"
        ? `「${learned.name}」を登録しました。来月からも同じ書き方で当たります`
        : `覚えました。「${g.raw}」は来月から自動で「${learned.name}」になります`,
    learned,
  };
}

/**
 * 台帳に無いドライバーを、まとめて新しく登録する（初めての月に、何十人も 1 人ずつ登録しなくてよいように）。
 * 名前はファイルの書き方（末尾の括弧書きは外す）。番号の列があれば、その番号も入れる（ほかの人が使っていなければ）。
 * 口座・登録番号などは、あとで台帳から入れる。
 */
export async function registerAllDrivers(db: Db, tenantId: string, batchId: string): Promise<{ message: string; created: { id: string; name: string }[] }> {
  const { batch, summary } = await getDraft(db, tenantId, batchId);
  const known = await loadKnown(db, tenantId);
  const computed = computeDraft(summary, batch.month, known);
  if (computed.problem) throw new UserError("先に列の読み方を決めてください");
  const groups = registrableDrivers(computed.resolution);
  if (groups.length === 0) throw new UserError("まとめて登録できる名前はありません。画面を読み直してください");

  const usedCodes = new Set(known.drivers.flatMap((d) => (d.code ? [looseText(d.code)] : [])));
  const codeCount = new Map<string, number>();
  for (const g of groups) for (const c of g.codes) codeCount.set(looseText(c), (codeCount.get(looseText(c)) ?? 0) + 1);
  // 同じ名前（書き方の違いだけ）は 1 人にまとめる
  const byName = new Map<string, { name: string; code: string | null; spellings: string[]; raws: string[] }>();
  for (const g of groups) {
    const name = baseName(g.raw).slice(0, 60);
    if (!name || known.drivers.some((d) => looseText(d.name) === looseText(name))) continue;
    const code = g.codes.length === 1 && !usedCodes.has(looseText(g.codes[0])) && codeCount.get(looseText(g.codes[0])) === 1 ? g.codes[0].slice(0, 30) : null;
    const k = looseText(name);
    const x = byName.get(k) ?? { name, code, spellings: [], raws: [] };
    x.spellings.push(...g.spellings.filter(Boolean));
    x.raws.push(g.raw);
    if (!x.code && code) x.code = code;
    byName.set(k, x);
  }
  if (byName.size === 0) throw new UserError("まとめて登録できる名前はありません。1 人ずつ確かめてください");

  const created: { id: string; name: string }[] = [];
  const learned: Learned[] = [];
  await db.transaction(async (tx) => {
    const t = tx as unknown as Db;
    for (const x of byName.values()) {
      const [d] = await t
        .insert(s.drivers)
        .values({ tenantId, name: x.name, code: x.code, aliases: withAliases(x.name, [], x.spellings) })
        .returning({ id: s.drivers.id, name: s.drivers.name });
      created.push(d);
      for (const raw of x.raws) learned.push({ kind: "driver", raw, id: d.id, name: d.name, how: "new" });
    }
  });
  const raws = new Set(learned.map((l) => l.raw));
  summary.learned = [...summary.learned.filter((l) => !(l.kind === "driver" && raws.has(l.raw))), ...learned];
  await saveDraft(db, tenantId, batchId, batch.month, summary);
  return {
    message: `${created.length} 人を台帳に登録しました。来月からも同じ書き方で当たります。口座・インボイスの登録番号は、明細や振込の前に台帳で入れてください`,
    created,
  };
}

// ---------------------------------------------------------------- 確かめる（反映の前）

type EntryLite = { id: string; driverId: string; projectId: string; qty: number; workDate: string | null; note: string | null; importBatchId: string | null };
type AppliedBatchLite = {
  id: string;
  fileName: string;
  createdAt: Date;
  signature: string | null;
  hash: string | null;
  mappingProfileId: string | null;
  appliedAt: string | null;
  appliedBy: string | null;
};

/** 同じファイル（ハッシュが同じ）が、この月にもう反映されている */
export type SameFileInfo = {
  batchId: string;
  fileName: string;
  /** 反映した日時（無ければ置いた日時） */
  appliedAt: string;
  appliedByName: string | null;
  /** 前の取り込みで入っている稼働の行数 */
  entries: number;
  /** 二重に数えたときに多く払ってしまう額の目安（取り込む数量 × 支払単価。重なる分だけ） */
  yen: number;
};

const dayJa = new Intl.DateTimeFormat("ja-JP", { timeZone: "Asia/Tokyo", month: "long", day: "numeric" });

/** 「同じファイルがすでに反映されています（10月5日・山田さん）。二重に数えると ¥X 多く払うおそれがあります」 */
export function sameFileMessage(info: SameFileInfo): string {
  const when = dayJa.format(new Date(info.appliedAt));
  const who = info.appliedByName ? `・${info.appliedByName}さん` : "";
  return `同じファイルがすでに反映されています（${when}${who}）。二重に数えると ${yen(info.yen)} 多く払うおそれがあります`;
}

export type DuplicateRow = {
  driverId: string;
  driverName: string;
  projectId: string;
  projectName: string;
  unit: string;
  newQty: number;
  existingQty: number;
  /** すでにある分の出どころ（手入力・ファイル名） */
  sources: string[];
  /** 二重だったときに多く払ってしまう額の目安（取り込む数量 × 支払単価） */
  yen: number;
};

export type StatementDiff = { driverId: string; name: string; beforeSubtotal: number; afterSubtotal: number; beforeTotal: number; afterTotal: number };

export type ModeOption = {
  mode: ApplyMode;
  /** 消える稼働の行数と、その出どころ */
  removeEntries: number;
  removeBatches: { id: string; fileName: string; createdAt: Date; entries: number }[];
  removeManual: number;
  /** 同じ形でも、中身が重ならないので残す取り込み（ファイル名） */
  keptSameShape: string[];
  duplicates: DuplicateRow[];
  duplicateYen: number;
  /** 同じファイルがすでに反映されている（足すと倍になる） */
  sameFileApplied: boolean;
};

export type DraftView = {
  batch: {
    id: string;
    month: string;
    status: string;
    fileName: string;
    createdAt: Date;
    createdByName: string | null;
    rowCount: number;
  };
  summary: DraftSummary;
  computed: Computed;
  known: Known;
  closed: boolean;
  stats: BatchStats;
  /** 取り込む分の合計 */
  totals: ReturnType<typeof totalsOf>;
  /** 反映の前の確かめ（下書きのときだけ） */
  preview: {
    modes: Record<ApplyMode, ModeOption>;
    mode: ApplyMode;
    /** 何も選んでいないときの入れ替え方 */
    suggested: ApplyMode;
    compare: CompareRow[];
    statements: StatementDiff[];
    unchangedStatements: number;
    prevMonth: string;
    /** 同じファイルが反映済みのとき：「取り消して入れ直す」の中身（前の取り込みと入れ替える） */
    reapply: ModeOption | null;
  } | null;
  /** 反映済みのとき：この取り込みで入っている稼働（いまの DB） */
  appliedTotals: ReturnType<typeof totalsOf> | null;
  appliedEntries: number;
  blockers: string[];
  /** 取り込みで作られた・入れ替えた相手（反映済み・取り消し済みの説明に使う） */
  related: { id: string; fileName: string; status: string }[];
  /** 同じファイルがこの月にもう反映されている（下書きのとき） */
  sameFile: SameFileInfo | null;
  /** 同じファイルが別の月に反映されている（月の選び間違いのおそれ） */
  sameFileOtherMonths: { batchId: string; month: string; fileName: string }[];
  /** ファイルの金額の列から分かったこと（振込額・控除の提案・振込手数料）。読み方と名前が決まってから */
  extras: MoneyExtras | null;
};

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

async function userName(db: Db, tenantId: string, id: string | null): Promise<string | null> {
  if (!id || !UUID_RE.test(id)) return null;
  const rows = await db
    .select({ name: s.users.name })
    .from(s.users)
    .where(and(eq(s.users.id, id), eq(s.users.tenantId, tenantId)))
    .limit(1);
  return rows[0]?.name ?? null;
}

/** 同じファイル（ハッシュが同じ）の、この月に反映済みの取り込み。二重に数えたときの額は、重なる分の数量 × 支払単価 */
async function sameFileOf(
  db: Db,
  tenantId: string,
  batchId: string,
  summary: DraftSummary,
  entries: EntryLite[],
  applied: AppliedBatchLite[],
  resolved: ResolvedRecord[],
  known: Known,
  input: BuildInput,
): Promise<{ info: SameFileInfo; ids: Set<string> } | null> {
  const same = applied.filter((b) => b.id !== batchId && !!b.hash && b.hash === summary.file.hash);
  if (same.length === 0) return null;
  const when = (b: AppliedBatchLite) => b.appliedAt ?? b.createdAt.toISOString();
  const latest = [...same].sort((a, b) => when(b).localeCompare(when(a)))[0];
  const ids = new Set(same.map((b) => b.id));
  const theirs = entries.filter((e) => e.importBatchId && ids.has(e.importBatchId));
  const dups = findDuplicates(resolved, theirs, known, () => latest.fileName, input);
  return {
    info: {
      batchId: latest.id,
      fileName: latest.fileName,
      appliedAt: when(latest),
      appliedByName: await userName(db, tenantId, latest.appliedBy),
      entries: theirs.length,
      yen: dups.reduce((a, d) => a + d.yen, 0),
    },
    ids,
  };
}

function entryKey(e: { driverId: string; projectId: string }): string {
  return `${e.driverId}:${e.projectId}`;
}

/** 今ある稼働（消さずに残る分）と、取り込む分が重なるところ */
function findDuplicates(
  newRecs: ResolvedRecord[],
  remaining: EntryLite[],
  known: Known,
  sourceName: (e: EntryLite) => string,
  input: BuildInput,
): DuplicateRow[] {
  const existing = new Map<string, { qty: number; undated: boolean; dates: Set<string>; sources: Set<string> }>();
  for (const e of remaining) {
    const k = entryKey(e);
    const x = existing.get(k) ?? { qty: 0, undated: false, dates: new Set<string>(), sources: new Set<string>() };
    x.qty = Math.round((x.qty + e.qty) * 1e4) / 1e4;
    if (e.workDate) x.dates.add(e.workDate);
    else x.undated = true;
    x.sources.add(sourceName(e));
    existing.set(k, x);
  }
  const incoming = new Map<string, { qty: number; undated: boolean; dates: Set<string> }>();
  for (const r of newRecs) {
    const k = entryKey(r);
    const x = incoming.get(k) ?? { qty: 0, undated: false, dates: new Set<string>() };
    x.qty = Math.round((x.qty + r.qty) * 1e4) / 1e4;
    if (r.date) x.dates.add(r.date);
    else x.undated = true;
    incoming.set(k, x);
  }
  const dName = new Map(known.drivers.map((d) => [d.id, d.name]));
  const pInfo = new Map(input.projects.map((p) => [p.id, p]));
  const override = new Map(input.overrides.map((o) => [`${o.driverId}:${o.projectId}`, o.payRate]));
  const out: DuplicateRow[] = [];
  for (const [k, inc] of incoming) {
    const ex = existing.get(k);
    if (!ex) continue;
    const overlap = inc.undated || ex.undated || [...inc.dates].some((d) => ex.dates.has(d));
    if (!overlap) continue;
    const [driverId, projectId] = k.split(":");
    const p = pInfo.get(projectId);
    const rate = override.get(k) ?? p?.payRate ?? 0;
    out.push({
      driverId,
      driverName: dName.get(driverId) ?? "",
      projectId,
      projectName: p?.name ?? "",
      unit: p?.unit ?? "",
      newQty: inc.qty,
      existingQty: ex.qty,
      sources: [...ex.sources],
      yen: roundYen(rate * Math.min(inc.qty, ex.qty), input.tenant.amountRounding),
    });
  }
  return out.sort((a, b) => a.driverName.localeCompare(b.driverName, "ja"));
}

async function monthEntries(db: Db, tenantId: string, month: string): Promise<EntryLite[]> {
  return db
    .select({
      id: s.workEntries.id,
      driverId: s.workEntries.driverId,
      projectId: s.workEntries.projectId,
      qty: s.workEntries.qty,
      workDate: s.workEntries.workDate,
      note: s.workEntries.note,
      importBatchId: s.workEntries.importBatchId,
    })
    .from(s.workEntries)
    .where(and(eq(s.workEntries.tenantId, tenantId), eq(s.workEntries.month, month)));
}

async function appliedBatches(db: Db, tenantId: string, month: string): Promise<AppliedBatchLite[]> {
  return db
    .select({
      id: s.importBatches.id,
      fileName: s.importBatches.fileName,
      createdAt: s.importBatches.createdAt,
      signature: sql<string | null>`${s.importBatches.summary}->>'signature'`,
      hash: sql<string | null>`coalesce(${s.importBatches.fileHash}, ${s.importBatches.summary}->'file'->>'hash')`,
      mappingProfileId: s.importBatches.mappingProfileId,
      appliedAt: sql<string | null>`${s.importBatches.summary}->'applied'->>'at'`,
      appliedBy: sql<string | null>`${s.importBatches.summary}->'applied'->>'by'`,
    })
    .from(s.importBatches)
    .where(
      and(eq(s.importBatches.tenantId, tenantId), eq(s.importBatches.month, month), eq(s.importBatches.kind, "work"), eq(s.importBatches.status, "applied")),
    );
}

/**
 * 入れ替え方ごとに、消える稼働と入れ替える相手。
 * 「同じ形」でも、中身（ドライバー × 案件）が 1 つも重ならないファイルは別のもの（元請ごとに同じひな形 など）とみなして残す。
 */
function removalFor(
  mode: ApplyMode,
  selfId: string,
  summary: DraftSummary,
  entries: EntryLite[],
  applied: AppliedBatchLite[],
  resolved: ResolvedRecord[],
  /** 必ず入れ替える取り込み（「取り消して入れ直す」の同じファイル） */
  force: Set<string> = new Set(),
): { removed: EntryLite[]; batches: AppliedBatchLite[]; kept: AppliedBatchLite[] } {
  if (mode === "add") return { removed: [], batches: [], kept: [] };
  if (mode === "replaceAll") return { removed: entries, batches: applied.filter((b) => b.id !== selfId), kept: [] };
  const newPairs = new Set(resolved.map(entryKey));
  const shape = applied.filter(
    (b) =>
      b.id !== selfId && (force.has(b.id) || b.signature === summary.signature || (!!summary.profileId && b.mappingProfileId === summary.profileId)),
  );
  const overlaps = (b: AppliedBatchLite) =>
    force.has(b.id) || b.hash === summary.file.hash || entries.some((e) => e.importBatchId === b.id && newPairs.has(entryKey(e)));
  const same = shape.filter(overlaps);
  const ids = new Set(same.map((b) => b.id));
  return { removed: entries.filter((e) => e.importBatchId && ids.has(e.importBatchId)), batches: same, kept: shape.filter((b) => !ids.has(b.id)) };
}

function modeOption(
  mode: ApplyMode,
  batchId: string,
  summary: DraftSummary,
  entries: EntryLite[],
  applied: AppliedBatchLite[],
  resolved: ResolvedRecord[],
  known: Known,
  input: BuildInput,
  force: Set<string> = new Set(),
): ModeOption {
  const { removed, batches, kept } = removalFor(mode, batchId, summary, entries, applied, resolved, force);
  const removedIds = new Set(removed.map((e) => e.id));
  const remaining = entries.filter((e) => !removedIds.has(e.id));
  const fileName = new Map(applied.map((b) => [b.id, b.fileName]));
  const duplicates = findDuplicates(resolved, remaining, known, (e) => (e.importBatchId ? (fileName.get(e.importBatchId) ?? "前の取り込み") : "手入力"), input);
  const countBy = new Map<string, number>();
  for (const e of removed) if (e.importBatchId) countBy.set(e.importBatchId, (countBy.get(e.importBatchId) ?? 0) + 1);
  return {
    mode,
    removeEntries: removed.length,
    removeBatches: batches.map((b) => ({ id: b.id, fileName: b.fileName, createdAt: b.createdAt, entries: countBy.get(b.id) ?? 0 })),
    removeManual: removed.filter((e) => !e.importBatchId).length,
    keptSameShape: kept.map((b) => b.fileName),
    duplicates,
    duplicateYen: duplicates.reduce((a, d) => a + d.yen, 0),
    sameFileApplied: mode === "add" && applied.some((b) => b.id !== batchId && b.hash === summary.file.hash),
  };
}

/** 入れ替えで消えずに残る稼働のうち、取り込む分と重なる行の数 */
function coveredCount(option: ModeOption, entries: EntryLite[], removeBatches: { id: string }[]): number {
  const removed = new Set(removeBatches.map((b) => b.id));
  const dupPairs = new Set(option.duplicates.map((d) => `${d.driverId}:${d.projectId}`));
  return entries.filter((e) => !(e.importBatchId && removed.has(e.importBatchId)) && dupPairs.has(entryKey(e))).length;
}

export function isApplyMode(v: unknown): v is ApplyMode {
  return v === "replace" || v === "replaceAll" || v === "add";
}

/** 取り込みの画面に出すもの一式 */
export async function loadDraftView(db: Db, tenantId: string, batchId: string, opts: { mode?: ApplyMode } = {}): Promise<DraftView | null> {
  let batch: BatchRecord;
  try {
    batch = await getBatch(db, tenantId, batchId);
  } catch {
    return null;
  }
  const summary = batch.summary as unknown as DraftSummary;
  const known = await loadKnown(db, tenantId);
  const computed = computeDraft(summary, batch.month, known);
  const closed = await isMonthClosed(db, tenantId, batch.month);
  const stats = statsOf(computed, known);
  const creator = batch.createdBy
    ? await db
        .select({ name: s.users.name })
        .from(s.users)
        .where(and(eq(s.users.id, batch.createdBy), eq(s.users.tenantId, tenantId)))
        .limit(1)
    : [];

  const blockers: string[] = [];
  let preview: DraftView["preview"] = null;
  let appliedTotals: DraftView["appliedTotals"] = null;
  let appliedEntries = 0;
  let sameFile: SameFileInfo | null = null;
  let sameFileOtherMonths: DraftView["sameFileOtherMonths"] = [];
  let extras: MoneyExtras | null = null;

  if (batch.status === "draft") {
    if (closed) blockers.push(`${monthLabelJa(batch.month)}は締め済みです。この月には取り込めません（直すときは、オーナーが「締め」の画面で締めを外してから）`);
    if (computed.problem) blockers.push(computed.problem);
    else if (computed.resolution.unresolvedRecords > 0)
      blockers.push(
        `名前が決まっていない行（名前の一部だけで当たった行を含む）が ${computed.resolution.unresolvedRecords} 行あります。上の「名前の確認」で選んでください`,
      );
    else if (computed.resolution.resolved.length === 0) blockers.push("取り込める行がありません。読み方と、取り込まない名前を確かめてください");

    const [entries, applied, input, prev, others] = await Promise.all([
      monthEntries(db, tenantId, batch.month),
      appliedBatches(db, tenantId, batch.month),
      loadBuildInput(db, tenantId, batch.month),
      monthEntries(db, tenantId, shiftMonth(batch.month, -1)),
      sameHashOtherMonths(db, tenantId, batch.month, summary.file.hash),
    ]);
    sameFileOtherMonths = others;
    const resolved = computed.resolution.resolved;
    const same = await sameFileOf(db, tenantId, batch.id, summary, entries, applied, resolved, known, input);
    sameFile = same?.info ?? null;
    const modes = {
      replace: modeOption("replace", batch.id, summary, entries, applied, resolved, known, input),
      replaceAll: modeOption("replaceAll", batch.id, summary, entries, applied, resolved, known, input),
      add: modeOption("add", batch.id, summary, entries, applied, resolved, known, input),
    };
    // 同じファイルが反映済み：前の取り込みと入れ替える（取り消して入れ直す）ことだけを出す
    const reapply = same ? modeOption("replace", batch.id, summary, entries, applied, resolved, known, input, same.ids) : null;
    // 今ある稼働がすべてこのファイルと重なっているなら、「すべて入れ替える」を先に選んでおく（丸ごと出し直したファイル）
    const suggested: ApplyMode =
      modes.replace.duplicates.length > 0 && modes.replace.removeEntries + coveredCount(modes.replace, entries, modes.replace.removeBatches) === entries.length
        ? "replaceAll"
        : "replace";
    const mode = opts.mode ?? suggested;
    const { removed } = same ? removalFor("replace", batch.id, summary, entries, applied, resolved, same.ids) : removalFor(mode, batch.id, summary, entries, applied, resolved);
    const removedIds = new Set(removed.map((e) => e.id));
    // 反映したあとの稼働（日付も持たせる：明細の計算が日付を使うようになっても、そのまま同じ結果になるように）
    const after = [
      ...entries.filter((e) => !removedIds.has(e.id)).map((e) => ({ driverId: e.driverId, projectId: e.projectId, qty: e.qty, workDate: e.workDate })),
      ...resolved.map((r) => ({ driverId: r.driverId, projectId: r.projectId, qty: r.qty, workDate: r.date })),
    ];
    const before = buildStatementDrafts(input);
    const afterDrafts = buildStatementDrafts({ ...input, work: after });
    const b = new Map(before.map((d) => [d.driverId, d]));
    const a = new Map(afterDrafts.map((d) => [d.driverId, d]));
    const ids = new Set([...b.keys(), ...a.keys()]);
    const statements: StatementDiff[] = [];
    let unchanged = 0;
    for (const id of ids) {
      const x = b.get(id);
      const y = a.get(id);
      const row = {
        driverId: id,
        name: y?.driver.name ?? x?.driver.name ?? "",
        beforeSubtotal: x?.subtotal ?? 0,
        afterSubtotal: y?.subtotal ?? 0,
        beforeTotal: x?.total ?? 0,
        afterTotal: y?.total ?? 0,
      };
      if (row.beforeSubtotal === row.afterSubtotal && row.beforeTotal === row.afterTotal) unchanged++;
      else statements.push(row);
    }
    statements.sort((p, q) => p.name.localeCompare(q.name, "ja"));
    preview = {
      modes,
      mode,
      suggested,
      compare: compareWithPrev(after, prev, known),
      statements,
      unchangedStatements: unchanged,
      prevMonth: shiftMonth(batch.month, -1),
      reapply,
    };
    // 金額の列（振込額・控除・振込手数料）：読み方と名前が決まってから読む
    if (!computed.problem && computed.resolution.unresolvedRecords === 0 && resolved.length > 0) {
      extras = moneyExtras({
        rows: computed.rows,
        mapping: summary.mapping,
        header: computed.header,
        resolved,
        names: new Map(known.drivers.map((d) => [d.id, d.name])),
        bases: afterDrafts.map((d) => ({ driverId: d.driverId, subtotal: d.subtotal, qty: d.lines.reduce((a, l) => a + l.qty, 0) })),
        rules: input.rules.map((r) => ({
          id: r.id,
          driverId: r.driverId,
          name: r.name,
          kind: r.kind,
          rate: r.rate,
          amount: r.amount,
          active: r.active,
          agreedInWriting: r.agreedInWriting,
        })),
      });
    }
  } else {
    const rows = await db
      .select({ driverId: s.workEntries.driverId, projectId: s.workEntries.projectId, qty: s.workEntries.qty })
      .from(s.workEntries)
      .where(and(eq(s.workEntries.tenantId, tenantId), eq(s.workEntries.importBatchId, batch.id)));
    appliedEntries = rows.length;
    appliedTotals = totalsOf(rows, known);
    if (batch.status === "applied" && closed) blockers.push(`${monthLabelJa(batch.month)}は締め済みなので、取り消せません`);
  }

  // 入れ替えた相手・入れ替えられた相手
  const relatedIds = [...(summary.applied?.replacedBatchIds ?? []), ...(summary.discarded?.replacedBy ? [summary.discarded.replacedBy] : [])];
  const related = relatedIds.length
    ? await db
        .select({ id: s.importBatches.id, fileName: s.importBatches.fileName, status: s.importBatches.status })
        .from(s.importBatches)
        .where(and(eq(s.importBatches.tenantId, tenantId), inArray(s.importBatches.id, relatedIds)))
    : [];

  return {
    batch: {
      id: batch.id,
      month: batch.month,
      status: batch.status,
      fileName: batch.fileName,
      createdAt: batch.createdAt,
      createdByName: creator[0]?.name ?? null,
      rowCount: batch.rowCount,
    },
    summary,
    computed,
    known,
    closed,
    stats,
    totals: totalsOf(computed.resolution.resolved, known),
    preview,
    appliedTotals,
    appliedEntries,
    blockers,
    related,
    sameFile,
    sameFileOtherMonths,
    extras,
  };
}

/** 同じファイルが、ほかの月に反映されていないか（月の選び間違いに気づくため） */
async function sameHashOtherMonths(db: Db, tenantId: string, month: string, hash: string): Promise<DraftView["sameFileOtherMonths"]> {
  if (!hash) return [];
  const rows = await db
    .select({ batchId: s.importBatches.id, month: s.importBatches.month, fileName: s.importBatches.fileName })
    .from(s.importBatches)
    .where(
      and(
        eq(s.importBatches.tenantId, tenantId),
        eq(s.importBatches.kind, "work"),
        eq(s.importBatches.status, "applied"),
        ne(s.importBatches.month, month),
        or(eq(s.importBatches.fileHash, hash), sql`${s.importBatches.summary}->'file'->>'hash' = ${hash}`),
      ),
    )
    .orderBy(desc(s.importBatches.createdAt))
    .limit(5);
  return rows;
}

// ---------------------------------------------------------------- 反映・取り消し

async function upsertProfile(db: Db, tenantId: string, summary: DraftSummary, header: string[]): Promise<string> {
  const base = profileData(header, summary.mapping);
  // 元の見出し（並び・書き方）も覚える（「Excel に戻す」で同じ列の並びにするため）
  const data = { mapping: base.mapping, options: { ...base.options, labels: header } };
  const existing = await db
    .select({ id: s.mappingProfiles.id })
    .from(s.mappingProfiles)
    .where(and(eq(s.mappingProfiles.tenantId, tenantId), eq(s.mappingProfiles.kind, "work"), eq(s.mappingProfiles.headerSignature, summary.signature)))
    .limit(1);
  if (existing[0]) {
    await db
      .update(s.mappingProfiles)
      .set({ mapping: data.mapping, options: data.options, updatedAt: new Date() })
      .where(and(eq(s.mappingProfiles.id, existing[0].id), eq(s.mappingProfiles.tenantId, tenantId)));
    return existing[0].id;
  }
  const [p] = await db
    .insert(s.mappingProfiles)
    .values({
      tenantId,
      kind: "work",
      name: summary.file.name.replace(/\.[^.]+$/, "").slice(0, 80) || "稼働の表",
      headerSignature: summary.signature,
      mapping: data.mapping,
      options: data.options,
    })
    .returning({ id: s.mappingProfiles.id });
  return p.id;
}

export type ApplyResult = {
  entries: number;
  removedEntries: number;
  replacedBatches: number;
  month: string;
  /** 「取り消して入れ直す」で入れ替えた同じファイルの取り込み */
  reappliedFrom?: string[];
  /** ファイルの振込額の列を、並行運用の比べ合わせに入れた結果 */
  payouts?: PayoutSaved;
};

/**
 * 反映：稼働（work_entries）に書く。
 * - replace（既定）：同じ月に反映済みの「同じ形のファイル」の取り込みの行を消してから書く（直したファイルを置き直しても倍にならない）
 * - replaceAll：その月の稼働をすべて消してから書く（手入力の分も）
 * - add：今ある稼働に足す
 * 同じファイル（ハッシュが同じ）がこの月にもう反映されていれば、どのやり方でも止める。
 * reapply（「取り消して入れ直す」）のときだけ、その取り込みと入れ替えて入れる（取り消すと、前の取り込みに戻る）。
 * 消した行は、取り消しで戻せるように summary に残す。
 * ファイルに振込額の列（振込額・差引支給額 など）があれば、反映のあとで並行運用の比べ合わせに入れる（メモのある人は上書きしない）。
 */
export async function applyBatch(
  db: Db,
  tenantId: string,
  user: ImportUser,
  batchId: string,
  opts: { mode: ApplyMode; confirmDuplicates: boolean; reapply?: boolean },
): Promise<ApplyResult> {
  const { batch, summary } = await getDraft(db, tenantId, batchId);
  const month = batch.month;
  if (await isMonthClosed(db, tenantId, month)) {
    throw new UserError(`${monthLabelJa(month)}は締め済みです。この月には取り込めません（直すときは、オーナーが「締め」の画面で締めを外してから）`);
  }
  const known = await loadKnown(db, tenantId);
  const computed = computeDraft(summary, month, known);
  if (computed.problem) throw new UserError(computed.problem);
  if (computed.resolution.unresolvedRecords > 0) {
    throw new UserError(
      `名前が決まっていない行（名前の一部だけで当たった行を含む）が ${computed.resolution.unresolvedRecords} 行あります。「名前の確認」で選ぶか「取り込まない」にしてください`,
    );
  }
  const resolved = computed.resolution.resolved;
  if (resolved.length === 0) throw new UserError("取り込める行がありません");
  // 当たった人・案件がこの会社のものか（念のため、書く前にもう一度）
  const driverIds = new Set(known.drivers.map((d) => d.id));
  const projectIds = new Set(known.projects.map((p) => p.id));
  if (resolved.some((r) => !driverIds.has(r.driverId) || !projectIds.has(r.projectId)))
    throw new UserError("台帳に無いドライバーか案件があります。画面を読み直してください");

  const [entries, applied, input] = await Promise.all([
    monthEntries(db, tenantId, month),
    appliedBatches(db, tenantId, month),
    loadBuildInput(db, tenantId, month),
  ]);
  const same = await sameFileOf(db, tenantId, batch.id, summary, entries, applied, resolved, known, input);
  if (same && !opts.reapply) {
    throw new UserError(`${sameFileMessage(same.info)}。前の取り込みを取り消して入れ直すときは「取り消して入れ直す」を押してください`);
  }
  // 入れ直すときは、同じファイルの前の取り込みと入れ替える（手入力の分・別のファイルの分は残す）
  const mode: ApplyMode = same ? "replace" : opts.mode;
  const force = same?.ids ?? new Set<string>();
  const option = modeOption(mode, batch.id, summary, entries, applied, resolved, known, input, force);
  if (option.sameFileApplied) {
    throw new UserError("同じファイルがこの月にもう反映されています。足すと数量が倍になります。「入れ替える」を選んでください");
  }
  if (option.duplicates.length > 0 && !opts.confirmDuplicates) {
    const ex = option.duplicates
      .slice(0, 3)
      .map((d) => `${d.driverName}・${d.projectName}（${d.sources.join("・")}）`)
      .join("、");
    throw new UserError(
      `今ある稼働と重なる行があります（${ex}${option.duplicates.length > 3 ? ` ほか ${option.duplicates.length - 3} 件` : ""}）。二重の可能性 ${option.duplicateYen.toLocaleString("ja-JP")}円。入れ替えるか、重なっていないことを確かめてからチェックを付けてください`,
    );
  }
  const { removed, batches } = removalFor(mode, batch.id, summary, entries, applied, resolved, force);
  const now = new Date().toISOString();
  const rows = computed.rows;
  const header = effectiveHeader(rows, summary.mapping.headerRow, summary.mapping.headerDepth);

  await db.transaction(async (tx) => {
    const t = tx as unknown as Db;
    // 最初に「確認中 → 反映済み」に変える。2 つの画面から同時に押されても、2 回目はここで止まる（稼働が倍にならない）
    const claimed = await t
      .update(s.importBatches)
      .set({ status: "applied" })
      .where(and(eq(s.importBatches.id, batch.id), eq(s.importBatches.tenantId, tenantId), eq(s.importBatches.status, "draft")))
      .returning({ id: s.importBatches.id });
    if (!claimed[0]) throw new UserError("この取り込みは、ほかの画面からもう反映されたか、やめてあります。画面を読み直してください");
    if (removed.length > 0) {
      const ids = removed.map((e) => e.id);
      for (let i = 0; i < ids.length; i += INSERT_CHUNK) {
        await t.delete(s.workEntries).where(and(eq(s.workEntries.tenantId, tenantId), inArray(s.workEntries.id, ids.slice(i, i + INSERT_CHUNK))));
      }
    }
    for (const b of batches) {
      await t
        .update(s.importBatches)
        .set({
          status: "discarded",
          summary: sql`jsonb_set(${s.importBatches.summary}, '{discarded}', ${JSON.stringify({ at: now, by: user.id, reason: "replaced", replacedBy: batch.id })}::jsonb)`,
        })
        .where(and(eq(s.importBatches.id, b.id), eq(s.importBatches.tenantId, tenantId), eq(s.importBatches.status, "applied")));
    }
    const values = resolved.map((r) => ({
      tenantId,
      month,
      driverId: r.driverId,
      projectId: r.projectId,
      qty: r.qty,
      workDate: r.date,
      note: r.note ? r.note.slice(0, 500) : null,
      importBatchId: batch.id,
    }));
    for (let i = 0; i < values.length; i += INSERT_CHUNK) await t.insert(s.workEntries).values(values.slice(i, i + INSERT_CHUNK));

    // 「次から同じ読み方で読む」を外していなければ、この形を覚える（来月は置いて反映するだけ）
    if (summary.remember !== false) summary.profileId = await upsertProfile(t, tenantId, summary, header);
    summary.stats = statsOf(computed, known);
    summary.applied = {
      at: now,
      by: user.id,
      mode,
      ...(same ? { reappliedFrom: [...same.ids] } : {}),
      entries: values.length,
      replacedBatchIds: batches.map((b) => b.id),
      removed: removed.map<RestoreEntry>((e) => ({
        driverId: e.driverId,
        projectId: e.projectId,
        qty: e.qty,
        workDate: e.workDate,
        note: e.note,
        importBatchId: e.importBatchId,
      })),
    };
    await t
      .update(s.importBatches)
      .set({ status: "applied", rowCount: values.length, mappingProfileId: summary.profileId, summary: summary as unknown as Record<string, unknown> })
      .where(and(eq(s.importBatches.id, batch.id), eq(s.importBatches.tenantId, tenantId)));
  });

  // 今の Excel の振込額（振込額・差引支給額 などの列）を、並行運用の比べ合わせに入れる。うまくいかなくても反映はそのまま
  const payoutRead = readPayout(rows, summary.mapping, header, resolved, new Map(known.drivers.map((d) => [d.id, d.name])));
  let payouts: PayoutSaved | undefined;
  if (payoutRead && payoutRead.entries.length > 0) {
    payouts = await saveImportedPayouts(db, tenantId, month, payoutRead, user.id);
    await db
      .update(s.importBatches)
      .set({ summary: sql`jsonb_set(${s.importBatches.summary}, '{applied,payouts}', ${JSON.stringify(payouts)}::jsonb)` })
      .where(and(eq(s.importBatches.id, batch.id), eq(s.importBatches.tenantId, tenantId)));
  }
  return {
    entries: resolved.length,
    removedEntries: removed.length,
    replacedBatches: batches.length,
    month,
    ...(same ? { reappliedFrom: [...same.ids] } : {}),
    ...(payouts ? { payouts } : {}),
  };
}

/**
 * ファイルの振込額を、並行運用の比べ合わせ（parallel_checks）に入れる。
 * すでに理由のメモが付いている人は上書きしない（比べた結果の説明を消さないため）。
 */
export async function saveImportedPayouts(db: Db, tenantId: string, month: string, read: PayoutRead, userId: string | null): Promise<PayoutSaved> {
  const at = new Date().toISOString();
  const existing = await db
    .select({ driverId: s.parallelChecks.driverId, note: s.parallelChecks.note })
    .from(s.parallelChecks)
    .where(and(eq(s.parallelChecks.tenantId, tenantId), eq(s.parallelChecks.month, month)));
  const noted = new Set(existing.filter((e) => (e.note ?? "").trim() !== "").map((e) => e.driverId));
  const kept = read.entries.filter((e) => noted.has(e.driverId)).map((e) => e.name);
  const entries = read.entries.filter((e) => !noted.has(e.driverId));
  if (entries.length === 0) return { header: read.header, saved: 0, kept, at };
  try {
    const r = await saveParallelChecks(
      db,
      tenantId,
      month,
      entries.map((e) => ({ driverId: e.driverId, excelTotal: e.amount })),
      userId,
    );
    return { header: read.header, saved: r.saved, kept, at };
  } catch (error) {
    console.error("import payouts failed", error instanceof Error ? error.message : error);
    const message = error instanceof UserError ? error.message : "保存できませんでした";
    return { header: read.header, saved: 0, kept, at, error: message };
  }
}

/** 取り消し：この取り込みで入れた稼働を消し、入れ替えで消した稼働を戻す（締めた月はできない） */
export async function undoBatch(db: Db, tenantId: string, user: ImportUser, batchId: string): Promise<{ deleted: number; restored: number; month: string }> {
  const batch = await getBatch(db, tenantId, batchId);
  if (batch.status !== "applied") throw new UserError("反映済みの取り込みだけ取り消せます");
  if (await isMonthClosed(db, tenantId, batch.month)) {
    throw new UserError(`${monthLabelJa(batch.month)}は締め済みなので、取り消せません（直すときは、オーナーが締めを外してから）`);
  }
  const summary = batch.summary as unknown as DraftSummary;
  const known = await loadKnown(db, tenantId);
  const driverIds = new Set(known.drivers.map((d) => d.id));
  const projectIds = new Set(known.projects.map((p) => p.id));
  const now = new Date().toISOString();
  let deleted = 0;
  let restored = 0;

  await db.transaction(async (tx) => {
    const t = tx as unknown as Db;
    // 最初に「反映済み → 取り消し」に変える。同時に 2 回押されても、入れ替えた分を 2 回戻さない
    const claimed = await t
      .update(s.importBatches)
      .set({ status: "discarded" })
      .where(and(eq(s.importBatches.id, batch.id), eq(s.importBatches.tenantId, tenantId), eq(s.importBatches.status, "applied")))
      .returning({ id: s.importBatches.id });
    if (!claimed[0]) throw new UserError("この取り込みは、ほかの画面からもう取り消されています。画面を読み直してください");
    const gone = await t
      .delete(s.workEntries)
      .where(and(eq(s.workEntries.tenantId, tenantId), eq(s.workEntries.importBatchId, batch.id)))
      .returning({ id: s.workEntries.id });
    deleted = gone.length;

    // 入れ替えられた取り込みのうち、まだ「入れ替えで消えた」ままのものだけ戻す
    const replaced = summary.applied?.replacedBatchIds ?? [];
    const back = replaced.length
      ? await t
          .select({ id: s.importBatches.id, summary: s.importBatches.summary, status: s.importBatches.status })
          .from(s.importBatches)
          .where(and(eq(s.importBatches.tenantId, tenantId), inArray(s.importBatches.id, replaced)))
      : [];
    const revive = new Set(
      back.filter((b) => b.status === "discarded" && (b.summary as unknown as DraftSummary).discarded?.replacedBy === batch.id).map((b) => b.id),
    );
    const restore = (summary.applied?.removed ?? []).filter(
      (e) => driverIds.has(e.driverId) && projectIds.has(e.projectId) && (e.importBatchId === null || revive.has(e.importBatchId)),
    );
    for (let i = 0; i < restore.length; i += INSERT_CHUNK) {
      await t.insert(s.workEntries).values(restore.slice(i, i + INSERT_CHUNK).map((e) => ({ tenantId, month: batch.month, ...e })));
    }
    restored = restore.length;
    for (const id of revive) {
      await t
        .update(s.importBatches)
        .set({ status: "applied", summary: sql`${s.importBatches.summary} - 'discarded'` })
        .where(and(eq(s.importBatches.id, id), eq(s.importBatches.tenantId, tenantId)));
    }
    summary.discarded = { at: now, by: user.id, reason: "undo" };
    await t
      .update(s.importBatches)
      .set({ status: "discarded", summary: summary as unknown as Record<string, unknown> })
      .where(and(eq(s.importBatches.id, batch.id), eq(s.importBatches.tenantId, tenantId)));
  });
  return { deleted, restored, month: batch.month };
}

// ---------------------------------------------------------------- 履歴と、覚えた読み方

export type BatchRow = {
  id: string;
  month: string;
  fileName: string;
  status: string;
  rowCount: number;
  createdAt: Date;
  createdByName: string | null;
  stats: BatchStats | null;
  mappingFrom: string | null;
  appliedMode: ApplyMode | null;
  discardedReason: string | null;
  sample: boolean;
};

/** この画面で開ける形（DraftSummary v1）の取り込みだけ（ほかの機能が作った行は、開けないので出さない） */
function isDraftV1() {
  return sql`${s.importBatches.summary}->>'v' = '1'`;
}

function batchColumns() {
  return {
    id: s.importBatches.id,
    month: s.importBatches.month,
    fileName: s.importBatches.fileName,
    status: s.importBatches.status,
    rowCount: s.importBatches.rowCount,
    createdAt: s.importBatches.createdAt,
    createdBy: s.importBatches.createdBy,
    stats: sql<BatchStats | null>`${s.importBatches.summary}->'stats'`,
    mappingFrom: sql<string | null>`${s.importBatches.summary}->>'mappingFrom'`,
    appliedMode: sql<string | null>`${s.importBatches.summary}->'applied'->>'mode'`,
    discardedReason: sql<string | null>`${s.importBatches.summary}->'discarded'->>'reason'`,
    sample: sql<string | null>`${s.importBatches.summary}->'file'->>'sample'`,
  };
}

async function withNames(
  db: Db,
  tenantId: string,
  rows: (Omit<BatchRow, "createdByName" | "appliedMode" | "sample"> & { createdBy: string | null; appliedMode: string | null; sample: string | null })[],
): Promise<BatchRow[]> {
  const users = await db.select({ id: s.users.id, name: s.users.name }).from(s.users).where(eq(s.users.tenantId, tenantId));
  const name = new Map(users.map((u) => [u.id, u.name]));
  return rows.map(({ createdBy, appliedMode, sample, ...r }) => ({
    ...r,
    createdByName: createdBy ? (name.get(createdBy) ?? null) : null,
    appliedMode: isApplyMode(appliedMode) ? appliedMode : null,
    sample: sample === "true",
  }));
}

/** その月の取り込みの履歴（新しい順） */
export async function listBatches(db: Db, tenantId: string, month: string): Promise<BatchRow[]> {
  const rows = await db
    .select(batchColumns())
    .from(s.importBatches)
    .where(and(eq(s.importBatches.tenantId, tenantId), eq(s.importBatches.month, month), eq(s.importBatches.kind, "work"), isDraftV1()))
    .orderBy(desc(s.importBatches.createdAt));
  return withNames(db, tenantId, rows);
}

/** どの月でも、まだ確認中の下書き（途中で閉じたものを見失わないように） */
export async function listOpenDrafts(db: Db, tenantId: string): Promise<BatchRow[]> {
  const rows = await db
    .select(batchColumns())
    .from(s.importBatches)
    .where(and(eq(s.importBatches.tenantId, tenantId), eq(s.importBatches.kind, "work"), eq(s.importBatches.status, "draft"), isDraftV1()))
    .orderBy(desc(s.importBatches.createdAt))
    .limit(20);
  return withNames(db, tenantId, rows);
}

/** 元請の一覧（案件を新しく登録するときに選ぶ） */
export async function listClients(db: Db, tenantId: string): Promise<{ id: string; name: string }[]> {
  return db.select({ id: s.clients.id, name: s.clients.name }).from(s.clients).where(eq(s.clients.tenantId, tenantId)).orderBy(asc(s.clients.name));
}

export async function listProfiles(db: Db, tenantId: string) {
  return db
    .select({ id: s.mappingProfiles.id, name: s.mappingProfiles.name, updatedAt: s.mappingProfiles.updatedAt, options: s.mappingProfiles.options })
    .from(s.mappingProfiles)
    .where(and(eq(s.mappingProfiles.tenantId, tenantId), eq(s.mappingProfiles.kind, "work")))
    .orderBy(desc(s.mappingProfiles.updatedAt));
}

/** 覚えた読み方を忘れる（次に同じ形のファイルを置くと、推測からやり直す） */
export async function deleteProfile(db: Db, tenantId: string, profileId: string): Promise<string> {
  if (!/^[0-9a-f-]{36}$/i.test(profileId)) throw new UserError("見つかりません");
  const gone = await db
    .delete(s.mappingProfiles)
    .where(and(eq(s.mappingProfiles.id, profileId), eq(s.mappingProfiles.tenantId, tenantId), eq(s.mappingProfiles.kind, "work")))
    .returning({ name: s.mappingProfiles.name });
  if (!gone[0]) throw new UserError("見つかりません。画面を読み直してください");
  return gone[0].name;
}

/** 列の中身の例（読み方の画面に出す） */
export function columnSamples(rows: string[][], mapping: WorkMapping, limit = 3): string[][] {
  const width = sheetWidth(rows);
  const out: string[][] = Array.from({ length: width }, () => []);
  for (let i = mapping.headerRow + mapping.headerDepth; i < rows.length; i++) {
    const r = rows[i];
    for (let c = 0; c < width; c++) {
      const v = (r[c] ?? "").trim();
      if (v && out[c].length < limit && !out[c].includes(v)) out[c].push(v);
    }
    if (out.every((x) => x.length >= limit)) break;
  }
  return out;
}
