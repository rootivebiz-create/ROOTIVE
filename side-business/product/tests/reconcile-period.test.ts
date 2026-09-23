/** 突き合わせる稼働の期間（元請の締め日）と、お支払通知の日付の読み方（純関数） */
import { describe, expect, it } from "vitest";
import { detectColumns, parseNoticeRows } from "~/server/features/reconcile/columns";
import { receivingFacts } from "~/server/features/reconcile/facts";
import { closingDayText, periodNotes, periodText, selectPeriodWork, type PeriodWork } from "~/server/features/reconcile/period";

const w = (month: string, projectId: string, qty: number, workDate: string | null = null): PeriodWork => ({ month, projectId, driverId: "d1", qty, workDate });
const sum = (list: { qty: number }[]) => list.reduce((a, x) => a + x.qty, 0);

describe("元請の締めの期間で比べるか", () => {
  const ids = new Set(["p1"]);

  it("締め日が当社と同じ（どちらも月末）なら、当社の月の稼働をそのまま使う（日付が無くてよい）", () => {
    const { work, period } = selectPeriodWork({
      month: "2026-10-01",
      tenantClosingDay: 0,
      clientClosingDay: 0,
      projectIds: ids,
      work: [w("2026-09-01", "p1", 5), w("2026-10-01", "p1", 7), w("2026-11-01", "p1", 9)],
    });
    expect(sum(work)).toBe(7);
    expect(period).toMatchObject({ mode: "month", differs: false, fallback: false, from: "2026-10-01", to: "2026-10-31" });
    expect(periodNotes(period, "A物流")).toEqual([]);
  });

  it("当社も元請も 20 日締めなら、当社の月＝元請の締めの期間（日付が無くてよい）", () => {
    const { work, period } = selectPeriodWork({ month: "2026-10-01", tenantClosingDay: 20, clientClosingDay: 20, projectIds: ids, work: [w("2026-10-01", "p1", 7)] });
    expect(sum(work)).toBe(7);
    expect(period).toMatchObject({ mode: "month", differs: false, from: "2026-09-21", to: "2026-10-20" });
  });

  it("元請が 20 日締めで稼働に日付があれば、9/21〜10/20 の稼働を前の月からも拾う", () => {
    const { work, period } = selectPeriodWork({
      month: "2026-10-01",
      tenantClosingDay: 0,
      clientClosingDay: 20,
      projectIds: ids,
      work: [
        w("2026-09-01", "p1", 1, "2026-09-20"), // 期間の外
        w("2026-09-01", "p1", 2, "2026-09-21"),
        w("2026-10-01", "p1", 3, "2026-10-20"),
        w("2026-10-01", "p1", 4, "2026-10-21"), // 11 月分
        w("2026-10-01", "p2", 5, null), // 突き合わせない案件は日付が無くてもよい
      ],
    });
    expect(sum(work)).toBe(5);
    expect(period).toMatchObject({ mode: "closing", differs: true, fallback: false, from: "2026-09-21", to: "2026-10-20", closingDay: 20, emptyMonths: [] });
    expect(periodText(period)).toBe("2026年9月21日〜2026年10月20日");
  });

  it("期間にかかる稼働に日付の無いものがあれば、当社の月で比べて知らせる", () => {
    const { work, period } = selectPeriodWork({
      month: "2026-10-01",
      tenantClosingDay: 0,
      clientClosingDay: 20,
      projectIds: ids,
      work: [w("2026-09-01", "p1", 10), w("2026-10-01", "p1", 3, "2026-10-05"), w("2026-10-01", "p1", 4, "2026-10-25")],
    });
    expect(sum(work)).toBe(7);
    expect(period).toMatchObject({ mode: "month", fallback: true, undatedCount: 1, from: "2026-10-01", to: "2026-10-31", clientPeriod: { from: "2026-09-21", to: "2026-10-20" } });
    const notes = periodNotes(period, "B商事");
    expect(notes.map((n) => [n.tone, n.title])).toEqual([["warn", "締め日が違うため月単位で比べています"]]);
    expect(notes[0].body).toContain("B商事の締め日は毎月20日で、お支払通知は 2026年9月21日〜2026年10月20日 の分です");
  });

  it("前の月の稼働がまだ 1 件も入っていないときは、その部分を 0 で数えていると知らせる", () => {
    const { work, period } = selectPeriodWork({ month: "2026-10-01", tenantClosingDay: 0, clientClosingDay: 20, projectIds: ids, work: [w("2026-10-01", "p1", 3, "2026-10-05")] });
    expect(sum(work)).toBe(3);
    expect(period).toMatchObject({ mode: "closing", emptyMonths: ["2026-09-01"] });
    expect(periodNotes(period, "B商事").map((n) => n.title)).toEqual(["B商事の締めの期間（2026年9月21日〜2026年10月20日）で比べています", "2026年9月の稼働がまだ入っていません"]);
  });

  it("当社が 15 日締め・元請が 20 日締め：期間（9/21〜10/20）は当社の 10 月（9/16〜10/15）と 11 月（10/16〜11/15）にかかる", () => {
    const { work, period } = selectPeriodWork({
      month: "2026-10-01",
      tenantClosingDay: 15,
      clientClosingDay: 20,
      projectIds: ids,
      work: [w("2026-10-01", "p1", 3, "2026-09-25"), w("2026-11-01", "p1", 4, "2026-10-18"), w("2026-11-01", "p1", 5, "2026-10-30"), w("2026-09-01", "p1", 6)],
    });
    // 9 月（8/16〜9/15）は期間にかからないので、日付が無くてもよい
    expect(sum(work)).toBe(7);
    expect(period).toMatchObject({ mode: "closing", from: "2026-09-21", to: "2026-10-20" });
  });

  it("元請が分からない（削除された）ときは当社の月。締め日の言い方", () => {
    const { period } = selectPeriodWork({ month: "2026-10-01", tenantClosingDay: 0, clientClosingDay: null, projectIds: ids, work: [] });
    expect(period).toMatchObject({ mode: "month", differs: false });
    expect([closingDayText(0), closingDayText(20), closingDayText(31), closingDayText(null)]).toEqual(["末日", "20日", "末日", "末日"]);
  });
});

describe("お支払通知の日付（締めの期間）", () => {
  const rows = (lines: string[]) => [["日付", "品目", "数量", "単価", "金額"], ...lines.map((l) => l.split(","))];

  it("締めの期間を渡すと、その外の行を数える（暦の月の外でも期間の中なら数えない）", () => {
    const table = rows(["9/25,宅配,10,190,1900", "10/20,宅配,10,190,1900", "10/21,宅配,10,190,1900"]);
    const det = detectColumns(table, 0);
    const byMonth = parseNoticeRows(table, 0, det.columns, { rounding: "round", month: "2026-10-01" });
    expect(byMonth.dates).toEqual({ from: "2026-09-25", to: "2026-10-21", outside: 1 });
    const byPeriod = parseNoticeRows(table, 0, det.columns, { rounding: "round", month: "2026-10-01", period: { from: "2026-09-21", to: "2026-10-20" } });
    expect(byPeriod.dates).toEqual({ from: "2026-09-25", to: "2026-10-21", outside: 1 });
    expect(byPeriod.warnings).toEqual(["締めの期間（2026年9月21日〜2026年10月20日）の外の日付の行が 1 行あります。別の月の分が入っていないか確かめてください。"]);
  });

  it("1 月分の「12/25」は、締めの期間（12/21〜1/20）に入る前の年として読む（年が書いてあればそのまま）", () => {
    const table = rows(["12/25,宅配,10,190,1900", "1/10,宅配,10,190,1900", "2025/12/25,宅配,10,190,1900"]);
    const det = detectColumns(table, 0);
    const out = parseNoticeRows(table, 0, det.columns, { rounding: "round", month: "2027-01-01", period: { from: "2026-12-21", to: "2027-01-20" } });
    expect(out.lines.map((l) => l.date)).toEqual(["2026-12-25", "2027-01-10", "2025-12-25"]);
    expect(out.dates?.outside).toBe(1);
  });

  it("入金までの日数：締め日が月末でなければ、締めの日から数える", () => {
    // 10/20 締め → 12/20 は 61 日後（月末から数えると 50 日で、知らせない）
    expect(receivingFacts({ month: "2026-10-01", paidOn: "2026-12-20", feeDeducted: 0 })).toEqual([]);
    const facts = receivingFacts({ month: "2026-10-01", paidOn: "2026-12-20", feeDeducted: 0, periodEnd: "2026-10-20" });
    expect(facts.map((f) => f.title)).toEqual(["入金日が締めの日から60日を超えています"]);
    expect(facts[0].detail).toContain("元請の締めの日（2026年10月20日）から 61日後");
    // 月末締めなら今までどおり
    expect(receivingFacts({ month: "2026-10-01", paidOn: "2026-12-31", feeDeducted: 0, periodEnd: "2026-10-31" })[0].title).toBe("入金日が月末から60日を超えています");
  });
});
