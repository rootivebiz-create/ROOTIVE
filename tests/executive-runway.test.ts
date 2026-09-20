import { describe, expect, it } from "vitest";
import { addDays } from "@/components/cashflow/helpers";
import {
  calcRunway,
  runwayStatus,
  runwayText,
  RUNWAY_SAFE_DAYS,
  RUNWAY_WATCH_DAYS,
  type RunwayInput,
} from "@/lib/executive/runway";
import type { CashEvent } from "@/lib/db/types";

/* ---------------------------------------------------------------- 道具 */

const FROM = "2026-09-20";
const CLIENT = "11111111-1111-4111-8111-111111111111";

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

/** 入金（＋） */
const inflow = (day: number, amount: number): CashEvent => ev({ event_date: addDays(FROM, day), amount, kind: "invoice" });
/** 支払（−） */
const outflow = (day: number, amount: number): CashEvent =>
  ev({ event_date: addDays(FROM, day), amount: -Math.abs(amount), kind: "payout", label: "相曽慧", detail: "2026年09月の支払" });

function runwayOf(over: Partial<RunwayInput> = {}) {
  return calcRunway({ from: FROM, to: addDays(FROM, 90), openingBalance: 1_000_000, events: [], ...over });
}

/* ---------------------------------------------------------------- 期間と日数 */

describe("calcRunway：期間と日数", () => {
  it("見た期間の日数は起点からの日数（両端を含まない差）", () => {
    expect(runwayOf({ to: addDays(FROM, 90) }).coveredDays).toBe(90);
    expect(runwayOf({ to: FROM }).coveredDays).toBe(0);
  });

  it("入金・支払の合計と期末の残高を返す", () => {
    const r = runwayOf({ openingBalance: 500_000, events: [inflow(5, 300_000), outflow(10, 200_000)] });
    expect(r.inflow).toBe(300_000);
    expect(r.outflow).toBe(200_000);
    expect(r.net).toBe(100_000);
    expect(r.endingBalance).toBe(600_000);
    expect(r.eventCount).toBe(2);
  });

  it("期間の外の予定は数えない", () => {
    const r = runwayOf({ to: addDays(FROM, 10), events: [outflow(5, 100_000), outflow(20, 900_000)] });
    expect(r.eventCount).toBe(1);
    expect(r.outflow).toBe(100_000);
  });
});

/* ---------------------------------------------------------------- 最低残高 */

describe("calcRunway：いちばん残高が少なくなる日", () => {
  it("支払で残高が減る日と額を返す", () => {
    const r = runwayOf({ openingBalance: 1_000_000, events: [outflow(10, 400_000), inflow(20, 500_000)] });
    expect(r.minBalance).toBe(600_000);
    expect(r.minBalanceOn).toBe(addDays(FROM, 10));
  });

  it("入金しか無ければ起点の残高がいちばん少ない", () => {
    const r = runwayOf({ openingBalance: 50_000, events: [inflow(5, 200_000)] });
    expect(r.minBalance).toBe(50_000);
    expect(r.minBalanceOn).toBe(FROM);
  });

  it("予定が 1 件も無ければ起点の残高のまま", () => {
    const r = runwayOf({ openingBalance: 300_000, events: [] });
    expect(r.minBalance).toBe(300_000);
    expect(r.minBalanceOn).toBe(FROM);
    expect(r.endingBalance).toBe(300_000);
  });
});

/* ---------------------------------------------------------------- マイナスにならないとき */

describe("calcRunway：現金がマイナスにならないとき", () => {
  it("zeroOn・daysLeft は null、shortfall は 0", () => {
    const r = runwayOf({ openingBalance: 1_000_000, events: [outflow(10, 300_000), inflow(20, 100_000)] });
    expect(r.zeroOn).toBeNull();
    expect(r.daysLeft).toBeNull();
    expect(r.shortfall).toBe(0);
    expect(r.holdDays).toBe(r.coveredDays);
  });

  it("ちょうど 0 円まで減ってもマイナスではない", () => {
    const r = runwayOf({ openingBalance: 300_000, events: [outflow(10, 300_000)] });
    expect(r.minBalance).toBe(0);
    expect(r.zeroOn).toBeNull();
    expect(r.shortfall).toBe(0);
  });
});

/* ---------------------------------------------------------------- マイナスになるとき */

describe("calcRunway：現金がマイナスになるとき", () => {
  it("最初にマイナスになる日・そこまでの日数・いちばん足りない額を返す", () => {
    const r = runwayOf({
      to: addDays(FROM, 120),
      openingBalance: 100_000,
      events: [outflow(10, 150_000), outflow(30, 200_000), inflow(40, 1_000_000)],
    });
    expect(r.zeroOn).toBe(addDays(FROM, 10));
    expect(r.daysLeft).toBe(10);
    expect(r.holdDays).toBe(10);
    expect(r.minBalance).toBe(-250_000);
    expect(r.minBalanceOn).toBe(addDays(FROM, 30));
    expect(r.shortfall).toBe(250_000);
    // 期間が長くても、マイナスになる見込みがあれば danger
    expect(r.coveredDays).toBe(120);
    expect(r.status).toBe("danger");
  });

  it("起点の残高がすでにマイナスなら、その日が 0 日目", () => {
    const r = runwayOf({ openingBalance: -10_000, events: [] });
    expect(r.zeroOn).toBe(FROM);
    expect(r.daysLeft).toBe(0);
    expect(r.holdDays).toBe(0);
    expect(r.shortfall).toBe(10_000);
    expect(r.status).toBe("danger");
  });
});

/* ---------------------------------------------------------------- 信号の境界 */

describe("calcRunway：信号が切り替わる日数", () => {
  const hold = (days: number) => runwayOf({ to: addDays(FROM, days), openingBalance: 1_000_000, events: [outflow(1, 1_000)] });

  it("29 日は danger、30 日から watch", () => {
    expect(hold(RUNWAY_WATCH_DAYS - 1).status).toBe("danger");
    expect(hold(RUNWAY_WATCH_DAYS).status).toBe("watch");
  });

  it("89 日は watch、90 日から safe", () => {
    expect(hold(RUNWAY_SAFE_DAYS - 1).status).toBe("watch");
    expect(hold(RUNWAY_SAFE_DAYS).status).toBe("safe");
  });

  it("runwayStatus は日数とマイナスの見込みだけで決まる", () => {
    expect(runwayStatus(365, true)).toBe("danger");
    expect(runwayStatus(29, false)).toBe("danger");
    expect(runwayStatus(30, false)).toBe("watch");
    expect(runwayStatus(89, false)).toBe("watch");
    expect(runwayStatus(90, false)).toBe("safe");
  });
});

/* ---------------------------------------------------------------- 持ち月数 */

describe("calcRunway：持ち月数", () => {
  it("平均支出から小数 1 桁で出す", () => {
    // 30 日で 300,000 円の支出 → 1 か月あたり 300,000 円。1,000,000 ÷ 300,000 = 3.33… → 3.3
    const r = runwayOf({ to: addDays(FROM, 30), openingBalance: 1_000_000, events: [outflow(10, 300_000)] });
    expect(r.monthsLeft).toBe(3.3);
  });

  it("支出が無ければ出せない（null）", () => {
    expect(runwayOf({ events: [inflow(5, 100_000)] }).monthsLeft).toBeNull();
    expect(runwayOf({ events: [] }).monthsLeft).toBeNull();
  });

  it("残高がマイナスなら 0", () => {
    const r = runwayOf({ to: addDays(FROM, 30), openingBalance: -50_000, events: [outflow(10, 300_000)] });
    expect(r.monthsLeft).toBe(0);
  });
});

/* ---------------------------------------------------------------- 文章 */

describe("runwayText", () => {
  it("マイナスになる日があれば日数と日付を出す", () => {
    const r = runwayOf({ openingBalance: 100_000, events: [outflow(10, 150_000)] });
    expect(runwayText(r)).toBe("現金はあと 10 日です（9月30日に残高がマイナスの見込み）。");
  });

  it("足りるときは期間を出す", () => {
    expect(runwayText(runwayOf({ to: addDays(FROM, 90) }))).toBe("現金は 90 日先まで足りる見込みです。");
  });

  it("見込みが無いときも日本語で返す", () => {
    expect(runwayText(null)).toBe("資金の見込みはまだ出せません。");
  });
});
