/**
 * 見張り番の一覧のまとめ（純関数）。画面の件数と、重さごとの並べ方。
 */
import type { WatchIssue, WatchSeverity } from "~/server/features/watch-types";

export type WatchCounts = {
  /** 締めを止めている赤（未確認） */
  redOpen: number;
  redAcked: number;
  yellowOpen: number;
  yellowAcked: number;
  info: number;
  total: number;
};

export function countIssues(issues: WatchIssue[]): WatchCounts {
  const c: WatchCounts = { redOpen: 0, redAcked: 0, yellowOpen: 0, yellowAcked: 0, info: 0, total: issues.length };
  for (const i of issues) {
    if (i.severity === "red") {
      if (i.acked) c.redAcked++;
      else c.redOpen++;
    } else if (i.severity === "yellow") {
      if (i.acked) c.yellowAcked++;
      else c.yellowOpen++;
    } else c.info++;
  }
  return c;
}

/**
 * 重さごとに分ける。まだ確認していないものを先に（並びはそのまま）。
 * later を渡すと、まだ確認していないもののうち later に当たるもの（前の月に確認済みにした黄など）を、その次に並べる
 */
export function groupBySeverity<T extends WatchIssue>(issues: T[], later?: (i: T) => boolean): Record<WatchSeverity, T[]> {
  const out: Record<WatchSeverity, T[]> = { red: [], yellow: [], info: [] };
  for (const i of issues) out[i.severity].push(i);
  const isLater = (i: T) => !!later && later(i);
  for (const k of Object.keys(out) as WatchSeverity[]) {
    out[k] = [...out[k].filter((i) => !i.acked && !isLater(i)), ...out[k].filter((i) => !i.acked && isLater(i)), ...out[k].filter((i) => i.acked)];
  }
  return out;
}

/** まとめて確認済みにできる、同じ種類・同じ見出しの指摘の組 */
export type BulkAckGroup<T extends WatchIssue> = { code: string; title: string; severity: WatchSeverity; issues: T[] };

/**
 * まだ確認していない指摘のうち、同じ種類・同じ見出し（同じ重さ）のものが 2 件以上ある組（出てきた順）。
 * 画面の「同じ理由でまとめて確認済みにする」に使う（導入の月に、何人もの同じ指摘が並ぶとき）
 */
export function bulkAckGroups<T extends WatchIssue>(issues: T[]): BulkAckGroup<T>[] {
  const by = new Map<string, BulkAckGroup<T>>();
  for (const i of issues) {
    if (i.acked) continue;
    const key = `${i.severity}\u0000${i.code}\u0000${i.title}`;
    const g = by.get(key);
    if (g) g.issues.push(i);
    else by.set(key, { code: i.code, title: i.title, severity: i.severity, issues: [i] });
  }
  return [...by.values()].filter((g) => g.issues.length >= 2);
}
