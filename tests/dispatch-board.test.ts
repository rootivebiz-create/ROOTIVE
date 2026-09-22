import { describe, expect, it } from "vitest";
import {
  autoAssign,
  buildDispatchBoard,
  dateRange,
  dispatchForecast,
  needFor,
  offReasonFor,
  shortDateJa,
  summarizeOutlook,
  weekStart,
  weekdayOf,
  type Assignment,
  type BoardInput,
  type DayOff,
  type DemandDay,
  type DemandPattern,
  type DispatchDriver,
  type DispatchItem,
  type OutlookDay,
} from "@/lib/dispatch/board";

/**
 * 配車（これから先の予定）の純関数のテスト。
 * 2026-09-21 は月曜、2026-09-27 は日曜。
 */

const ITEMS: DispatchItem[] = [
  { id: "i1", projectId: "p1", projectName: "三郷Amazon", itemName: "標準", label: "三郷Amazon", unit: "day", billRate: 23025, payRate: 21780 },
  { id: "i2", projectId: "p2", projectName: "川崎ヤマト", itemName: "宅急便", label: "川崎ヤマト（宅急便）", unit: "piece", billRate: 180, payRate: 162 },
];

const DRIVERS: DispatchDriver[] = [
  { id: "d1", name: "相曽慧", weeklyOff: [] },
  { id: "d2", name: "金島幸太", weeklyOff: [0] }, // 日曜が定休
  { id: "d3", name: "沼田基", weeklyOff: [] },
];

const WEEK = dateRange("2026-09-21", 7);

function board(patch: Partial<BoardInput> = {}) {
  return buildDispatchBoard({
    dates: WEEK,
    items: ITEMS,
    drivers: DRIVERS,
    patterns: [],
    demandDays: [],
    assignments: [],
    dayOffs: [],
    ...patch,
  });
}

describe("日付", () => {
  it("曜日を UTC で読む（時差でずれない）", () => {
    expect(weekdayOf("2026-09-21")).toBe(1);
    expect(weekdayOf("2026-09-27")).toBe(0);
  });

  it("週の始まりは月曜。日曜は前の週に入れる", () => {
    expect(weekStart("2026-09-21")).toBe("2026-09-21");
    expect(weekStart("2026-09-24")).toBe("2026-09-21");
    expect(weekStart("2026-09-27")).toBe("2026-09-21");
    expect(weekStart("2026-09-28")).toBe("2026-09-28");
  });

  it("連続する日付を作る", () => {
    expect(dateRange("2026-09-21", 3)).toEqual(["2026-09-21", "2026-09-22", "2026-09-23"]);
    expect(dateRange("2026-09-21", 0)).toEqual([]);
  });

  it("見出しは「9/21（月）」", () => {
    expect(shortDateJa("2026-09-21")).toBe("9/21（月）");
  });
});

describe("needFor", () => {
  const patterns: DemandPattern[] = [{ projectItemId: "i1", weekday: 1, need: 2 }];
  const days: DemandDay[] = [{ projectItemId: "i1", onDate: "2026-09-21", need: 5 }];

  it("曜日のパターンを使う", () => {
    expect(needFor("i1", "2026-09-28", patterns, [])).toBe(2);
    expect(needFor("i1", "2026-09-22", patterns, [])).toBe(0);
  });

  it("特定の日の指定が曜日より優先される", () => {
    expect(needFor("i1", "2026-09-21", patterns, days)).toBe(5);
  });

  it("どちらも無ければ 0", () => {
    expect(needFor("i2", "2026-09-21", patterns, days)).toBe(0);
  });
});

describe("offReasonFor", () => {
  const offs: DayOff[] = [
    { driverId: "d1", onDate: "2026-09-22", status: "approved" },
    { driverId: "d1", onDate: "2026-09-23", status: "requested" },
    { driverId: "d1", onDate: "2026-09-24", status: "rejected" },
  ];

  it("承認済みの休み・定休日・申請中を見分ける", () => {
    expect(offReasonFor(DRIVERS[0], "2026-09-22", offs)).toBe("approved");
    expect(offReasonFor(DRIVERS[0], "2026-09-23", offs)).toBe("requested");
    expect(offReasonFor(DRIVERS[0], "2026-09-24", offs)).toBe("none");
    expect(offReasonFor(DRIVERS[1], "2026-09-27", offs)).toBe("weekly");
  });

  it("承認済みの休みは定休日より先に出す", () => {
    const off: DayOff[] = [{ driverId: "d2", onDate: "2026-09-27", status: "approved" }];
    expect(offReasonFor(DRIVERS[1], "2026-09-27", off)).toBe("approved");
  });
});

describe("buildDispatchBoard", () => {
  const patterns: DemandPattern[] = [
    { projectItemId: "i1", weekday: 1, need: 2 },
    { projectItemId: "i1", weekday: 2, need: 1 },
  ];
  const assignments: Assignment[] = [
    { id: "a1", onDate: "2026-09-21", driverId: "d1", projectItemId: "i1", qtyPlan: 1, status: "confirmed" },
    { id: "a2", onDate: "2026-09-22", driverId: "d2", projectItemId: "i1", qtyPlan: 1, status: "planned" },
    { id: "a3", onDate: "2026-09-22", driverId: "d3", projectItemId: "i1", qtyPlan: 1, status: "cancelled" },
  ];

  it("必要人数と割り当てから過不足を出す", () => {
    const b = board({ patterns, assignments });
    const row = b.items.find((r) => r.item.id === "i1")!;
    const mon = row.days.find((d) => d.date === "2026-09-21")!;
    expect(mon.need).toBe(2);
    expect(mon.assigned).toBe(1);
    expect(mon.shortage).toBe(1);
    expect(mon.excess).toBe(0);
  });

  it("取り消した割り当ては数えない", () => {
    const b = board({ patterns, assignments });
    const tue = b.items.find((r) => r.item.id === "i1")!.days.find((d) => d.date === "2026-09-22")!;
    expect(tue.assigned).toBe(1);
    expect(tue.shortage).toBe(0);
  });

  it("多すぎる日は excess で出す", () => {
    const many: Assignment[] = [
      { id: "x1", onDate: "2026-09-22", driverId: "d1", projectItemId: "i1", qtyPlan: 1, status: "planned" },
      { id: "x2", onDate: "2026-09-22", driverId: "d2", projectItemId: "i1", qtyPlan: 1, status: "planned" },
      { id: "x3", onDate: "2026-09-22", driverId: "d3", projectItemId: "i1", qtyPlan: 1, status: "planned" },
    ];
    const tue = board({ patterns, assignments: many }).items[0].days.find((d) => d.date === "2026-09-22")!;
    expect(tue.need).toBe(1);
    expect(tue.assigned).toBe(3);
    expect(tue.excess).toBe(2);
    expect(tue.shortage).toBe(0);
  });

  it("ドライバーの行に休みと稼働日数が出る", () => {
    const b = board({
      patterns,
      assignments,
      dayOffs: [{ driverId: "d1", onDate: "2026-09-23", status: "approved" }],
    });
    const d1 = b.drivers.find((r) => r.driver.id === "d1")!;
    expect(d1.workDays).toBe(1);
    expect(d1.days.find((d) => d.date === "2026-09-23")!.off).toBe("approved");
    const d2 = b.drivers.find((r) => r.driver.id === "d2")!;
    // 日曜が定休日
    expect(d2.days.find((d) => d.date === "2026-09-27")!.off).toBe("weekly");
    expect(d2.offDays).toBe(1);
  });

  it("足りない日を日付順・多い順で並べる", () => {
    const b = board({
      patterns: [
        { projectItemId: "i1", weekday: 1, need: 3 },
        { projectItemId: "i2", weekday: 1, need: 1 },
      ],
      assignments,
    });
    expect(b.shortages[0]).toMatchObject({ date: "2026-09-21", projectItemId: "i1", shortage: 2 });
    expect(b.shortages[1]).toMatchObject({ date: "2026-09-21", projectItemId: "i2", shortage: 1 });
  });

  it("予定の売上・支払・粗利を出す", () => {
    const b = board({ patterns, assignments });
    // 生きている割り当ては 2 件（三郷Amazon 1 日 × 2）
    expect(b.totals.planBill).toBe(23025 * 2);
    expect(b.totals.planPay).toBe(21780 * 2);
    expect(b.totals.planMargin).toBe((23025 - 21780) * 2);
  });

  it("案件が空でも落ちない", () => {
    const b = buildDispatchBoard({ dates: WEEK, items: [], drivers: [], patterns: [], demandDays: [], assignments: [], dayOffs: [] });
    expect(b.items).toEqual([]);
    expect(b.totals.shortage).toBe(0);
  });
});

describe("autoAssign", () => {
  const patterns: DemandPattern[] = [{ projectItemId: "i1", weekday: 1, need: 2 }];

  it("足りないところを埋める提案を作る（保存はしない）", () => {
    const b = board({ patterns });
    const { proposals, unfilled } = autoAssign(b);
    expect(proposals).toHaveLength(2);
    expect(proposals.every((p) => p.onDate === "2026-09-21" && p.projectItemId === "i1")).toBe(true);
    expect(unfilled).toHaveLength(0);
  });

  it("承認済みの休みと定休日の人は選ばない", () => {
    const b = board({
      patterns: [{ projectItemId: "i1", weekday: 0, need: 3 }], // 日曜に 3 人
      dayOffs: [{ driverId: "d1", onDate: "2026-09-27", status: "approved" }],
    });
    const { proposals, unfilled } = autoAssign(b);
    // d1 は休み、d2 は日曜が定休 → d3 だけ
    expect(proposals.map((p) => p.driverId)).toEqual(["d3"]);
    expect(unfilled[0]).toMatchObject({ date: "2026-09-27", shortage: 2 });
  });

  it("申請中の休みの人は最後に回す", () => {
    const b = board({
      patterns: [{ projectItemId: "i1", weekday: 1, need: 1 }],
      dayOffs: [{ driverId: "d1", onDate: "2026-09-21", status: "requested" }],
    });
    const { proposals } = autoAssign(b);
    expect(proposals[0].driverId).not.toBe("d1");
  });

  it("同じ日に 2 つ目は入れない（既定）", () => {
    const b = board({
      patterns: [
        { projectItemId: "i1", weekday: 1, need: 3 },
        { projectItemId: "i2", weekday: 1, need: 3 },
      ],
    });
    const { proposals } = autoAssign(b);
    const monday = proposals.filter((p) => p.onDate === "2026-09-21");
    const perDriver = new Map<string, number>();
    for (const p of monday) perDriver.set(p.driverId, (perDriver.get(p.driverId) ?? 0) + 1);
    expect([...perDriver.values()].every((n) => n === 1)).toBe(true);
  });

  it("慣れている人を優先する", () => {
    const b = board({
      patterns: [{ projectItemId: "i1", weekday: 2, need: 1 }],
      assignments: [
        // d3 は月曜に i1 に入っている（慣れている）
        { id: "a1", onDate: "2026-09-21", driverId: "d3", projectItemId: "i1", qtyPlan: 1, status: "confirmed" },
      ],
    });
    const { proposals } = autoAssign(b);
    expect(proposals[0].driverId).toBe("d3");
  });

  it("数量は渡した関数で決める（個数の案件）", () => {
    const b = board({ patterns: [{ projectItemId: "i2", weekday: 1, need: 1 }] });
    const { proposals } = autoAssign(b, { qtyFor: (itemId) => (itemId === "i2" ? 40 : 1) });
    expect(proposals[0].qtyPlan).toBe(40);
  });

  it("同じ入力なら必ず同じ結果になる", () => {
    const b = board({ patterns });
    const a = autoAssign(b).proposals.map((p) => `${p.onDate}|${p.driverId}`);
    const c = autoAssign(b).proposals.map((p) => `${p.onDate}|${p.driverId}`);
    expect(a).toEqual(c);
  });

  it("足りていれば何も提案しない", () => {
    const b = board({
      patterns: [{ projectItemId: "i1", weekday: 1, need: 1 }],
      assignments: [{ id: "a1", onDate: "2026-09-21", driverId: "d1", projectItemId: "i1", qtyPlan: 1, status: "planned" }],
    });
    expect(autoAssign(b).proposals).toHaveLength(0);
  });
});

describe("dispatchForecast", () => {
  it("配車から売上・支払・粗利の見込みを出す", () => {
    const f = dispatchForecast(
      [
        { id: "a1", onDate: "2026-09-21", driverId: "d1", projectItemId: "i1", qtyPlan: 1, status: "confirmed" },
        { id: "a2", onDate: "2026-09-22", driverId: "d1", projectItemId: "i2", qtyPlan: 800, status: "planned" },
        { id: "a3", onDate: "2026-09-22", driverId: "d2", projectItemId: "i1", qtyPlan: 1, status: "cancelled" },
      ],
      ITEMS,
    );
    expect(f.assignments).toBe(2);
    expect(f.days).toBe(2);
    expect(f.bill).toBe(23025 + 180 * 800);
    expect(f.pay).toBe(21780 + 162 * 800);
    expect(f.margin).toBe(f.bill - f.pay);
  });

  it("何も無ければ 0", () => {
    const f = dispatchForecast([], ITEMS);
    expect(f).toEqual({ days: 0, assignments: 0, bill: 0, pay: 0, margin: 0 });
  });
});

describe("summarizeOutlook（ダッシュボードの見通し）", () => {
  const DAYS: OutlookDay[] = [
    { date: "2026-09-22", need: 3, assigned: 3, confirmed: 3, shortage: 0, planBill: 30000, planPay: 24000, planMargin: 6000 },
    { date: "2026-09-23", need: 3, assigned: 1, confirmed: 0, shortage: 2, planBill: 10000, planPay: 8000, planMargin: 2000 },
    { date: "2026-09-24", need: 2, assigned: 2, confirmed: 1, shortage: 0, planBill: 20000, planPay: 16000, planMargin: 4000 },
  ];

  it("必要・割り当て・不足と予定の売上をまとめる", () => {
    const o = summarizeOutlook(DAYS);
    expect(o.totals.need).toBe(8);
    expect(o.totals.assigned).toBe(6);
    expect(o.totals.shortage).toBe(2);
    expect(o.totals.planBill).toBe(60000);
    expect(o.totals.planPay).toBe(48000);
    expect(o.totals.planMargin).toBe(12000);
  });

  it("足りない日といちばん近い日、確定していない数を出す", () => {
    const o = summarizeOutlook(DAYS);
    expect(o.shortDays.map((d) => d.date)).toEqual(["2026-09-23"]);
    expect(o.firstShortDate).toBe("2026-09-23");
    // 23 日の 1 件と 24 日の 1 件がまだ確定していない
    expect(o.unconfirmed).toBe(2);
  });

  it("日数で切る（順番が入れ替わっていても日付順に見る）", () => {
    const shuffled = [DAYS[2], DAYS[0], DAYS[1]];
    const o = summarizeOutlook(shuffled, 2);
    expect(o.days.map((d) => d.date)).toEqual(["2026-09-22", "2026-09-23"]);
    expect(o.totals.need).toBe(6);
    expect(o.totals.planBill).toBe(40000);
  });

  it("何も無ければ 0（足りない日も無い）", () => {
    const o = summarizeOutlook([]);
    expect(o.totals).toEqual({ need: 0, assigned: 0, confirmed: 0, shortage: 0, planBill: 0, planPay: 0, planMargin: 0 });
    expect(o.firstShortDate).toBeNull();
    expect(o.shortDays).toEqual([]);
  });
});
