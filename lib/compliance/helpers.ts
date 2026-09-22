/**
 * 監査対応の組み立て（純関数）。
 *
 * DB のビュー（v_compliance_gaps / v_record_retention / v_driver_roster）の行を、
 * 画面が出しやすい形にまとめる。判定は DB 側に置き、ここでは並べ替えと数えるだけにする。
 */
import { COMPLIANCE_GAP_LABELS } from "@/lib/db/types";

export type GapSeverity = "high" | "medium";

export interface Gap {
  kind: string;
  severity: GapSeverity;
  driverId: string;
  driverName: string;
  title: string;
  detail: string;
  onDate: string | null;
}

export interface GapGroup {
  kind: string;
  label: string;
  severity: GapSeverity;
  gaps: Gap[];
}

export interface ComplianceSummary {
  high: number;
  medium: number;
  total: number;
  /** 不足のあるドライバーの人数 */
  drivers: number;
}

/** 重大なものが先、同じなら種類の順 → ドライバー名の順（同じ入力なら必ず同じ並び） */
export function sortGaps(gaps: readonly Gap[]): Gap[] {
  const rank = (s: GapSeverity) => (s === "high" ? 0 : 1);
  return [...gaps].sort(
    (a, b) =>
      rank(a.severity) - rank(b.severity) ||
      a.kind.localeCompare(b.kind) ||
      a.driverName.localeCompare(b.driverName, "ja"),
  );
}

/** 種類ごとにまとめる（画面は種類の見出しで並べる） */
export function groupGaps(gaps: readonly Gap[]): GapGroup[] {
  const map = new Map<string, GapGroup>();
  for (const g of sortGaps(gaps)) {
    const cur = map.get(g.kind);
    if (cur) cur.gaps.push(g);
    else map.set(g.kind, { kind: g.kind, label: COMPLIANCE_GAP_LABELS[g.kind] ?? g.title, severity: g.severity, gaps: [g] });
  }
  return [...map.values()];
}

export function summarizeGaps(gaps: readonly Gap[]): ComplianceSummary {
  return {
    high: gaps.filter((g) => g.severity === "high").length,
    medium: gaps.filter((g) => g.severity === "medium").length,
    total: gaps.length,
    drivers: new Set(gaps.map((g) => g.driverId)).size,
  };
}

/** 台帳の記入がどこまで埋まっているか（0〜1）。監査の準備の進み具合として出す */
export interface RosterCompleteness {
  filled: number;
  total: number;
  rate: number;
}

export interface RosterCheckSource {
  birthDate: string | null;
  address: string;
  hiredOn: string | null;
  appointedOn: string | null;
  licenseNo: string;
  licenseExpiresOn: string | null;
}

/** 1 人ぶんの記入項目（6 つ）のうち、いくつ埋まっているか */
export function rosterFilledCount(r: RosterCheckSource): number {
  return [
    r.birthDate != null,
    r.address !== "",
    r.hiredOn != null,
    r.appointedOn != null,
    r.licenseNo !== "",
    r.licenseExpiresOn != null,
  ].filter(Boolean).length;
}

export const ROSTER_FIELD_COUNT = 6;

/** 在籍ドライバー全員ぶんの記入率 */
export function rosterCompleteness(rows: readonly RosterCheckSource[]): RosterCompleteness {
  const total = rows.length * ROSTER_FIELD_COUNT;
  const filled = rows.reduce((acc, r) => acc + rosterFilledCount(r), 0);
  return { filled, total, rate: total === 0 ? 1 : filled / total };
}
