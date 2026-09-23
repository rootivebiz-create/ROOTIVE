import "server-only";
import { and, eq, isNull, sql } from "drizzle-orm";
import type { Db } from "~/db/client";
import * as s from "~/db/schema";
import { UserError } from "~/server/action";
import type { RuleGuess } from "./deductions";
import type { DeductionProposal } from "./proposals";
import { loadDraftView } from "./service";

/**
 * 控除の提案を採用する：取り込みのファイルから読み取った式で、控除のルールを作る。
 * 合意の記録が無いルール（agreedInWriting=false）として作るので、見張り番が「書面で合意した記録が見つかりません」と知らせる。
 * 取引条件の記録（明示書）に入れて、ドライバーと合意した日を入れるのは会社。
 */

/** ルールの根拠の欄に入れる言葉（見張り番・設定の画面で、どこから来たルールか分かるように） */
export const PROPOSAL_BASIS = "取り込みのファイルから提案";

export type AdoptedRule = typeof s.deductionRules.$inferSelect & { driverName: string | null };

function looseKey(v: string): string {
  return v.normalize("NFKC").replace(/\s/g, "").toLowerCase();
}

function ruleValues(g: RuleGuess): { kind: string; rate: number | null; amount: number | null } {
  if (g.kind === "fixed") return { kind: "fixed", rate: null, amount: Math.round(g.amount) };
  return { kind: g.kind, rate: g.rate, amount: null };
}

/**
 * exceptionsOnly：全員向けの同じ式のルールがもう登録済みのとき、合わない人の「その人だけのルール」だけを作る
 * （例：ロイヤリティ 10% は登録済みで、Excel では岡田さんだけ 8%）。稼働した月だけ・消費税の扱いは、登録済みのルールに合わせる。
 */
export async function adoptDeductionProposal(
  db: Db,
  tenantId: string,
  batchId: string,
  input: { col: number; withExceptions: boolean; exceptionsOnly?: boolean },
): Promise<{ proposal: DeductionProposal; created: AdoptedRule[] }> {
  const view = await loadDraftView(db, tenantId, batchId);
  if (!view) throw new UserError("取り込みが見つかりません");
  if (view.batch.status !== "draft") throw new UserError("控除の提案は、反映する前の取り込みの画面で採用できます。設定の「控除のルール」から入れてください");
  if (!view.extras) throw new UserError("先に列の読み方と名前を決めてください");
  const p = view.extras.proposals.find((x) => x.col === input.col);
  if (!p) throw new UserError("その控除の列が見つかりません。画面を読み直してください");
  if (!p.inference) throw new UserError(`「${p.header}」の列からは、決まった式を読み取れませんでした（${p.reason ?? "人ごとに額が違います"}）`);
  const driverIds = new Set(view.known.drivers.map((d) => d.id));
  const exceptions = input.withExceptions ? p.exceptionRules.filter((x) => !x.hasOwnRule && driverIds.has(x.driverId)) : [];
  const names = new Map(view.known.drivers.map((d) => [d.id, d.name]));
  if (input.exceptionsOnly) {
    if (!p.existing || !p.sameAsExisting) throw new UserError("登録済みの同じ式の控除が見つかりません。画面を読み直してください");
    if (exceptions.length === 0) throw new UserError("その人だけのルールを作る人はいません（もう作ってあります）。画面を読み直してください");
    return { proposal: p, created: await createExceptions(db, tenantId, p, p.existing.id, exceptions, names) };
  }
  if (p.existing) {
    throw new UserError(
      `同じ名前の控除「${p.existing.name}」がすでにあります。二重に引かないよう、設定の「控除のルール」で中身を確かめて直してください`,
    );
  }

  const created: AdoptedRule[] = [];
  await db.transaction(async (tx) => {
    const t = tx as unknown as Db;
    const [{ top }] = await t
      .select({ top: sql<number>`coalesce(max(${s.deductionRules.sort}), 0)` })
      .from(s.deductionRules)
      .where(eq(s.deductionRules.tenantId, tenantId));
    // 同じ名前の全員向けのルールを、同時に 2 つ作らない（2 つの画面から押されたとき）
    const actives = await t
      .select({ name: s.deductionRules.name })
      .from(s.deductionRules)
      .where(and(eq(s.deductionRules.tenantId, tenantId), eq(s.deductionRules.active, true), isNull(s.deductionRules.driverId)));
    if (actives.some((r) => looseKey(r.name) === looseKey(p.name))) throw new UserError(`同じ名前の控除「${p.name}」がすでにあります。画面を読み直してください`);
    const common = {
      tenantId,
      name: p.name,
      onlyWhenWorked: true,
      taxable: p.taxable,
      agreedInWriting: false,
      agreedOn: null,
      basis: PROPOSAL_BASIS,
      active: true,
    };
    const [rule] = await t
      .insert(s.deductionRules)
      .values({ ...common, driverId: null, ...ruleValues(p.inference!.guess), sort: Number(top) + 1 })
      .returning();
    created.push({ ...rule, driverName: null });
    for (const x of exceptions) {
      const [own] = await t
        .insert(s.deductionRules)
        .values({ ...common, driverId: x.driverId, ...ruleValues(x.guess), sort: Number(top) + 1 })
        .returning();
      created.push({ ...own, driverName: names.get(x.driverId) ?? null });
    }
  });
  return { proposal: p, created };
}

/** 登録済みの全員向けのルールに、合わない人の「その人だけのルール」を足す（同じ名前・合意の記録なし） */
async function createExceptions(
  db: Db,
  tenantId: string,
  p: DeductionProposal,
  ruleId: string,
  exceptions: DeductionProposal["exceptionRules"],
  names: Map<string, string>,
): Promise<AdoptedRule[]> {
  const created: AdoptedRule[] = [];
  await db.transaction(async (tx) => {
    const t = tx as unknown as Db;
    const [base] = await t
      .select()
      .from(s.deductionRules)
      .where(and(eq(s.deductionRules.id, ruleId), eq(s.deductionRules.tenantId, tenantId), eq(s.deductionRules.active, true)))
      .limit(1);
    if (!base) throw new UserError("登録済みの控除が見つかりません。画面を読み直してください");
    // 同じ人の同じ名前のルールを、同時に 2 つ作らない（2 つの画面から押されたとき）
    const owned = await t
      .select({ driverId: s.deductionRules.driverId, name: s.deductionRules.name })
      .from(s.deductionRules)
      .where(and(eq(s.deductionRules.tenantId, tenantId), eq(s.deductionRules.active, true)));
    const has = new Set(owned.filter((r) => r.driverId && looseKey(r.name) === looseKey(base.name)).map((r) => r.driverId));
    for (const x of exceptions) {
      if (has.has(x.driverId)) throw new UserError(`${names.get(x.driverId) ?? ""}さんの「${base.name}」は、もうあります。画面を読み直してください`);
      const [own] = await t
        .insert(s.deductionRules)
        .values({
          tenantId,
          driverId: x.driverId,
          name: base.name,
          ...ruleValues(x.guess),
          onlyWhenWorked: base.onlyWhenWorked,
          taxable: base.taxable,
          agreedInWriting: false,
          agreedOn: null,
          basis: PROPOSAL_BASIS,
          active: true,
          sort: base.sort,
        })
        .returning();
      created.push({ ...own, driverName: names.get(x.driverId) ?? null });
    }
  });
  if (created.length === 0) throw new UserError("作るルールがありませんでした");
  return created;
}
