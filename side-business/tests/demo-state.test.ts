import { afterEach, describe, expect, it, vi } from "vitest";
import { buildStatements, summarize } from "@/lib/payroll/calc";
import { sampleData } from "@/lib/payroll/sample";
import type { MonthData } from "@/lib/payroll/types";
import {
  loadMonthData,
  MONTH_KEY,
  parseMonthData,
  parseRequester,
  readStored,
  REQUESTER_KEY,
  sampleRequester,
  writeStored,
} from "@/components/demo/persist";
import { demoReducer, newDriver, newProject, nextId, pasteExample, qtyOf, shiftPayDate } from "@/components/demo/reducer";

const base = () => sampleData("2026-10");

describe("demoReducer：稼働の数量", () => {
  it("setQty は既存の行を書き換え、0 で消し、ない組み合わせは足す", () => {
    let s = base();
    s = demoReducer(s, { type: "setQty", driverId: "d1", projectId: "p1", qty: 2400 });
    expect(qtyOf(s.work, "d1", "p1")).toBe(2400);
    expect(s.work.filter((r) => r.driverId === "d1" && r.projectId === "p1")).toHaveLength(1);

    s = demoReducer(s, { type: "setQty", driverId: "d1", projectId: "p1", qty: 0 });
    expect(s.work.some((r) => r.driverId === "d1" && r.projectId === "p1")).toBe(false);

    s = demoReducer(s, { type: "setQty", driverId: "d2", projectId: "p4", qty: 7.5 });
    expect(qtyOf(s.work, "d2", "p4")).toBe(7.5);
  });

  it("負の数・数でない値は無視する（元の state をそのまま返す）", () => {
    const s = base();
    expect(demoReducer(s, { type: "setQty", driverId: "d1", projectId: "p1", qty: -1 })).toBe(s);
    expect(demoReducer(s, { type: "setQty", driverId: "d1", projectId: "p1", qty: Number.NaN })).toBe(s);
  });

  it("同じ組み合わせの行が 2 つあっても 1 行にまとめて書き換える", () => {
    const s: MonthData = { ...base(), work: [{ driverId: "d1", projectId: "p1", qty: 1 }, { driverId: "d1", projectId: "p1", qty: 2 }] };
    expect(qtyOf(s.work, "d1", "p1")).toBe(3);
    const next = demoReducer(s, { type: "setQty", driverId: "d1", projectId: "p1", qty: 10 });
    expect(next.work).toEqual([{ driverId: "d1", projectId: "p1", qty: 10 }]);
  });

  it("元の state を書き換えない", () => {
    const s = base();
    const before = JSON.stringify(s);
    demoReducer(s, { type: "setQty", driverId: "d1", projectId: "p1", qty: 1 });
    demoReducer(s, { type: "removeDriver", id: "d1" });
    demoReducer(s, { type: "applyPaste", rows: [{ driverId: "d1", projectId: "p1", qty: 5 }], mode: "add" });
    expect(JSON.stringify(s)).toBe(before);
  });
});

describe("demoReducer：貼り付け", () => {
  const rows = [
    { driverId: "d1", projectId: "p1", qty: 100 },
    { driverId: "d1", projectId: "p1", qty: 50 },
    { driverId: "d2", projectId: "p2", qty: 3 },
  ];

  it("置き換えるは今の稼働を消して、同じ組み合わせをまとめる", () => {
    const s = demoReducer(base(), { type: "applyPaste", rows, mode: "replace" });
    expect(s.work).toEqual([
      { driverId: "d1", projectId: "p1", qty: 150 },
      { driverId: "d2", projectId: "p2", qty: 3 },
    ]);
  });

  it("足すは今の数量に足す", () => {
    const s = demoReducer(base(), { type: "applyPaste", rows, mode: "add" });
    expect(qtyOf(s.work, "d1", "p1")).toBe(2310 + 150);
    expect(qtyOf(s.work, "d2", "p2")).toBe(21 + 3);
    expect(qtyOf(s.work, "d4", "p4")).toBe(168);
  });

  it("数量 0 の行は残さない", () => {
    const s = demoReducer(base(), { type: "applyPaste", rows: [{ driverId: "d1", projectId: "p1", qty: 0 }], mode: "replace" });
    expect(s.work).toEqual([]);
  });
});

describe("demoReducer：ドライバー・案件・調整", () => {
  it("ドライバーを消すと、その方の稼働と調整も消える", () => {
    const s = demoReducer(base(), { type: "removeDriver", id: "d1" });
    expect(s.drivers.some((d) => d.id === "d1")).toBe(false);
    expect(s.work.some((r) => r.driverId === "d1")).toBe(false);
    expect(s.adjustments.some((a) => a.driverId === "d1")).toBe(false);
    expect(s.adjustments).toHaveLength(1);
  });

  it("案件を消すと、その案件の稼働も消える", () => {
    const s = demoReducer(base(), { type: "removeProject", id: "p1" });
    expect(s.projects.map((p) => p.id)).toEqual(["p2", "p3", "p4"]);
    expect(s.work.some((r) => r.projectId === "p1")).toBe(false);
  });

  it("upsert は同じ id なら置き換え、なければ最後に足す", () => {
    let s = base();
    s = demoReducer(s, { type: "upsertDriver", driver: { ...s.drivers[0], name: "青木 翔" } });
    expect(s.drivers[0].name).toBe("青木 翔");
    expect(s.drivers).toHaveLength(5);
    const d = newDriver(s);
    expect(d.id).toBe("d6");
    s = demoReducer(s, { type: "upsertDriver", driver: d });
    expect(s.drivers.at(-1)?.id).toBe("d6");

    const p = newProject(s);
    expect(p.id).toBe("p5");
    s = demoReducer(s, { type: "upsertProject", project: { ...p, billRate: 1000, payRate: 800 } });
    expect(s.projects.at(-1)).toMatchObject({ id: "p5", billRate: 1000, payRate: 800 });
  });

  it("調整は金額 0・いないドライバーを受け付けず、空の内容は「調整」にする", () => {
    let s = base();
    expect(demoReducer(s, { type: "addAdjustment", adjustment: { driverId: "d1", label: "x", amount: 0 } })).toBe(s);
    expect(demoReducer(s, { type: "addAdjustment", adjustment: { driverId: "zz", label: "x", amount: 100 } })).toBe(s);
    s = demoReducer(s, { type: "addAdjustment", adjustment: { driverId: "d2", label: "  ", amount: -500 } });
    expect(s.adjustments.at(-1)).toEqual({ driverId: "d2", label: "調整", amount: -500 });
    s = demoReducer(s, { type: "removeAdjustment", index: 0 });
    expect(s.adjustments.map((a) => a.driverId)).toEqual(["d3", "d2"]);
    expect(demoReducer(s, { type: "removeAdjustment", index: 9 })).toBe(s);
  });

  it("調整は振込額に反映される（計算は lib/payroll/calc のまま）", () => {
    const before = buildStatements(base()).find((st) => st.driver.id === "d2")!;
    const s = demoReducer(base(), { type: "addAdjustment", adjustment: { driverId: "d2", label: "高速代", amount: 2000 } });
    const after = buildStatements(s).find((st) => st.driver.id === "d2")!;
    expect(after.total - before.total).toBe(2000);
    expect(summarize(s).payout - summarize(base()).payout).toBe(2000);
  });

  it("reset はサンプルに戻す", () => {
    const s = demoReducer(demoReducer(base(), { type: "removeDriver", id: "d1" }), { type: "reset" });
    expect(s).toEqual(sampleData());
  });
});

describe("demoReducer：設定と対象月", () => {
  it("setSettings は形の合わない月・日付を無視する", () => {
    const s = base();
    const next = demoReducer(s, { type: "setSettings", patch: { companyName: "テスト運送", payDate: "", month: "2026-13" } });
    expect(next.settings.companyName).toBe("テスト運送");
    expect(next.settings.payDate).toBe(s.settings.payDate);
    expect(next.settings.month).toBe(s.settings.month);
    expect(demoReducer(s, { type: "setSettings", patch: { payDate: "2026-11-30" } }).settings.payDate).toBe("2026-11-30");
  });

  it("月を変えると振込日も同じ間隔で動く", () => {
    const s = demoReducer(base(), { type: "setMonth", month: "2026-12" });
    expect(s.settings.month).toBe("2026-12");
    expect(s.settings.payDate).toBe("2027-01-25");
    expect(demoReducer(s, { type: "setMonth", month: "" })).toBe(s);
  });

  it("shiftPayDate：翌々月払い・月末払い・日にちのない月", () => {
    expect(shiftPayDate("2026-10", "2026-12-10", "2027-01")).toBe("2027-03-10");
    expect(shiftPayDate("2026-10", "2026-11-30", "2027-01")).toBe("2027-02-28");
    expect(shiftPayDate("2027-01", "2027-02-28", "2027-03")).toBe("2027-04-30");
    expect(shiftPayDate("2026-12", "2027-01-31", "2027-01")).toBe("2027-02-28");
    expect(shiftPayDate("2026-10", "2026-11-29", "2027-01")).toBe("2027-02-28");
    expect(shiftPayDate("2026-10", "bad", "2026-11")).toBe("2026-12-25");
  });

  it("nextId は数字の一番大きいものの次", () => {
    expect(nextId("d", [])).toBe("d1");
    expect(nextId("d", ["d1", "d10", "d3", "x99", "dx"])).toBe("d11");
  });

  it("pasteExample は見出しつきのタブ区切り", () => {
    const text = pasteExample(base(), 2);
    expect(text.split("\n")).toEqual(["ドライバー\t案件\t数量", "青木 翔太\t宅配（個建て）\t2310", "青木 翔太\tスポット便\t4"]);
  });
});

describe("保存した値の読み込み", () => {
  it("そのまま保存した MonthData は同じ形で戻る", () => {
    const s = base();
    expect(parseMonthData(JSON.parse(JSON.stringify(s)))).toEqual(s);
  });

  it("形の違う値は null", () => {
    expect(parseMonthData(null)).toBeNull();
    expect(parseMonthData("x")).toBeNull();
    expect(parseMonthData({ settings: {}, drivers: [] })).toBeNull();
  });

  it("壊れた行は落とし、足りない設定はサンプルで埋める", () => {
    const raw = {
      settings: { companyName: "A運送", month: "2027-02", payDate: "2027-02-30", taxRounding: "weird", taxRate: 5 },
      drivers: [
        { id: "a", name: "甲", monthlyFee: -5, royaltyRate: 3, bank: { bankCode: "0001", accountType: "checking" } },
        { id: "a", name: "重複" },
        { name: "id なし" },
        "x",
      ],
      projects: [{ id: "p", name: "便", billRate: "1000", payRate: 800 }],
      work: [
        { driverId: "a", projectId: "p", qty: 3 },
        { driverId: "a", projectId: "missing", qty: 3 },
        { driverId: "a", projectId: "p", qty: -1 },
      ],
      adjustments: [{ driverId: "a", label: "立替", amount: 100 }, { driverId: "b", amount: 1 }, { driverId: "a", amount: 0 }],
    };
    const d = parseMonthData(raw)!;
    const sample = sampleData();
    expect(d.settings.companyName).toBe("A運送");
    expect(d.settings.month).toBe("2027-02");
    expect(d.settings.payDate).toBe(sample.settings.payDate);
    expect(d.settings.taxRounding).toBe(sample.settings.taxRounding);
    expect(d.settings.taxRate).toBe(0.1);
    expect(d.drivers).toHaveLength(1);
    expect(d.drivers[0]).toMatchObject({ id: "a", name: "甲", monthlyFee: 0, royaltyRate: 0, invoiceRegistered: false });
    expect(d.drivers[0].bank).toMatchObject({ bankCode: "0001", accountType: "checking", holderKana: "" });
    expect(d.projects[0]).toMatchObject({ billRate: 0, payRate: 800 });
    expect(d.work).toEqual([{ driverId: "a", projectId: "p", qty: 3 }]);
    expect(d.adjustments).toEqual([{ driverId: "a", label: "立替", amount: 100 }]);
  });

  it("振込依頼人：文字の欄がそろっていなければ null、種目は普通か当座", () => {
    expect(parseRequester(sampleRequester())).toEqual(sampleRequester());
    expect(parseRequester({ ...sampleRequester(), code: 123 })).toBeNull();
    expect(parseRequester({ ...sampleRequester(), accountType: "x" })?.accountType).toBe("ordinary");
    expect(parseRequester(undefined)).toBeNull();
  });
});

describe("localStorage が使えないとき", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("window がない（サーバー）なら読みは null・書きは false", () => {
    expect(readStored(MONTH_KEY)).toBeNull();
    expect(writeStored(MONTH_KEY, { a: 1 })).toBe(false);
    expect(loadMonthData()).toBeNull();
  });

  it("localStorage に触ると例外になる環境でも止まらない", () => {
    vi.stubGlobal("window", {
      get localStorage(): Storage {
        throw new Error("SecurityError");
      },
    });
    expect(readStored(MONTH_KEY)).toBeNull();
    expect(writeStored(MONTH_KEY, 1)).toBe(false);
  });

  it("書き込みが容量オーバーで失敗しても false を返すだけ", () => {
    const store = new Map<string, string>();
    vi.stubGlobal("window", {
      localStorage: {
        getItem: (k: string) => store.get(k) ?? null,
        setItem: () => {
          throw new Error("QuotaExceededError");
        },
      },
    });
    expect(writeStored(REQUESTER_KEY, sampleRequester())).toBe(false);
    expect(readStored(REQUESTER_KEY)).toBeNull();
  });

  it("保存できる環境では書いた値を読み戻せる・壊れた JSON は null", () => {
    const store = new Map<string, string>();
    vi.stubGlobal("window", {
      localStorage: {
        getItem: (k: string) => store.get(k) ?? null,
        setItem: (k: string, v: string) => void store.set(k, v),
      },
    });
    expect(writeStored(MONTH_KEY, base())).toBe(true);
    expect(loadMonthData()).toEqual(base());
    store.set(MONTH_KEY, "{broken");
    expect(loadMonthData()).toBeNull();
  });
});
