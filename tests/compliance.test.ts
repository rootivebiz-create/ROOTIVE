import { describe, expect, it } from "vitest";
import {
  ROSTER_FIELD_COUNT,
  groupGaps,
  rosterCompleteness,
  rosterFilledCount,
  sortGaps,
  summarizeGaps,
  type Gap,
  type RosterCheckSource,
} from "@/lib/compliance/helpers";

const GAPS: Gap[] = [
  { kind: "health_check_overdue", severity: "medium", driverId: "d2", driverName: "吉田雅一", title: "健康診断", detail: "", onDate: null },
  { kind: "license_missing", severity: "high", driverId: "d2", driverName: "吉田雅一", title: "免許", detail: "", onDate: null },
  { kind: "license_missing", severity: "high", driverId: "d1", driverName: "相曽慧", title: "免許", detail: "", onDate: null },
  { kind: "initial_instruction_missing", severity: "high", driverId: "d1", driverName: "相曽慧", title: "初任の指導", detail: "", onDate: "2026-01-01" },
];

describe("監査で足りないもの", () => {
  it("重大なものが先、同じ種類ならドライバー名の順", () => {
    const sorted = sortGaps(GAPS);
    expect(sorted.map((g) => `${g.severity}:${g.kind}:${g.driverName}`)).toEqual([
      "high:initial_instruction_missing:相曽慧",
      "high:license_missing:吉田雅一",
      "high:license_missing:相曽慧",
      "medium:health_check_overdue:吉田雅一",
    ]);
  });

  it("並べ替えは元の配列を変えない", () => {
    const before = GAPS.map((g) => g.kind);
    sortGaps(GAPS);
    expect(GAPS.map((g) => g.kind)).toEqual(before);
  });

  it("種類ごとにまとめ、見出しは日本語になる", () => {
    const groups = groupGaps(GAPS);
    expect(groups.map((g) => g.kind)).toEqual(["initial_instruction_missing", "license_missing", "health_check_overdue"]);
    expect(groups[1].label).toBe("運転免許証の記録なし");
    expect(groups[1].gaps).toHaveLength(2);
  });

  it("重大・注意・人数を数える", () => {
    expect(summarizeGaps(GAPS)).toEqual({ high: 3, medium: 1, total: 4, drivers: 2 });
    expect(summarizeGaps([])).toEqual({ high: 0, medium: 0, total: 0, drivers: 0 });
  });
});

describe("運転者台帳の記入率", () => {
  const FULL: RosterCheckSource = {
    birthDate: "1986-04-01",
    address: "埼玉県三郷市1-2-3",
    hiredOn: "2024-04-01",
    appointedOn: "2024-04-01",
    licenseNo: "123456789012",
    licenseExpiresOn: "2028-05-01",
  };
  const EMPTY: RosterCheckSource = { birthDate: null, address: "", hiredOn: null, appointedOn: null, licenseNo: "", licenseExpiresOn: null };

  it("1 人ぶんの項目を数える", () => {
    expect(rosterFilledCount(FULL)).toBe(ROSTER_FIELD_COUNT);
    expect(rosterFilledCount(EMPTY)).toBe(0);
    expect(rosterFilledCount({ ...EMPTY, birthDate: "1990-01-01", address: "東京都" })).toBe(2);
  });

  it("全員ぶんの記入率を出す", () => {
    expect(rosterCompleteness([FULL, EMPTY])).toEqual({ filled: 6, total: 12, rate: 0.5 });
    expect(rosterCompleteness([FULL])).toEqual({ filled: 6, total: 6, rate: 1 });
  });

  it("ドライバーが 0 人なら 100%（割り算をしない）", () => {
    expect(rosterCompleteness([])).toEqual({ filled: 0, total: 0, rate: 1 });
  });
});
