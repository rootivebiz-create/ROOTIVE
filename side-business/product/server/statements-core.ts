import "server-only";
import { and, eq } from "drizzle-orm";
import type { Db } from "~/db/client";
import * as s from "~/db/schema";
import { UserError } from "~/server/action";
import { audit } from "~/server/audit";
import { buildStatementDrafts, type StatementDraft } from "~/server/calc/statement";
import { isMonthClosed, loadBuildInput } from "~/server/repo";
import { sha256 } from "~/server/tokens";

/**
 * 支払明細の「写し」を作る・作り直す（明細・振込・締め・利益が共通で使う入口）。
 * - 計算は buildStatementDrafts だけ。ここでは保存と版の管理をする
 * - 中身が変わったときだけ版（version）を 1 つ上げ、ハッシュを付け直す（ドライバーが何を確認したかを後から示すため）
 * - どの版も statement_versions に写しを残す（追記だけ。DB が書き換えを止める）
 * - 締めた月は作り直せない（DB も止める）
 */

/** キーの順を固定した JSON（同じ中身なら必ず同じ文字になる） */
export function stableStringify(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value) ?? "null";
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  const obj = value as Record<string, unknown>;
  return `{${Object.keys(obj)
    .filter((k) => obj[k] !== undefined)
    .sort()
    .map((k) => `${JSON.stringify(k)}:${stableStringify(obj[k])}`)
    .join(",")}}`;
}

export function snapshotHash(draft: StatementDraft): string {
  return sha256(stableStringify(draft));
}

/** 保存した写しを明細の形で読む */
export function readSnapshot(row: { snapshot: unknown }): StatementDraft {
  return row.snapshot as StatementDraft;
}

/** 振込から差し引く額（控除 ＋ 控除の消費税）。statements.deductions に入れる値 */
export function deductionsWithTax(d: StatementDraft): number {
  return d.deductionTotal + d.deductionTax;
}

export type GenerateResult = { created: number; updated: number; unchanged: number; removed: number; total: number };

export async function generateStatements(db: Db, tenantId: string, month: string, userId?: string | null): Promise<GenerateResult> {
  if (await isMonthClosed(db, tenantId, month)) throw new UserError("この月は締め済みです。明細は作り直せません（直すには、先に締めを外してください）");
  const drafts = buildStatementDrafts(await loadBuildInput(db, tenantId, month));
  const result: GenerateResult = { created: 0, updated: 0, unchanged: 0, removed: 0, total: drafts.length };

  await db.transaction(async (tx) => {
    const existing = await tx
      .select({ id: s.statements.id, driverId: s.statements.driverId, hash: s.statements.hash, version: s.statements.version })
      .from(s.statements)
      .where(and(eq(s.statements.tenantId, tenantId), eq(s.statements.month, month)));
    const byDriver = new Map(existing.map((e) => [e.driverId, e]));
    const seen = new Set<string>();

    for (const d of drafts) {
      seen.add(d.driverId);
      const hash = snapshotHash(d);
      const values = {
        snapshot: d as unknown as Record<string, unknown>,
        subtotal: d.subtotal,
        tax: d.tax,
        deductions: deductionsWithTax(d),
        withholding: d.withholding?.amount ?? 0,
        total: d.total,
        hash,
      };
      const prev = byDriver.get(d.driverId);
      // 版の写し（追記だけの表。明細が作り直されても、前の版を後から見られる）
      const keepVersion = (statementId: string, version: number) =>
        tx.insert(s.statementVersions).values({ tenantId, statementId, month, driverId: d.driverId, version, hash, snapshot: values.snapshot, total: d.total, createdBy: userId ?? null });
      if (!prev) {
        const [row] = await tx.insert(s.statements).values({ tenantId, month, driverId: d.driverId, version: 1, ...values }).returning({ id: s.statements.id });
        await keepVersion(row.id, 1);
        result.created++;
      } else if (prev.hash === hash) {
        result.unchanged++;
      } else {
        await tx
          .update(s.statements)
          .set({ ...values, version: prev.version + 1, updatedAt: new Date() })
          .where(and(eq(s.statements.id, prev.id), eq(s.statements.tenantId, tenantId)));
        await keepVersion(prev.id, prev.version + 1);
        result.updated++;
      }
    }

    // 稼働も調整も無くなった人の明細は消す（確認の記録があれば操作の記録に残す）
    for (const e of existing) {
      if (seen.has(e.driverId)) continue;
      const confirmations = await tx
        .select({ id: s.statementConfirmations.id, createdAt: s.statementConfirmations.createdAt, version: s.statementConfirmations.version })
        .from(s.statementConfirmations)
        .where(and(eq(s.statementConfirmations.tenantId, tenantId), eq(s.statementConfirmations.statementId, e.id)));
      await tx.delete(s.statements).where(and(eq(s.statements.id, e.id), eq(s.statements.tenantId, tenantId)));
      await audit(tx as unknown as Db, {
        tenantId,
        userId,
        action: "statement.remove",
        entity: "statement",
        entityId: e.id,
        detail: { month, driverId: e.driverId, version: e.version, confirmations },
      });
      result.removed++;
    }
  });

  await audit(db, { tenantId, userId, action: "statement.generate", entity: "month", entityId: month, detail: { ...result } });
  return result;
}

export type StatementsStatus = {
  /** 今の稼働・設定から作ると何人ぶんになるか */
  expected: number;
  /** 保存済みの明細の数 */
  saved: number;
  /** まだ作っていない人 */
  missing: string[];
  /** 作ったあとに稼働・設定が変わった人（作り直しが必要） */
  stale: string[];
  /** 稼働が無くなったのに明細が残っている人 */
  orphan: string[];
  upToDate: boolean;
};

/** 保存済みの明細が、今の稼働・設定と同じか（締め・ホームの「明細が最新か」の判定） */
export async function statementsStatus(db: Db, tenantId: string, month: string): Promise<StatementsStatus> {
  const drafts = buildStatementDrafts(await loadBuildInput(db, tenantId, month));
  const saved = await db
    .select({ driverId: s.statements.driverId, hash: s.statements.hash })
    .from(s.statements)
    .where(and(eq(s.statements.tenantId, tenantId), eq(s.statements.month, month)));
  const byDriver = new Map(saved.map((r) => [r.driverId, r.hash]));
  const missing: string[] = [];
  const stale: string[] = [];
  for (const d of drafts) {
    const hash = byDriver.get(d.driverId);
    if (hash === undefined) missing.push(d.driverId);
    else if (hash !== snapshotHash(d)) stale.push(d.driverId);
  }
  const expectedIds = new Set(drafts.map((d) => d.driverId));
  const orphan = saved.filter((r) => !expectedIds.has(r.driverId)).map((r) => r.driverId);
  return {
    expected: drafts.length,
    saved: saved.length,
    missing,
    stale,
    orphan,
    upToDate: missing.length === 0 && stale.length === 0 && orphan.length === 0 && saved.length > 0,
  };
}
