import "server-only";
import { and, asc, eq, gte, inArray, lte } from "drizzle-orm";
import type { Db } from "~/db/client";
import * as s from "~/db/schema";
import { jpDateTime } from "~/server/features/statements/view";
import { monthLabelJa } from "~/server/month";

/**
 * 明細の検索（/records）：月をまたいで、期間・振込額の範囲・ドライバーで明細を探し、どの版も開けるようにする。
 * 税務調査や、1 年分のデータがたまったあとの問い合わせに答えるため。
 * 探すのは版の写し（statement_versions。消せない表）なので、作り直しで消えた明細の版も見つかる。
 * 振込額の範囲は、その明細の最新の版の振込額で見る
 */

export type RecordsQuery = {
  driverId: string | null;
  /** 期間（月初日 YYYY-MM-01）。どちらも含む */
  from: string | null;
  to: string | null;
  /** 振込額の範囲（円）。どちらも含む */
  min: number | null;
  max: number | null;
};

export type RecordVersion = { version: number; total: number; hash: string; createdAtText: string };

export type RecordRow = {
  statementId: string;
  month: string;
  monthLabel: string;
  driverId: string;
  driverName: string;
  driverCode: string | null;
  /** 最新の版（新しいものが先頭の versions[0] と同じ） */
  latest: RecordVersion;
  /** すべての版（新しい版が先頭） */
  versions: RecordVersion[];
  /** 明細がいまもあるか（作り直しで消えた明細は、版の写しだけが残る） */
  exists: boolean;
  /** その月を締めてあるか */
  closed: boolean;
};

export type RecordsResult = { rows: RecordRow[]; total: number; truncated: boolean; sum: number };

/** 画面に出す上限（多いときは期間を狭めてもらう） */
export const RECORDS_LIMIT = 300;

const MONTH_RE = /^\d{4}-(0[1-9]|1[0-2])$/;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** 円の入力（全角・カンマ・「円」可）。読めなければ null */
function yenParam(v: string | undefined): number | null {
  if (!v) return null;
  const t = v.normalize("NFKC").replace(/[,\s円¥￥]/g, "");
  if (!/^-?\d{1,10}$/.test(t)) return null;
  return Number(t);
}

/** URL の値（?driver=&from=YYYY-MM&to=YYYY-MM&min=&max=）を検索の条件に。読めない値は「指定なし」 */
export function parseRecordsQuery(sp: Record<string, string | string[] | undefined>): RecordsQuery {
  const one = (k: string) => {
    const v = sp[k];
    return (Array.isArray(v) ? v[0] : v)?.trim() || undefined;
  };
  const month = (k: string) => {
    const v = one(k);
    return v && MONTH_RE.test(v) ? `${v}-01` : null;
  };
  let from = month("from");
  let to = month("to");
  if (from && to && from > to) [from, to] = [to, from];
  let min = yenParam(one("min"));
  let max = yenParam(one("max"));
  if (min !== null && max !== null && min > max) [min, max] = [max, min];
  const driver = one("driver");
  return { driverId: driver && UUID_RE.test(driver) ? driver : null, from, to, min, max };
}

/** 検索の条件を URL の形に（CSV のリンク・ページの行き来に使う） */
export function recordsQueryString(q: RecordsQuery): string {
  const p = new URLSearchParams();
  if (q.driverId) p.set("driver", q.driverId);
  if (q.from) p.set("from", q.from.slice(0, 7));
  if (q.to) p.set("to", q.to.slice(0, 7));
  if (q.min !== null) p.set("min", String(q.min));
  if (q.max !== null) p.set("max", String(q.max));
  return p.toString();
}

export async function searchStatementRecords(db: Db, tenantId: string, q: RecordsQuery, limit = RECORDS_LIMIT): Promise<RecordsResult> {
  const conds = [eq(s.statementVersions.tenantId, tenantId)];
  if (q.driverId) conds.push(eq(s.statementVersions.driverId, q.driverId));
  if (q.from) conds.push(gte(s.statementVersions.month, q.from));
  if (q.to) conds.push(lte(s.statementVersions.month, q.to));
  const versions = await db
    .select({
      statementId: s.statementVersions.statementId,
      month: s.statementVersions.month,
      driverId: s.statementVersions.driverId,
      version: s.statementVersions.version,
      total: s.statementVersions.total,
      hash: s.statementVersions.hash,
      createdAt: s.statementVersions.createdAt,
    })
    .from(s.statementVersions)
    .where(and(...conds))
    .orderBy(asc(s.statementVersions.month), asc(s.statementVersions.statementId), asc(s.statementVersions.version));

  const byStatement = new Map<string, typeof versions>();
  for (const v of versions) {
    const list = byStatement.get(v.statementId) ?? [];
    list.push(v);
    byStatement.set(v.statementId, list);
  }
  const groups = [...byStatement.values()]
    .map((list) => list.sort((a, b) => b.version - a.version))
    .filter((list) => {
      const total = list[0].total;
      return (q.min === null || total >= q.min) && (q.max === null || total <= q.max);
    });

  const driverIds = [...new Set(groups.map((g) => g[0].driverId))];
  const statementIds = groups.map((g) => g[0].statementId);
  const months = [...new Set(groups.map((g) => g[0].month))];
  const [drivers, existing, closes] = await Promise.all([
    driverIds.length
      ? db
          .select({ id: s.drivers.id, name: s.drivers.name, code: s.drivers.code })
          .from(s.drivers)
          .where(and(eq(s.drivers.tenantId, tenantId), inArray(s.drivers.id, driverIds)))
      : [],
    statementIds.length
      ? db
          .select({ id: s.statements.id })
          .from(s.statements)
          .where(and(eq(s.statements.tenantId, tenantId), inArray(s.statements.id, statementIds)))
      : [],
    months.length
      ? db
          .select({ month: s.monthCloses.month, status: s.monthCloses.status })
          .from(s.monthCloses)
          .where(and(eq(s.monthCloses.tenantId, tenantId), inArray(s.monthCloses.month, months)))
      : [],
  ]);
  const driverOf = new Map(drivers.map((d) => [d.id, d]));
  const exists = new Set(existing.map((e) => e.id));
  const closed = new Set(closes.filter((c) => c.status === "closed").map((c) => c.month));

  const rows: RecordRow[] = groups
    .map((list) => {
      const head = list[0];
      const d = driverOf.get(head.driverId);
      const vers = list.map((v) => ({ version: v.version, total: v.total, hash: v.hash, createdAtText: jpDateTime(v.createdAt) }));
      return {
        statementId: head.statementId,
        month: head.month,
        monthLabel: monthLabelJa(head.month),
        driverId: head.driverId,
        driverName: d?.name ?? "（削除したドライバー）",
        driverCode: d?.code ?? null,
        latest: vers[0],
        versions: vers,
        exists: exists.has(head.statementId),
        closed: closed.has(head.month),
      };
    })
    // 新しい月が先。同じ月の中は番号 → 名前の順
    .sort(
      (a, b) =>
        b.month.localeCompare(a.month) ||
        (a.driverCode ?? "\uffff").localeCompare(b.driverCode ?? "\uffff", "ja") ||
        a.driverName.localeCompare(b.driverName, "ja"),
    );
  return {
    rows: rows.slice(0, limit),
    total: rows.length,
    truncated: rows.length > limit,
    sum: rows.reduce((acc, r) => acc + r.latest.total, 0),
  };
}

export const RECORDS_CSV_HEADER = ["月", "コード", "ドライバー", "版", "振込額", "ハッシュ", "版を作った日時", "最新の版か", "明細がいまもあるか", "締めた月か"];

/** 索引（CSV の行）：明細の版ごとに 1 行（新しい月が先） */
export function recordsCsvRows(result: RecordsResult): (string | number)[][] {
  const out: (string | number)[][] = [RECORDS_CSV_HEADER];
  for (const r of result.rows) {
    for (const v of r.versions) {
      out.push([
        r.month.slice(0, 7),
        r.driverCode ?? "",
        r.driverName,
        v.version,
        v.total,
        v.hash,
        v.createdAtText,
        v.version === r.latest.version ? "最新" : "前の版",
        r.exists ? "あり" : "作り直しで消えた（版の写しだけ）",
        r.closed ? "締めた" : "まだ",
      ]);
    }
  }
  return out;
}
