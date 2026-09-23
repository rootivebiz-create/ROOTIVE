import "server-only";
import { createHash } from "node:crypto";
import { and, desc, eq, sql } from "drizzle-orm";
import type { Db } from "~/db/client";
import * as s from "~/db/schema";
import { UserError } from "~/server/action";
import { audit } from "~/server/audit";
import { readTable, TableReadError } from "~/server/tabular";
import { keyedHash } from "~/server/tokens";
import {
  BANK_FIELD_LABEL,
  bankOfDriver,
  maskAccount,
  previewBankRows,
  readBankTable,
  rowsFromZengin,
  shownValue,
  type BankField,
  type BankFields,
  type BankInputRow,
  type BankPreviewRow,
  type BankSource,
  type LedgerDriver,
} from "./bank-read";
import { assertDemoUploadBudget, demoFileProblem } from "./demo-budget";
import { MAX_FILE_BYTES, MAX_FILE_LABEL } from "./types";
import { looksLikeZengin, parseZengin } from "./zengin-read";

/**
 * 口座の取り込み（口座一覧の Excel・CSV か、先月の全銀の振込ファイル）。
 * 流れ：ファイルを置く（下書き：import_batches kind='bank_accounts'）→ 台帳に当てて、変わるところを見せる → 選んだ人だけ台帳に書く。
 * - 見せないまま書かない：反映は下書きの画面からだけ。見たときの口座の目印と今の口座が違えば止める
 * - 書いた記録（driver.update）には前後の値を残す。口座番号は下 3 桁だけ
 * - 反映・取りやめのあとは、下書きに残した口座番号を下 3 桁だけにする（持ちすぎない）
 */

export const BANK_KIND = "bank_accounts";

export type BankDraft = {
  v: "bank-1";
  file: { name: string; size: number; hash: string; uploadedAt: string };
  source: BankSource;
  rows: BankInputRow[];
  /** ファイル全体の気になること（全銀のトレーラーの件数が合わない など） */
  problems: string[];
  /** 画面で「この人の口座」と選んだもの（行の番号 → ドライバー） */
  assign: Record<string, string>;
  applied?: { at: string; by: string | null; updated: number; created: number; drivers: { id: string; name: string; status: "new" | "changed" }[] };
  discarded?: { at: string; by: string | null };
};

export type BankView = {
  batch: { id: string; month: string; status: string; fileName: string; createdAt: Date; createdByName: string | null };
  draft: BankDraft;
  rows: BankPreviewRow[];
  counts: Record<BankPreviewRow["status"], number>;
  drivers: { id: string; name: string; code: string | null }[];
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * 見たときの口座の目印（会社ごとの鍵つきハッシュ。口座番号そのものは画面に出さない）。
 * 画面（ブラウザ）へ送る値なので、鍵なしの sha256 にしない（銀行・支店・名義が分かれば、番号を総当たりで割り出せるため）
 */
function seenOf(tenantId: string) {
  return (b: BankFields) =>
    keyedHash("bank-seen:v1", `bank-seen:${tenantId}|${b.bankCode}|${b.bankNameKana}|${b.branchCode}|${b.branchNameKana}|${b.accountType}|${b.accountNumber}|${b.holderKana}`).slice(0, 24);
}

async function ledger(db: Db, tenantId: string): Promise<LedgerDriver[]> {
  return db
    .select({
      id: s.drivers.id,
      name: s.drivers.name,
      code: s.drivers.code,
      kana: s.drivers.kana,
      aliases: s.drivers.aliases,
      active: s.drivers.active,
      bankCode: s.drivers.bankCode,
      bankNameKana: s.drivers.bankNameKana,
      branchCode: s.drivers.branchCode,
      branchNameKana: s.drivers.branchNameKana,
      accountType: s.drivers.accountType,
      accountNumber: s.drivers.accountNumber,
      holderKana: s.drivers.holderKana,
    })
    .from(s.drivers)
    .where(eq(s.drivers.tenantId, tenantId));
}

/** ファイルを読む：全銀の振込ファイルか、口座一覧の表か */
export async function readBankFile(fileName: string, bytes: Uint8Array): Promise<{ source: BankSource; rows: BankInputRow[]; problems: string[] }> {
  if (bytes.byteLength === 0) throw new UserError("ファイルが空です（0 バイト）。保存し直したファイルを置いてください");
  if (bytes.byteLength > MAX_FILE_BYTES) throw new UserError(`ファイルが大きすぎます（${MAX_FILE_LABEL} まで）。口座の列だけにした CSV にしてから置いてください`);
  if (looksLikeZengin(bytes)) {
    const z = parseZengin(bytes);
    if (z.records.length === 0) throw new UserError(`振込ファイルの中に振込先がありませんでした。${z.problems.join("。")}`);
    return {
      source: { kind: "zengin", typeLabel: z.kindLabel, transferDate: z.transferDate, count: z.records.length, total: z.records.reduce((a, r) => a + r.amount, 0) },
      rows: rowsFromZengin(z),
      problems: z.problems,
    };
  }
  const lower = fileName.toLowerCase();
  if (/\.(txt|dat|fb|zen)$/.test(lower)) {
    throw new UserError("全銀の振込ファイル（1 行 120 文字）として読めませんでした。銀行に出した振込ファイルそのものか、口座一覧の Excel・CSV を置いてください");
  }
  let read;
  try {
    read = await readTable(fileName, bytes);
  } catch (error) {
    if (error instanceof TableReadError) throw new UserError(error.message);
    throw new UserError("ファイルを読めませんでした。Excel で開けるか確かめて、保存し直したファイルを置いてください");
  }
  // 見出しが見つかるシートのうち、いちばん行の多いもの
  let best: { sheetName: string; out: ReturnType<typeof readBankTable> } | null = null;
  let firstProblem: string | null = null;
  for (const sh of read.sheets) {
    const out = readBankTable(sh.rows);
    if (out.problem) {
      firstProblem ??= out.problem;
      continue;
    }
    if (!best || out.rows.length > best.out.rows.length) best = { sheetName: sh.name, out };
  }
  if (!best) throw new UserError(firstProblem ?? "口座の一覧が見つかりませんでした");
  return { source: { kind: "table", sheetName: best.sheetName, headerRow: best.out.headerRow + 1 }, rows: best.out.rows, problems: [] };
}

/** 口座のファイルを置く（まだ台帳には書かない） */
export async function createBankDraft(
  db: Db,
  tenantId: string,
  user: { id: string | null },
  input: { fileName: string; bytes: Uint8Array; pageMonth: string },
): Promise<{ id: string; rows: number }> {
  const fileName = input.fileName.trim().slice(0, 200) || "口座一覧";
  const tooBigForDemo = demoFileProblem(input.bytes.byteLength);
  if (tooBigForDemo) throw new UserError(tooBigForDemo);
  const { source, rows, problems } = await readBankFile(fileName, input.bytes);
  if (rows.length > 2000) throw new UserError("行が多すぎます（2,000 人まで）。ファイルを分けて置いてください");
  const draft: BankDraft = {
    v: "bank-1",
    file: { name: fileName, size: input.bytes.byteLength, hash: createHash("sha256").update(input.bytes).digest("hex"), uploadedAt: new Date().toISOString() },
    source,
    rows,
    problems,
    assign: {},
  };
  // デモ：1 つの会社が DB をいっぱいにしないように（置いた数と中身の大きさ）
  await assertDemoUploadBudget(db, tenantId, Buffer.byteLength(JSON.stringify(draft)));
  const [batch] = await db
    .insert(s.importBatches)
    .values({
      tenantId,
      month: input.pageMonth,
      kind: BANK_KIND,
      fileName,
      fileHash: draft.file.hash,
      rowCount: rows.length,
      status: "draft",
      summary: draft as unknown as Record<string, unknown>,
      createdBy: user.id,
    })
    .returning({ id: s.importBatches.id });
  return { id: batch.id, rows: rows.length };
}

type BatchRecord = typeof s.importBatches.$inferSelect;

async function getBankBatch(db: Db, tenantId: string, batchId: string): Promise<{ batch: BatchRecord; draft: BankDraft }> {
  if (!UUID.test(batchId)) throw new UserError("口座の取り込みが見つかりません");
  const rows = await db
    .select()
    .from(s.importBatches)
    .where(and(eq(s.importBatches.id, batchId), eq(s.importBatches.tenantId, tenantId), eq(s.importBatches.kind, BANK_KIND)))
    .limit(1);
  const b = rows[0];
  if (!b || (b.summary as { v?: string }).v !== "bank-1") throw new UserError("口座の取り込みが見つかりません");
  return { batch: b, draft: b.summary as unknown as BankDraft };
}

function countOf(rows: BankPreviewRow[]): BankView["counts"] {
  const c = { new: 0, changed: 0, same: 0, unmatched: 0, problem: 0, duplicate: 0 };
  for (const r of rows) c[r.status]++;
  return c;
}

/** 口座の取り込みの画面に出すもの（台帳に当てて、変わるところ） */
export async function loadBankView(db: Db, tenantId: string, batchId: string): Promise<BankView | null> {
  let got;
  try {
    got = await getBankBatch(db, tenantId, batchId);
  } catch {
    return null;
  }
  const { batch, draft } = got;
  const drivers = await ledger(db, tenantId);
  const rows = batch.status === "draft" ? previewBankRows(draft.rows, drivers, draft.assign ?? {}, seenOf(tenantId)) : [];
  const creator = batch.createdBy
    ? await db
        .select({ name: s.users.name })
        .from(s.users)
        .where(and(eq(s.users.id, batch.createdBy), eq(s.users.tenantId, tenantId)))
        .limit(1)
    : [];
  return {
    batch: { id: batch.id, month: batch.month, status: batch.status, fileName: batch.fileName, createdAt: batch.createdAt, createdByName: creator[0]?.name ?? null },
    draft,
    rows,
    counts: countOf(rows),
    drivers: drivers
      .filter((d) => d.active)
      .map((d) => ({ id: d.id, name: d.name, code: d.code }))
      .sort((a, b) => a.name.localeCompare(b.name, "ja")),
  };
}

/** 当たらなかった行を、台帳のドライバーに当てる（driverId が null なら当てるのをやめる）。まだ台帳には書かない */
export async function assignBankRow(db: Db, tenantId: string, batchId: string, rowIndex: number, driverId: string | null): Promise<string> {
  const { batch, draft } = await getBankBatch(db, tenantId, batchId);
  if (batch.status !== "draft") throw new UserError("この取り込みは、もう反映したか、やめてあります");
  const row = draft.rows[rowIndex];
  if (!Number.isInteger(rowIndex) || !row) throw new UserError("その行は見つかりません。画面を読み直してください");
  const assign = { ...(draft.assign ?? {}) };
  let name = "";
  if (driverId) {
    if (!UUID.test(driverId)) throw new UserError("ドライバーを選んでください");
    const d = await db
      .select({ id: s.drivers.id, name: s.drivers.name })
      .from(s.drivers)
      .where(and(eq(s.drivers.id, driverId), eq(s.drivers.tenantId, tenantId)))
      .limit(1);
    if (!d[0]) throw new UserError("選んだドライバーが見つかりません");
    assign[String(rowIndex)] = d[0].id;
    name = d[0].name;
  } else delete assign[String(rowIndex)];
  await db
    .update(s.importBatches)
    .set({ summary: { ...draft, assign } as unknown as Record<string, unknown> })
    .where(and(eq(s.importBatches.id, batch.id), eq(s.importBatches.tenantId, tenantId), eq(s.importBatches.status, "draft")));
  return driverId ? `${row.where}の口座を${name}さんに当てました。下で変わるところを確かめてから、反映してください` : `${row.where}の当て先を外しました`;
}

/** 下書きに残した口座番号を、下 3 桁だけにする（反映・取りやめのあと） */
function scrub(draft: BankDraft): BankDraft {
  return { ...draft, rows: draft.rows.map((r) => ({ ...r, accountNumber: maskAccount(r.accountNumber) })) };
}

export type BankApplyResult = { updated: number; created: number; drivers: { id: string; name: string; status: "new" | "changed" }[] };

/**
 * 選んだ行の口座を台帳に書く。rows：行の番号、seen：画面に出したときの台帳の口座の目印（行の番号 → 目印）。
 * 画面を開いたあとで台帳の口座が変わっていたら、書かずに止める（見ていない値で上書きしない）。
 */
export async function applyBankImport(
  db: Db,
  tenantId: string,
  user: { id: string | null },
  batchId: string,
  input: { rows: number[]; seen: Record<string, string> },
): Promise<BankApplyResult> {
  const { batch, draft } = await getBankBatch(db, tenantId, batchId);
  if (batch.status !== "draft") throw new UserError("この取り込みは、もう反映したか、やめてあります。画面を読み直してください");
  if (input.rows.length === 0) throw new UserError("台帳に入れる人にチェックを付けてください");
  const drivers = await ledger(db, tenantId);
  const preview = previewBankRows(draft.rows, drivers, draft.assign ?? {}, seenOf(tenantId));
  const chosen = [...new Set(input.rows)].map((i) => preview[i]);
  if (chosen.some((r) => !r)) throw new UserError("選んだ行が見つかりません。画面を読み直してください");
  for (const r of chosen) {
    if (r.status !== "new" && r.status !== "changed") {
      throw new UserError(`${r.input.where}${r.driver ? `（${r.driver.name}さん）` : ""}は、台帳に入れられる行ではありません。画面を読み直してください`);
    }
    if ((input.seen[String(r.index)] ?? "") !== r.seen) {
      throw new UserError(`${r.driver!.name}さんの口座は、画面を開いたあとで変わっています。画面を読み直して、変わるところを確かめてから反映してください`);
    }
  }
  const byId = new Map(drivers.map((d) => [d.id, d]));
  const now = new Date().toISOString();
  const done: BankApplyResult["drivers"] = [];
  const audits: { driverId: string; name: string; changed: Record<string, { from: string; to: string }>; status: "new" | "changed" }[] = [];

  await db.transaction(async (tx) => {
    const t = tx as unknown as Db;
    // 最初に「確認中 → 反映済み」に変える。2 つの画面から同時に押されても、2 回目はここで止まる
    const claimed = await t
      .update(s.importBatches)
      .set({ status: "applied" })
      .where(and(eq(s.importBatches.id, batch.id), eq(s.importBatches.tenantId, tenantId), eq(s.importBatches.status, "draft")))
      .returning({ id: s.importBatches.id });
    if (!claimed[0]) throw new UserError("この取り込みは、ほかの画面からもう反映されたか、やめてあります。画面を読み直してください");
    for (const r of chosen) {
      const d = byId.get(r.driver!.id)!;
      const before = bankOfDriver(d);
      const next = r.next!;
      const updated = await t
        .update(s.drivers)
        .set({ ...next, updatedAt: new Date() })
        .where(and(eq(s.drivers.id, d.id), eq(s.drivers.tenantId, tenantId)))
        .returning({ id: s.drivers.id });
      if (!updated[0]) throw new UserError(`${d.name}さんが見つかりません。画面を読み直してください`);
      const changed: Record<string, { from: string; to: string }> = {};
      for (const k of Object.keys(BANK_FIELD_LABEL) as BankField[]) {
        if ((before[k] ?? "") === (next[k] ?? "")) continue;
        changed[k] = { from: shownValue(k, before[k] ?? ""), to: shownValue(k, next[k] ?? "") };
      }
      const status = r.status === "new" ? "new" : "changed";
      audits.push({ driverId: d.id, name: d.name, changed, status });
      done.push({ id: d.id, name: d.name, status });
    }
    const out = scrub(draft);
    out.applied = { at: now, by: user.id, updated: done.filter((x) => x.status === "changed").length, created: done.filter((x) => x.status === "new").length, drivers: done };
    await t
      .update(s.importBatches)
      .set({ summary: out as unknown as Record<string, unknown>, rowCount: draft.rows.length })
      .where(and(eq(s.importBatches.id, batch.id), eq(s.importBatches.tenantId, tenantId)));
  });

  // ドライバーの設定を直した記録（振込データの「口座が変わった人」にも、誰がいつ変えたかとして出る）
  for (const a of audits) {
    await audit(db, {
      tenantId,
      userId: user.id,
      action: "driver.update",
      entity: "driver",
      entityId: a.driverId,
      detail: { name: a.name, changed: a.changed, source: "import.bank", batchId: batch.id, fileName: batch.fileName, status: a.status },
    });
  }
  return { updated: done.filter((x) => x.status === "changed").length, created: done.filter((x) => x.status === "new").length, drivers: done };
}

/** 口座の取り込みをやめる（台帳には何も書かない） */
export async function discardBankDraft(db: Db, tenantId: string, user: { id: string | null }, batchId: string): Promise<void> {
  const { batch, draft } = await getBankBatch(db, tenantId, batchId);
  if (batch.status !== "draft") throw new UserError("この取り込みは、もう反映したか、やめてあります");
  const out = scrub(draft);
  out.discarded = { at: new Date().toISOString(), by: user.id };
  await db
    .update(s.importBatches)
    .set({ status: "discarded", summary: out as unknown as Record<string, unknown> })
    .where(and(eq(s.importBatches.id, batch.id), eq(s.importBatches.tenantId, tenantId), eq(s.importBatches.status, "draft")));
}

export type BankBatchRow = { id: string; fileName: string; status: string; createdAt: Date; rows: number; source: string | null; updated: number | null; created: number | null };

/** 口座の取り込みの履歴（新しい順・20 件まで） */
export async function listBankBatches(db: Db, tenantId: string): Promise<BankBatchRow[]> {
  const rows = await db
    .select({
      id: s.importBatches.id,
      fileName: s.importBatches.fileName,
      status: s.importBatches.status,
      createdAt: s.importBatches.createdAt,
      rows: s.importBatches.rowCount,
      source: sql<string | null>`${s.importBatches.summary}->'source'->>'kind'`,
      updated: sql<number | null>`(${s.importBatches.summary}->'applied'->>'updated')::int`,
      created: sql<number | null>`(${s.importBatches.summary}->'applied'->>'created')::int`,
    })
    .from(s.importBatches)
    .where(and(eq(s.importBatches.tenantId, tenantId), eq(s.importBatches.kind, BANK_KIND)))
    .orderBy(desc(s.importBatches.createdAt))
    .limit(20);
  return rows;
}
