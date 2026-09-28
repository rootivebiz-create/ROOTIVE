/**
 * 明細の版の履歴（純関数。DB に触らない）。
 * 作り直すたびに残した版の写し（statement_versions）を古い順に並べ、となりの版どうしの違いを文にし、
 * ドライバーの確認がどの版についてのものかを結びつける。画面では新しい版を上に出す。
 */
import { describeChanges } from "~/server/features/statements/diff";
import { jpDateTime, shortHash, type DriverStatementView } from "~/server/features/statements/view";

export type HistoryVersionInput = {
  version: number;
  hash: string;
  createdAt: Date;
  total: number;
  createdByName: string | null;
  /** ドライバーに見せる形（比べるのはこの形どうしだけ。会社の売上などは入らない） */
  view: DriverStatementView;
};

export type HistoryConfirmationInput = { version: number; hash: string; createdAt: Date; totalAtConfirm: number };

export type HistoryConfirmation = {
  at: string;
  total: number;
  /** 確認したときの目印（ハッシュ）が、その版の写しの目印と同じか */
  hashMatches: boolean;
};

export type VersionHistoryItem = {
  version: number;
  /** 写しが残っていない版（古いデータ・確認の記録だけがある版） */
  missing: boolean;
  createdAtText: string | null;
  total: number | null;
  hashShort: string;
  createdByName: string | null;
  current: boolean;
  /** 比べた前の版（最初の版・前の写しが無いときは null） */
  prevVersion: number | null;
  /** 前の版からの違い（短い文。前の版が無ければ空） */
  changes: string[];
  confirmations: HistoryConfirmation[];
};

/**
 * 版の履歴を作る。新しい版が先頭。
 * - 前の版は「写しが残っているうち、いちばん近い古い版」（途中が欠けていても比べられる）
 * - 確認は版の番号で結びつけ、目印（ハッシュ）が同じかも添える
 * - 確認の記録はあるのに写しが無い版も、欠けている版として 1 行にする（何を確認したかの記録を落とさない）
 */
export function buildVersionHistory(versions: HistoryVersionInput[], confirmations: HistoryConfirmationInput[], currentVersion: number): VersionHistoryItem[] {
  const byVersion = new Map<number, HistoryVersionInput>();
  for (const v of versions) if (!byVersion.has(v.version)) byVersion.set(v.version, v);
  const numbers = new Set<number>([...byVersion.keys(), ...confirmations.map((c) => c.version)]);
  const ordered = [...numbers].sort((a, b) => a - b);
  const confsOf = (version: number, hash: string | null) =>
    confirmations
      .filter((c) => c.version === version)
      .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime())
      .map((c) => ({ at: jpDateTime(c.createdAt), total: c.totalAtConfirm, hashMatches: hash !== null && c.hash === hash }));

  const out: VersionHistoryItem[] = [];
  let prev: HistoryVersionInput | null = null;
  for (const n of ordered) {
    const row = byVersion.get(n) ?? null;
    if (!row) {
      const confs = confirmations.filter((c) => c.version === n);
      out.push({
        version: n,
        missing: true,
        createdAtText: null,
        total: confs[0]?.totalAtConfirm ?? null,
        hashShort: shortHash(confs[0]?.hash ?? ""),
        createdByName: null,
        current: n === currentVersion,
        prevVersion: null,
        changes: [],
        confirmations: confsOf(n, null),
      });
      continue;
    }
    out.push({
      version: n,
      missing: false,
      createdAtText: jpDateTime(row.createdAt),
      total: row.total,
      hashShort: shortHash(row.hash),
      createdByName: row.createdByName,
      current: n === currentVersion,
      prevVersion: prev ? prev.version : null,
      changes: prev ? describeChanges(prev.view, row.view) : [],
      confirmations: confsOf(n, row.hash),
    });
    prev = row;
  }
  return out.reverse();
}
