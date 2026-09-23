import "server-only";
import { and, eq } from "drizzle-orm";
import type { Db } from "~/db/client";
import * as s from "~/db/schema";
import { runAction, type ActionResult } from "~/server/action";
import { buildStatementDrafts } from "~/server/calc/statement";
import { monthLabelJa } from "~/server/month";
import { loadBuildInput } from "~/server/repo";
import { messageKey, OPEN_MONTHS_FIELD, OPEN_MONTHS_HINT } from "./open-months-key";

export { OPEN_MONTHS_FIELD, OPEN_MONTHS_HINT };

/**
 * 単価・控除を変えるときの「まだ締めていない月」への影響の確かめ。
 * 単価（案件・人ごと）と控除のルールには「いつの分から」の区別が無く、明細は作り直すたびに今の値で計算する。
 * そのため、先月をまだ締めていないうちに今月からの単価に変えると、先月の明細も新しい単価で作り直される。
 * 保存する前に、まだ締めていない月の明細の見込み（振込額）がどれだけ変わるかを計算し、
 * 変わるときは、利用者がそれを見て「反映する」を選んだときだけ保存する（選ばなければ何も変えない）。
 * 計算は明細と同じ buildStatementDrafts を、変える前と変えたあとで 2 回動かして比べる（独自に計算しない）。
 */

/** 比べる月の数の上限（新しい方から） */
const MAX_MONTHS = 12;

export type OpenMonthImpact = {
  month: string;
  /** 振込額の見込みが変わる人数 */
  drivers: number;
  /** 振込額の見込みの合計の差（変えたあと − 変える前） */
  diff: number;
  /** 変わる人の名前（多いときは先頭から） */
  names: string[];
};

/** まだ締めていない月のうち、稼働か調整がある月（古い順。多いときは新しい方から MAX_MONTHS か月） */
export async function openMonthsWithData(db: Db, tenantId: string): Promise<string[]> {
  const [work, adjustments, closed] = await Promise.all([
    db.selectDistinct({ month: s.workEntries.month }).from(s.workEntries).where(eq(s.workEntries.tenantId, tenantId)),
    db.selectDistinct({ month: s.adjustments.month }).from(s.adjustments).where(eq(s.adjustments.tenantId, tenantId)),
    db
      .select({ month: s.monthCloses.month })
      .from(s.monthCloses)
      .where(and(eq(s.monthCloses.tenantId, tenantId), eq(s.monthCloses.status, "closed"))),
  ]);
  const closedSet = new Set(closed.map((c) => c.month));
  const months = [...new Set([...work, ...adjustments].map((r) => r.month))].filter((m) => !closedSet.has(m)).sort();
  return months.slice(-MAX_MONTHS);
}

type MonthTotals = Map<string, Map<string, { name: string; total: number }>>;

async function totalsOf(db: Db, tenantId: string, months: string[]): Promise<MonthTotals> {
  const out: MonthTotals = new Map();
  for (const month of months) {
    const drafts = buildStatementDrafts(await loadBuildInput(db, tenantId, month));
    out.set(month, new Map(drafts.map((d) => [d.driverId, { name: d.driver.name, total: d.total }])));
  }
  return out;
}

/** 変える前と変えたあとの見込みを比べる（純関数）。変わる月だけを返す */
export function compareMonthTotals(months: string[], before: MonthTotals, after: MonthTotals): OpenMonthImpact[] {
  const out: OpenMonthImpact[] = [];
  for (const month of months) {
    const a = before.get(month) ?? new Map();
    const b = after.get(month) ?? new Map();
    const names: string[] = [];
    let diff = 0;
    let drivers = 0;
    for (const id of new Set([...a.keys(), ...b.keys()])) {
      const x = a.get(id);
      const y = b.get(id);
      const d = (y?.total ?? 0) - (x?.total ?? 0);
      if (d === 0 && !!x === !!y) continue;
      drivers++;
      diff += d;
      names.push(y?.name ?? x?.name ?? "（不明）");
    }
    if (drivers > 0) out.push({ month, drivers, diff, names: names.sort((p, q) => p.localeCompare(q, "ja")) });
  }
  return out;
}

/** 確かめた内容の印（画面は説明の文から同じ値を作る。画面で見た影響と、保存するときの影響が同じときだけ通す） */
export function impactKey(impact: OpenMonthImpact[]): string {
  return messageKey(impactMessage(impact));
}

function signedYen(n: number): string {
  return `${n < 0 ? "−" : "＋"}${Math.abs(n).toLocaleString("ja-JP")}円`;
}

/** 画面に出す説明（何月の明細が・何人・いくら変わるか）。1 つの段落で読めるように、月は「／」で区切る */
export function impactMessage(impact: OpenMonthImpact[]): string {
  const months = impact
    .map((i) => {
      const who = i.names.slice(0, 3).map((n) => `${n}さん`).join("・") + (i.names.length > 3 ? ` ほか ${i.names.length - 3}人` : "");
      return `${monthLabelJa(i.month)}分：${i.drivers}人・振込額の合計 ${signedYen(i.diff)}（${who}）`;
    })
    .join("／");
  return (
    `まだ保存していません。この変更で、まだ締めていない月の明細（見込み）の振込額が変わります：${months}。` +
    "単価と控除には「いつの分から」の区別が無いため、保存すると、この月の明細も作り直したときに新しい値で計算されます。" +
    "前の月の分を今までの値で払うときは、先にその月を締めてから変えてください。"
  );
}

/** まだ締めていない月の明細が変わるのに、確かめの印が無い（または画面で見たあとに影響が変わった） */
export class OpenMonthsChanged extends Error {
  readonly impact: OpenMonthImpact[];
  readonly key: string;
  constructor(impact: OpenMonthImpact[]) {
    super(impactMessage(impact));
    this.impact = impact;
    this.key = impactKey(impact);
  }
}

/** フォームから確かめの印を読む（無ければ null） */
export function confirmKeyOf(form: FormData): string | null {
  const v = form.get(OPEN_MONTHS_FIELD);
  return typeof v === "string" && /^[0-9a-f]{8}$/.test(v) ? v : null;
}

/**
 * 設定を変える処理 change を、確かめの中で動かす（1 つのトランザクション）。
 * まだ締めていない月の明細の見込みが変わるのに、confirmKey がその影響の印と同じでなければ、変更を取り消して OpenMonthsChanged を投げる。
 * 変わらないときや、印が同じときは、そのまま保存して影響を返す（操作の記録に残すため）。
 */
export async function withOpenMonthCheck<T>(
  db: Db,
  tenantId: string,
  confirmKey: string | null | undefined,
  change: (db: Db) => Promise<T>,
): Promise<{ result: T; impact: OpenMonthImpact[] }> {
  return db.transaction(async (tx) => {
    const t = tx as unknown as Db;
    const months = await openMonthsWithData(t, tenantId);
    const before = await totalsOf(t, tenantId, months);
    const result = await change(t);
    const after = await totalsOf(t, tenantId, months);
    const impact = compareMonthTotals(months, before, after);
    if (impact.length > 0 && confirmKey !== impactKey(impact)) throw new OpenMonthsChanged(impact);
    return { result, impact };
  });
}

/**
 * 設定の Server Action を包む（runAction と同じ）。まだ締めていない月の明細が変わるときは、
 * 説明（error）と案内（fieldErrors の confirmOpenMonths）を返し、画面に「上の月の明細にも反映する」の欄を出させる。
 */
export async function runSettingsAction<T>(fn: () => Promise<T>, message?: string): Promise<ActionResult<T>> {
  let pending: OpenMonthsChanged | null = null;
  const res = await runAction(async () => {
    try {
      return await fn();
    } catch (error) {
      if (error instanceof OpenMonthsChanged) {
        pending = error;
        return undefined as T;
      }
      throw error;
    }
  }, message);
  const p = pending as OpenMonthsChanged | null;
  if (p) return { ok: false, error: p.message, fieldErrors: { [OPEN_MONTHS_FIELD]: OPEN_MONTHS_HINT } };
  return res;
}

/** 操作の記録に残す形（反映した月と差） */
export function impactDetail(impact: OpenMonthImpact[]): Record<string, unknown> {
  return impact.length ? { openMonths: impact.map((i) => ({ month: i.month, drivers: i.drivers, diff: i.diff })) } : {};
}
