import { describe, expect, it } from "vitest";
import { CSV_BOM } from "@/lib/exports/csv";
import { CASHFLOW_CSV_HEADERS, cashflowCsvFilename, cashflowToCsvRow, toCashflowCsv } from "@/lib/exports/cashflow-csv";
import { cashRangeSchema, deleteCashSnapshotSchema, saveCashSnapshotSchema } from "@/lib/schemas/cash";
import {
  activePresetKey,
  addDays,
  addMonthsToDate,
  buildCashTimeline,
  cashSummary,
  daysBetween,
  eachDate,
  fillDailyBalances,
  formatMonthDayJa,
  gradientOffset,
  MAX_RANGE_DAYS,
  negativeBalanceMessage,
  pickOpeningBalance,
  presetRange,
  rangeQuery,
  resolveRange,
  sortCashRows,
  toCashflowCsvRows,
  toCashRow,
  toSnapshotRow,
  todayJST,
  weekdayJa,
  type CashDay,
} from "@/components/cashflow/helpers";
import type { CashEvent, CashSnapshot } from "@/lib/db/types";

const CLIENT = "11111111-1111-4111-8111-111111111111";
const DRIVER = "22222222-2222-4222-8222-222222222222";
const EXPENSE = "33333333-3333-4333-8333-333333333333";
const SNAPSHOT = "44444444-4444-4444-8444-444444444444";

/** RPC cash_forecast の 1 行 */
function ev(over: Partial<CashEvent> & { event_date: string; amount: number }): CashEvent {
  return {
    kind: "invoice",
    label: "取引先A",
    detail: "INV-001",
    ref_id: CLIENT,
    status: "planned",
    month: "2026-09-01",
    ...over,
  };
}

const invoice = (date: string, amount: number, over: Partial<CashEvent> = {}) => ev({ event_date: date, amount, kind: "invoice", ...over });
const payout = (date: string, amount: number, over: Partial<CashEvent> = {}) =>
  ev({ event_date: date, amount: -Math.abs(amount), kind: "payout", label: "相曽慧", detail: "2026年09月の支払", ref_id: DRIVER, ...over });
const expense = (date: string, amount: number, over: Partial<CashEvent> = {}) =>
  ev({ event_date: date, amount: -Math.abs(amount), kind: "expense", label: "事務所家賃", detail: "9 月分家賃", ref_id: EXPENSE, status: "done", ...over });

const snapshot = (as_of: string, balance: number, over: Partial<CashSnapshot> = {}): CashSnapshot => ({
  id: SNAPSHOT,
  company_id: "55555555-5555-4555-8555-555555555555",
  as_of,
  balance,
  memo: "",
  created_by: null,
  created_at: "2026-09-01T00:00:00Z",
  updated_at: "2026-09-01T00:00:00Z",
  ...over,
});

const timelineOf = (events: CashEvent[], openingBalance: number, from = "2026-10-01", to = "2026-12-31"): CashDay[] =>
  buildCashTimeline({ events, openingBalance, from, to });

// ---------------------------------------------------------------------------
// 日付ユーティリティ
// ---------------------------------------------------------------------------

describe("日付ユーティリティ（日本時間）", () => {
  it("今日は日本時間で判定する（UTC 15:00 は翌日）", () => {
    expect(todayJST(new Date("2026-09-18T14:59:00Z"))).toBe("2026-09-18");
    expect(todayJST(new Date("2026-09-18T15:00:00Z"))).toBe("2026-09-19");
    expect(todayJST(new Date("2026-12-31T15:00:00Z"))).toBe("2027-01-01");
  });

  it("日・月の加算、日数、日付の列挙（月末は詰める・うるう年）", () => {
    expect(addDays("2026-09-18", 90)).toBe("2026-12-17");
    expect(addDays("2026-03-01", -1)).toBe("2026-02-28");
    expect(addMonthsToDate("2026-09-18", 6)).toBe("2027-03-18");
    expect(addMonthsToDate("2026-01-31", 1)).toBe("2026-02-28");
    expect(addMonthsToDate("2028-01-31", 1)).toBe("2028-02-29");
    expect(daysBetween("2026-09-18", "2026-09-18")).toBe(1);
    expect(daysBetween("2026-09-18", "2026-09-20")).toBe(3);
    expect(daysBetween("2026-09-20", "2026-09-18")).toBe(0);
    expect(eachDate("2026-09-29", "2026-10-02")).toEqual(["2026-09-29", "2026-09-30", "2026-10-01", "2026-10-02"]);
    expect(eachDate("2026-10-02", "2026-09-29")).toEqual([]);
    expect(eachDate("2026-01-01", "2030-01-01").length).toBe(MAX_RANGE_DAYS);
    expect(weekdayJa("2026-09-18")).toBe("金");
    expect(formatMonthDayJa("2026-11-30")).toBe("11月30日");
  });
});

// ---------------------------------------------------------------------------
// 期間（?from= / ?to=）
// ---------------------------------------------------------------------------

describe("期間の決定", () => {
  it("未指定なら今日から 90 日後まで", () => {
    const now = new Date("2026-09-18T01:00:00Z");
    expect(resolveRange(undefined, undefined, now)).toEqual({ from: "2026-09-18", to: "2026-12-17" });
    expect(rangeQuery(resolveRange(undefined, undefined, now))).toBe("from=2026-09-18&to=2026-12-17");
  });

  it("不正な値は既定に戻し、逆転した期間は開始日に揃え、長すぎる期間は上限で切る", () => {
    const now = new Date("2026-09-18T01:00:00Z");
    expect(resolveRange("2026-13-01", "not-a-date", now)).toEqual({ from: "2026-09-18", to: "2026-12-17" });
    expect(resolveRange("2026-02-30", undefined, now).from).toBe("2026-09-18"); // 実在しない日付
    expect(resolveRange("2026-10-01", "2026-09-01", now)).toEqual({ from: "2026-10-01", to: "2026-10-01" });
    expect(resolveRange(["2026-10-01"], ["2026-10-31"], now)).toEqual({ from: "2026-10-01", to: "2026-10-31" });
    const capped = resolveRange("2026-01-01", "2030-01-01", now);
    expect(daysBetween(capped.from, capped.to)).toBe(MAX_RANGE_DAYS);
  });

  it("プリセット（30 日 / 60 日 / 90 日 / 6 か月）と現在の選択状態", () => {
    const today = "2026-09-18";
    expect(presetRange("30d", today)).toEqual({ from: today, to: "2026-10-18" });
    expect(presetRange("6m", today)).toEqual({ from: today, to: "2027-03-18" });
    expect(presetRange("unknown", today)).toEqual({ from: today, to: "2026-12-17" }); // 既定は 90 日
    expect(activePresetKey({ from: today, to: "2026-10-18" }, today)).toBe("30d");
    expect(activePresetKey({ from: today, to: "2027-03-18" }, today)).toBe("6m");
    expect(activePresetKey({ from: today, to: "2026-10-20" }, today)).toBeNull(); // カスタム
    expect(activePresetKey({ from: "2026-08-01", to: "2026-10-30" }, today)).toBeNull(); // 起点が今日でない
  });
});

// ---------------------------------------------------------------------------
// 起点残高
// ---------------------------------------------------------------------------

describe("起点残高（cash_snapshots）", () => {
  it("期間開始日以前で一番新しい残高を選び、無ければ null", () => {
    const rows = [snapshot("2026-08-31", 1_000_000), snapshot("2026-09-30", 2_000_000, { id: "s2", memo: "〇〇銀行" }), snapshot("2026-10-05", 3_000_000, { id: "s3" })];
    expect(pickOpeningBalance(rows, "2026-10-01")).toEqual({ id: "s2", asOf: "2026-09-30", balance: 2_000_000, memo: "〇〇銀行" });
    expect(pickOpeningBalance(rows, "2026-10-05")?.asOf).toBe("2026-10-05"); // 開始日ちょうどは対象
    expect(pickOpeningBalance(rows, "2026-08-01")).toBeNull();
    expect(pickOpeningBalance([], "2026-10-01")).toBeNull();
    expect(toSnapshotRow(snapshot("2026-09-30", 2_000_000))).toEqual({ id: SNAPSHOT, asOf: "2026-09-30", balance: 2_000_000, memo: "" });
  });
});

// ---------------------------------------------------------------------------
// 残高の積み上げ
// ---------------------------------------------------------------------------

describe("残高の積み上げ（buildCashTimeline）", () => {
  it("起点残高から日付順に積み上げ、予定の無い日は行を作らない", () => {
    const timeline = timelineOf([expense("2026-10-31", 120_000), invoice("2026-10-10", 500_000), payout("2026-10-25", 300_000)], 1_000_000);
    expect(timeline.map((d) => d.date)).toEqual(["2026-10-10", "2026-10-25", "2026-10-31"]);
    expect(timeline.map((d) => d.balance)).toEqual([1_500_000, 1_200_000, 1_080_000]);
    expect(timeline[0]).toMatchObject({ inflow: 500_000, outflow: 0, net: 500_000 });
    expect(timeline[1]).toMatchObject({ inflow: 0, outflow: 300_000, net: -300_000 });
    expect(timeline.every((d) => d.events.length === 1)).toBe(true);
  });

  it("入金と支払が同じ日：入金 → ドライバー支払 → 経費の順に並び、その日の増減と残高は 1 行にまとまる", () => {
    const timeline = timelineOf(
      [expense("2026-10-25", 50_000), payout("2026-10-25", 300_000), invoice("2026-10-25", 800_000), payout("2026-10-25", 400_000, { label: "高森豪介" })],
      100_000,
    );
    expect(timeline).toHaveLength(1);
    const day = timeline[0];
    expect(day.events.map((e) => [e.kind, e.amount])).toEqual([
      ["invoice", 800_000],
      ["payout", -400_000],
      ["payout", -300_000],
      ["expense", -50_000],
    ]);
    expect(day.inflow).toBe(800_000);
    expect(day.outflow).toBe(750_000);
    expect(day.net).toBe(50_000);
    expect(day.balance).toBe(150_000);
  });

  it("期間の端：from / to ちょうどは含み、範囲外と日付なしは除く", () => {
    const events = [
      invoice("2026-09-30", 100_000),
      invoice("2026-10-01", 200_000),
      invoice("2026-12-31", 300_000),
      invoice("2027-01-01", 400_000),
      ev({ event_date: "", amount: 999_999 }),
    ];
    const timeline = timelineOf(events, 0);
    expect(timeline.map((d) => d.date)).toEqual(["2026-10-01", "2026-12-31"]);
    expect(timeline[timeline.length - 1].balance).toBe(500_000);
  });

  it("起点残高が未登録なら 0 円から積み上げる", () => {
    const timeline = timelineOf([payout("2026-10-25", 300_000)], 0);
    expect(timeline[0].balance).toBe(-300_000);
    expect(cashSummary(timeline).negativeDays).toBe(1);
  });

  it("実績・確定・予定が混ざっても同じ時間軸に並び、状態のラベルが付く", () => {
    const timeline = timelineOf(
      [
        invoice("2026-10-05", 200_000, { status: "done", detail: "INV-009（入金済み）" }),
        payout("2026-10-15", 100_000, { status: "confirmed" }),
        expense("2026-10-20", 30_000, { status: "planned", detail: "家賃（予定）" }),
      ],
      500_000,
    );
    expect(timeline.map((d) => d.events[0].statusLabel)).toEqual(["実績", "確定", "予定"]);
    expect(timeline.map((d) => d.events[0].kindLabel)).toEqual(["入金", "ドライバー支払", "経費"]);
    expect(timeline.map((d) => d.balance)).toEqual([700_000, 600_000, 570_000]);
  });

  it("RPC の行の正規化（null は空文字、稼動月は YYYY-MM、並び替えは副作用なし）", () => {
    const raw = { event_date: "2026-10-10", kind: "invoice", label: "取引先A", detail: "INV-001", amount: 1000, ref_id: CLIENT, status: "planned", month: "2026-09-01" } as CashEvent;
    expect(toCashRow(raw, 2)).toEqual({
      key: `invoice-${CLIENT}-2026-10-10-2`,
      date: "2026-10-10",
      kind: "invoice",
      kindLabel: "入金",
      label: "取引先A",
      detail: "INV-001",
      amount: 1000,
      status: "planned",
      statusLabel: "予定",
      refId: CLIENT,
      month: "2026-09",
    });
    const rows = [invoice("2026-10-10", 100), payout("2026-10-10", 200)].map((e, i) => toCashRow(e, i));
    const sorted = sortCashRows(rows);
    expect(sorted.map((r) => r.kind)).toEqual(["invoice", "payout"]);
    expect(rows.map((r) => r.kind)).toEqual(["invoice", "payout"]); // 元の配列は変えない
  });

  it("小数を含む金額でも誤差なく合計する（sumMoney）", () => {
    const timeline = timelineOf([invoice("2026-10-01", 0.1), invoice("2026-10-01", 0.2), payout("2026-10-02", 0.3)], 0);
    expect(timeline[0].inflow).toBe(0.3);
    expect(timeline[1].balance).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// サマリー・マイナス残高
// ---------------------------------------------------------------------------

describe("サマリー（cashSummary）", () => {
  it("入金・支払・差引・最低残高・マイナスの日を求める", () => {
    const timeline = timelineOf([invoice("2026-11-10", 500_000), payout("2026-11-30", 900_000), invoice("2026-12-10", 600_000)], 300_000);
    const s = cashSummary(timeline);
    expect(s.inflow).toBe(1_100_000);
    expect(s.outflow).toBe(900_000);
    expect(s.net).toBe(200_000);
    expect(s.minBalance).toBe(-100_000);
    expect(s.minBalanceDate).toBe("2026-11-30");
    expect(s.negativeDays).toBe(1);
    expect(s.firstNegativeDate).toBe("2026-11-30");
    expect(s.eventCount).toBe(3);
    expect(negativeBalanceMessage(s)).toBe("11月30日に残高がマイナスになる見込みです（最低残高 -¥100,000／11月30日）。入金予定の前倒しや支払の調整を検討してください。");
  });

  it("マイナスが続く日はすべて数え、最初の日を警告に使う", () => {
    const timeline = timelineOf([payout("2026-11-28", 400_000), expense("2026-11-29", 100_000), invoice("2026-12-05", 1_000_000)], 300_000);
    const s = cashSummary(timeline);
    expect(s.negativeDays).toBe(2);
    expect(s.firstNegativeDate).toBe("2026-11-28");
    expect(s.minBalance).toBe(-200_000);
    expect(s.minBalanceDate).toBe("2026-11-29");
  });

  it("予定が 1 件も無ければ合計は 0、最低残高は null（警告も出さない）", () => {
    const s = cashSummary([]);
    expect(s).toEqual({ inflow: 0, outflow: 0, net: 0, minBalance: null, minBalanceDate: null, negativeDays: 0, firstNegativeDate: null, eventCount: 0 });
    expect(negativeBalanceMessage(s)).toBeNull();
    expect(negativeBalanceMessage(cashSummary(timelineOf([invoice("2026-10-01", 100)], 0)))).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// グラフ用の日次残高
// ---------------------------------------------------------------------------

describe("グラフ用の日次残高（fillDailyBalances）", () => {
  it("予定の無い日は前日の残高を引き継ぎ、期間の全日分を返す", () => {
    const from = "2026-10-01";
    const to = "2026-10-05";
    const timeline = buildCashTimeline({ events: [invoice("2026-10-03", 100_000), payout("2026-10-04", 50_000)], openingBalance: 200_000, from, to });
    const points = fillDailyBalances(timeline, from, to, 200_000);
    expect(points.map((p) => p.date)).toEqual(["2026-10-01", "2026-10-02", "2026-10-03", "2026-10-04", "2026-10-05"]);
    expect(points.map((p) => p.balance)).toEqual([200_000, 200_000, 300_000, 250_000, 250_000]);
    expect(points.map((p) => p.hasEvents)).toEqual([false, false, true, true, false]);
    expect(points[2]).toMatchObject({ inflow: 100_000, outflow: 0, net: 100_000 });
    expect(fillDailyBalances([], from, to).map((p) => p.balance)).toEqual([0, 0, 0, 0, 0]); // 起点残高なし
  });

  it("マイナスを含む折れ線の色の切り替え位置（gradientOffset）", () => {
    expect(gradientOffset([])).toBe(1);
    expect(gradientOffset([100, 200])).toBe(1); // すべてプラス
    expect(gradientOffset([-100, -200])).toBe(0); // すべてマイナス
    expect(gradientOffset([100, -100])).toBe(0.5);
    expect(gradientOffset([300, -100])).toBe(0.75);
  });
});

// ---------------------------------------------------------------------------
// CSV
// ---------------------------------------------------------------------------

describe("資金繰り CSV", () => {
  it("列並びは 日付 / 種別 / 相手先 / 内容 / 入金 / 支払 / 残高 / 状態 / 稼動月", () => {
    expect([...CASHFLOW_CSV_HEADERS]).toEqual(["日付", "種別", "相手先", "内容", "入金", "支払", "残高", "状態", "稼動月"]);
    expect(cashflowCsvFilename("2026-09-18", "2026-12-17")).toBe("資金繰り_2026-09-18_2026-12-17.csv");
  });

  it("入金と支払を別の列に分け、残高はその日の残高、ヘッダー・BOM・CRLF 付きで出力する", () => {
    const timeline = timelineOf([invoice("2026-10-10", 550_000, { label: "株式会社A, B" }), payout("2026-10-10", 300_000), expense("2026-10-31", 120_000)], 1_000_000);
    const rows = toCashflowCsvRows(timeline);
    expect(rows).toHaveLength(3);
    expect(rows[0]).toMatchObject({ date: "2026-10-10", kindLabel: "入金", inflow: 550_000, outflow: 0, balance: 1_250_000, statusLabel: "予定", month: "2026-09" });
    expect(rows[1]).toMatchObject({ kindLabel: "ドライバー支払", inflow: 0, outflow: 300_000, balance: 1_250_000 });
    expect(rows[2]).toMatchObject({ kindLabel: "経費", outflow: 120_000, balance: 1_130_000, statusLabel: "実績" });

    const csv = toCashflowCsv(rows);
    expect(csv.startsWith(CSV_BOM)).toBe(true);
    const lines = csv.slice(1).split("\r\n");
    expect(lines[0]).toBe(CASHFLOW_CSV_HEADERS.join(","));
    expect(lines[1]).toBe('2026-10-10,入金,"株式会社A, B",INV-001,550000,0,1250000,予定,2026-09');
    expect(lines[3]).toBe("2026-10-31,経費,事務所家賃,9 月分家賃,0,120000,1130000,実績,2026-09");
    expect(lines[4]).toBe("");
  });

  it("マイナス残高・小数はカンマ無しの生の値で出す", () => {
    expect(cashflowToCsvRow({ date: "2026-11-30", kindLabel: "経費", label: "通信費", detail: "携帯", inflow: 0, outflow: 12_345.5, balance: -100_000, statusLabel: "予定", month: "2026-11" })).toEqual([
      "2026-11-30",
      "経費",
      "通信費",
      "携帯",
      "0",
      "12345.5",
      "-100000",
      "予定",
      "2026-11",
    ]);
    expect(toCashflowCsv([]).slice(1)).toBe(`${CASHFLOW_CSV_HEADERS.join(",")}\r\n`);
  });
});

// ---------------------------------------------------------------------------
// スキーマ
// ---------------------------------------------------------------------------

describe("残高のスキーマ", () => {
  it("全角・カンマ・¥ 付きの金額を受け付け、マイナス残高も許容する", () => {
    expect(saveCashSnapshotSchema.parse({ as_of: "2026-09-18", balance: "１，２３４，５６７", memo: " 〇〇銀行 " })).toEqual({
      as_of: "2026-09-18",
      balance: 1_234_567,
      memo: "〇〇銀行",
    });
    expect(saveCashSnapshotSchema.parse({ as_of: "2026-09-18", balance: "¥-50,000", memo: "" }).balance).toBe(-50_000);
    expect(saveCashSnapshotSchema.parse({ as_of: "2028-02-29", balance: 0, memo: "" }).as_of).toBe("2028-02-29"); // うるう年は通る
  });

  it("実在しない日付・空欄・桁あふれ・小数 3 桁は日本語のエラーになる", () => {
    const bad = (input: unknown) => saveCashSnapshotSchema.safeParse(input);
    expect(bad({ as_of: "2026-02-30", balance: 1, memo: "" }).success).toBe(false);
    expect(bad({ as_of: "2026-13-01", balance: 1, memo: "" }).success).toBe(false);
    expect(bad({ as_of: "", balance: 1, memo: "" }).success).toBe(false);
    expect(bad({ as_of: "2026-09-18", balance: "", memo: "" }).success).toBe(false);
    expect(bad({ as_of: "2026-09-18", balance: "あ", memo: "" }).success).toBe(false);
    expect(bad({ as_of: "2026-09-18", balance: 1.234, memo: "" }).success).toBe(false);
    expect(bad({ as_of: "2026-09-18", balance: 1_000_000_000, memo: "" }).success).toBe(false);
    const res = bad({ as_of: "2026-02-30", balance: 1, memo: "" });
    expect(res.success ? "" : res.error.issues[0].message).toBe("日付は YYYY-MM-DD 形式で入力してください");
    expect(deleteCashSnapshotSchema.safeParse({ id: "not-a-uuid" }).success).toBe(false);
    expect(deleteCashSnapshotSchema.safeParse({ id: SNAPSHOT }).success).toBe(true);
  });

  it("期間は開始日 ≦ 終了日", () => {
    expect(cashRangeSchema.safeParse({ from: "2026-10-01", to: "2026-10-01" }).success).toBe(true);
    const ng = cashRangeSchema.safeParse({ from: "2026-10-02", to: "2026-10-01" });
    expect(ng.success).toBe(false);
    expect(ng.success ? "" : ng.error.issues[0].message).toBe("終了日は開始日と同じか後の日にしてください");
  });
});
