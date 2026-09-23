import { describe, expect, it } from "vitest";
import {
  MANUAL_CLOSE_STEPS,
  buildClosingSteps,
  buildInbox,
  closingProgress,
  isManualCloseKey,
  parseOfficeDesk,
  sortInbox,
  todayReporters,
  type ClosingFacts,
  type InboxItem,
  type OfficeDesk,
} from "@/lib/office/desk";

// 2026-09-23 は水曜日（weekday 3）
const TODAY = "2026-09-23";

function desk(patch: Partial<OfficeDesk> = {}): OfficeDesk {
  return {
    today: TODAY,
    month: "2026-08",
    pendingEntries: [],
    pendingEntriesTotal: 0,
    dayOffs: [],
    drivers: [],
    todayReports: [],
    todayEntryDrivers: [],
    todayDispatchDrivers: [],
    todayOffDrivers: [],
    reminders: [],
    tomorrow: null,
    invoicesIssued: [],
    bankUnmatched: 0,
    alertsHigh: [],
    alertsOpen: 0,
    openPastMonths: [],
    closing: facts(),
    ...patch,
  };
}

function facts(patch: Partial<ClosingFacts> = {}): ClosingFacts {
  return {
    status: "open",
    closedAt: null,
    entryCount: 10,
    zeroQty: 0,
    pending: 0,
    rollCallMissing: 0,
    noReport: 0,
    rateDiffs: 0,
    recurringDue: 0,
    recurringUnapplied: 0,
    notices: 0,
    noticeDiffs: 0,
    clients: [],
    unassignedBill: 0,
    invoices: [],
    checks: [],
    ...patch,
  };
}

const driver = (id: string, name: string, extra: Partial<OfficeDesk["drivers"][number]> = {}) => ({
  id,
  name,
  weeklyOff: [] as number[],
  lineLinked: false,
  hasLogin: true,
  ...extra,
});

describe("parseOfficeDesk", () => {
  it("RPC の jsonb を画面の形にする（日付・月は切り詰め、数は数値にする）", () => {
    const d = parseOfficeDesk({
      today: "2026-09-23",
      month: "2026-08-01",
      pending_entries: [{ id: "e1", work_date: "2026-09-21", driver_id: "d1", driver_name: "相曽慧", project_name: "三郷Amazon", item_name: "標準", unit: "day", qty: "1.0", memo: "" }],
      pending_entries_total: "4",
      drivers: [{ id: "d1", name: "相曽慧", weekly_off: [0, 6], line_linked: true, has_login: false }],
      tomorrow: { on_date: "2026-09-24", need: 3, assigned: 2, confirmed: 1, shortage: 1 },
      invoices_issued: [{ id: "i1", client_name: "A 社", invoice_no: "R-1", month: "2026-08-01", due_date: null, total: "1000" }],
      open_past_months: ["2026-07-01", "2026-08-01"],
      closing: { status: "closed", rate_diffs: 2, invoices: [{ id: "i1", client_id: "c1", status: "issued", total: 5 }], checks: [{ key: "transfer_done", done_at: "x", done_by_name: "事務" }] },
    });
    expect(d.month).toBe("2026-08");
    expect(d.pendingEntries[0].qty).toBe(1);
    expect(d.pendingEntriesTotal).toBe(4);
    expect(d.drivers[0]).toEqual({ id: "d1", name: "相曽慧", weeklyOff: [0, 6], lineLinked: true, hasLogin: false });
    expect(d.tomorrow?.shortage).toBe(1);
    expect(d.invoicesIssued[0]).toMatchObject({ month: "2026-08", dueDate: null, total: 1000 });
    expect(d.openPastMonths).toEqual(["2026-07", "2026-08"]);
    expect(d.closing.status).toBe("closed");
    expect(d.closing.rateDiffs).toBe(2);
    expect(d.closing.invoices[0].status).toBe("issued");
    expect(d.closing.checks[0].doneByName).toBe("事務");
  });

  it("壊れた値・欠けた値でも落ちずに空で返す", () => {
    const d = parseOfficeDesk(null);
    expect(d.pendingEntries).toEqual([]);
    expect(d.tomorrow).toBeNull();
    expect(d.closing.status).toBe("open");
    expect(d.closing.entryCount).toBe(0);
    expect(parseOfficeDesk({ drivers: "x", closing: [] }).drivers).toEqual([]);
  });
});

describe("todayReporters（今日の報告）", () => {
  it("配車が無い日は、定休日と承認済みの休みの人を除いた全員が対象", () => {
    const r = todayReporters(
      desk({
        drivers: [driver("a", "相曽慧"), driver("b", "金島幸太", { weeklyOff: [3] }), driver("c", "沼田基"), driver("d", "今井皇輝")],
        todayOffDrivers: ["c"],
      }),
    );
    expect(r.basis).toBe("usual");
    expect(r.expected.map((x) => x.driverId)).toEqual(["a", "d"]);
  });

  it("配車がある日は、配車に入っている人だけが対象（休みの人は外す）", () => {
    const r = todayReporters(
      desk({
        drivers: [driver("a", "相曽慧"), driver("b", "金島幸太"), driver("c", "沼田基")],
        todayDispatchDrivers: ["b", "c"],
        todayOffDrivers: ["c"],
      }),
    );
    expect(r.basis).toBe("dispatch");
    expect(r.expected.map((x) => x.driverId)).toEqual(["b"]);
  });

  it("業務前点呼か、その日の稼働があれば報告済み", () => {
    const r = todayReporters(
      desk({
        drivers: [driver("a", "相曽慧"), driver("b", "金島幸太"), driver("c", "沼田基")],
        todayReports: [
          { driverId: "a", preAt: "2026-09-23T07:00:00+09:00", postAt: null },
          { driverId: "c", preAt: null, postAt: null },
        ],
        todayEntryDrivers: ["b"],
      }),
    );
    expect(r.missing.map((x) => x.driverId)).toEqual(["c"]);
    expect(r.reportedCount).toBe(2);
  });

  it("催促の宛先は、まだの人のうち今日まだ催促しておらず、届く手段がある人", () => {
    const r = todayReporters(
      desk({
        drivers: [
          driver("a", "相曽慧"),
          driver("b", "金島幸太", { hasLogin: false, lineLinked: true }),
          driver("c", "沼田基", { hasLogin: false, lineLinked: false }),
          driver("d", "今井皇輝"),
        ],
        reminders: [{ driverId: "d", sentAt: "2026-09-23T01:32:00Z", sentByName: "事務" }],
      }),
    );
    expect(r.missing).toHaveLength(4);
    expect(r.remindTargets.map((x) => x.driverId)).toEqual(["a", "b"]);
    expect(r.missing.find((x) => x.driverId === "d")?.remindedBy).toBe("事務");
    expect(r.missing.find((x) => x.driverId === "c")?.reachable).toBe(false);
  });
});

describe("buildInbox（今日やること）", () => {
  it("何も無ければ空", () => {
    expect(buildInbox(desk())).toEqual([]);
  });

  it("承認待ちは、昨日より前のものが残っていれば急ぎ", () => {
    const e = (id: string, workDate: string, driverId = "a") => ({ id, workDate, driverId, driverName: "", projectName: "", itemName: "", unit: "day", qty: 1, memo: "" });
    const fresh = buildInbox(desk({ pendingEntries: [e("1", "2026-09-22")], pendingEntriesTotal: 1 }));
    expect(fresh[0]).toMatchObject({ kind: "approve_entries", urgency: "today", action: "approve_entries" });
    const old = buildInbox(desk({ pendingEntries: [e("1", "2026-09-21"), e("2", "2026-09-22", "b")], pendingEntriesTotal: 2 }));
    expect(old[0]).toMatchObject({ kind: "approve_entries", urgency: "now", count: 2 });
    expect(old[0].detail).toContain("2 人分");
    expect(old[0].detail).toContain("9/21");
  });

  it("休み希望は 3 日以内の日なら急ぎ", () => {
    const off = (onDate: string) => ({ id: onDate, onDate, driverId: "a", driverName: "相曽慧", reason: "" });
    expect(buildInbox(desk({ dayOffs: [off("2026-09-26")] }))[0].urgency).toBe("now");
    expect(buildInbox(desk({ dayOffs: [off("2026-09-27")] }))[0].urgency).toBe("today");
  });

  it("明日の人が足りなければ急ぎ、未確定があれば「確定」を出す", () => {
    const items = buildInbox(desk({ tomorrow: { onDate: "2026-09-24", need: 3, assigned: 2, confirmed: 1, shortage: 1 } }));
    expect(items.map((i) => i.kind)).toEqual(["tomorrow_shortage", "tomorrow_unconfirmed"]);
    expect(items[0].href).toBe("/dispatch?from=2026-09-24");
    expect(items[1]).toMatchObject({ count: 1, action: "confirm_tomorrow" });
  });

  it("期日を過ぎた未入金だけを数え、合計額と取引先を出す", () => {
    const inv = (id: string, dueDate: string | null, total: number, clientName: string) => ({ id, clientName, invoiceNo: id, month: "2026-08", dueDate, total });
    const items = buildInbox(
      desk({ invoicesIssued: [inv("1", "2026-09-22", 100000, "A 社"), inv("2", "2026-09-23", 5000, "B 社"), inv("3", null, 1, "C 社"), inv("4", "2026-09-01", 20000, "A 社")] }),
    );
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({ kind: "invoices_overdue", urgency: "now", count: 2 });
    expect(items[0].title).toContain("¥120,000");
    expect(items[0].detail).toBe("A 社");
  });

  it("今日の報告がまだの人を、報告済み・催促済み・連絡手段なしの内訳つきで出す", () => {
    const items = buildInbox(
      desk({
        drivers: [driver("a", "相曽慧"), driver("b", "金島幸太", { hasLogin: false }), driver("c", "沼田基")],
        todayEntryDrivers: ["c"],
      }),
    );
    expect(items[0]).toMatchObject({ kind: "remind_reports", count: 2, action: "remind" });
    expect(items[0].detail).toBe("3 人中 1 人が報告済み・連絡手段なし 1 人");
  });

  it("締めていない過去の月は、いちばん古い月へ案内する", () => {
    const items = buildInbox(desk({ openPastMonths: ["2026-07", "2026-08"] }));
    expect(items[0]).toMatchObject({ kind: "open_months", urgency: "soon", href: "/office?m=2026-07" });
    expect(items[0].title).toBe("2026年7月がまだ締まっていません");
    expect(items[0].detail).toBe("ほかに 1 か月");
  });

  it("急ぎ度 → 種類の順に並ぶ（同じ入力なら同じ並び）", () => {
    const mk = (kind: InboxItem["kind"], urgency: InboxItem["urgency"]): InboxItem => ({ kind, urgency, title: kind, detail: "", count: 1, href: "/" });
    const sorted = sortInbox([mk("bank_unmatched", "soon"), mk("day_offs", "today"), mk("invoices_overdue", "now"), mk("approve_entries", "today"), mk("tomorrow_shortage", "now")]);
    expect(sorted.map((i) => i.kind)).toEqual(["tomorrow_shortage", "invoices_overdue", "approve_entries", "day_offs", "bank_unmatched"]);
  });
});

describe("buildClosingSteps（月締めの手順）", () => {
  const byKey = (steps: ReturnType<typeof buildClosingSteps>) => Object.fromEntries(steps.map((s) => [s.key, s]));

  it("手順は決まった順に並び、手作業の手順が 2 つ入る", () => {
    const steps = buildClosingSteps(facts(), "2026-08", "2026-09");
    expect(steps.map((s) => s.key)).toEqual([
      "entries_approved",
      "entries",
      "reports",
      "rates",
      "recurring",
      "notices",
      "invoices",
      "statements_sent",
      "transfer_done",
      "close",
    ]);
    expect(steps.filter((s) => s.manual).map((s) => s.key)).toEqual(MANUAL_CLOSE_STEPS.map((m) => m.key));
  });

  it("承認待ち・稼働なし・未計上の経費は todo、単価違い・点呼漏れ・数量 0 は warn", () => {
    const s = byKey(
      buildClosingSteps(facts({ pending: 2, entryCount: 0, recurringDue: 3, recurringUnapplied: 1, rateDiffs: 4, rollCallMissing: 1 }), "2026-08", "2026-09"),
    );
    expect(s.entries_approved.status).toBe("todo");
    expect(s.entries.status).toBe("todo");
    expect(s.recurring).toMatchObject({ status: "todo", action: "apply_recurring" });
    expect(s.rates.status).toBe("warn");
    expect(s.reports.status).toBe("warn");
    expect(byKey(buildClosingSteps(facts({ zeroQty: 2 }), "2026-08", "2026-09")).entries.status).toBe("warn");
  });

  it("毎月の経費も支払通知も無い月は対象外", () => {
    const s = byKey(buildClosingSteps(facts(), "2026-08", "2026-09"));
    expect(s.recurring.status).toBe("skip");
    expect(s.notices.status).toBe("skip");
    expect(s.invoices.status).toBe("skip");
  });

  it("請求書：作っていない取引先 → 下書き → 全部発行済み、の順に判定する", () => {
    const clients = [
      { clientId: "c1", clientName: "A 社", bill: 100 },
      { clientId: "c2", clientName: "B 社", bill: 200 },
    ];
    const missing = byKey(buildClosingSteps(facts({ clients, invoices: [{ id: "i1", clientId: "c1", status: "issued", total: 1 }] }), "2026-08", "2026-09")).invoices;
    expect(missing.status).toBe("todo");
    expect(missing.detail).toContain("B 社");
    const drafts = byKey(
      buildClosingSteps(
        facts({ clients, invoices: [{ id: "i1", clientId: "c1", status: "issued", total: 1 }, { id: "i2", clientId: "c2", status: "draft", total: 1 }] }),
        "2026-08",
        "2026-09",
      ),
    ).invoices;
    expect(drafts.detail).toContain("下書き");
    const done = byKey(
      buildClosingSteps(
        facts({ clients, invoices: [{ id: "i1", clientId: "c1", status: "paid", total: 1 }, { id: "i2", clientId: "c2", status: "issued", total: 1 }] }),
        "2026-08",
        "2026-09",
      ),
    ).invoices;
    expect(done.status).toBe("done");
  });

  it("取引先が付いていない案件の売上があれば、請求書は発行済みでも warn", () => {
    const s = byKey(
      buildClosingSteps(
        facts({ clients: [{ clientId: "c1", clientName: "A 社", bill: 1 }], invoices: [{ id: "i1", clientId: "c1", status: "issued", total: 1 }], unassignedBill: 21780 }),
        "2026-08",
        "2026-09",
      ),
    );
    expect(s.invoices.status).toBe("warn");
    expect(s.invoices.detail).toContain("¥21,780");
  });

  it("支払通知は、差があれば warn・無ければ done", () => {
    expect(byKey(buildClosingSteps(facts({ notices: 1, noticeDiffs: 2 }), "2026-08", "2026-09")).notices.status).toBe("warn");
    expect(byKey(buildClosingSteps(facts({ notices: 1 }), "2026-08", "2026-09")).notices.status).toBe("done");
  });

  it("手作業の手順は、チェックがあれば付けた人と一緒に done", () => {
    const s = byKey(buildClosingSteps(facts({ checks: [{ key: "statements_sent", doneAt: "2026-09-05T01:00:00Z", doneByName: "事務" }] }), "2026-08", "2026-09"));
    expect(s.statements_sent).toMatchObject({ status: "done", doneBy: "事務", manual: true });
    expect(s.statements_sent.detail).toBe("事務さんが付けました");
    expect(s.transfer_done.status).toBe("todo");
  });

  it("今月・先の月は締めない（月が終わってから）", () => {
    expect(byKey(buildClosingSteps(facts(), "2026-09", "2026-09")).close.status).toBe("skip");
    expect(byKey(buildClosingSteps(facts(), "2026-10", "2026-09")).close.status).toBe("skip");
  });

  it("締め済みの月は、締める手順が done", () => {
    const steps = buildClosingSteps(facts({ status: "closed" }), "2026-08", "2026-09");
    expect(byKey(steps).close.status).toBe("done");
    expect(closingProgress(steps).closed).toBe(true);
  });
});

describe("closingProgress", () => {
  it("対象外を除いて数え、締める手順より前に todo が無ければ ready", () => {
    const checks = MANUAL_CLOSE_STEPS.map((m) => ({ key: m.key, doneAt: "", doneByName: "事務" }));
    const ready = closingProgress(buildClosingSteps(facts({ checks }), "2026-08", "2026-09"));
    expect(ready.ready).toBe(true);
    expect(ready.closed).toBe(false);
    // 対象外 3 つ（経費・通知・請求書）を除いた 7 つのうち、締める以外の 6 つが済み
    expect(ready).toMatchObject({ done: 6, total: 7 });

    const notReady = closingProgress(buildClosingSteps(facts({ pending: 1 }), "2026-08", "2026-09"));
    expect(notReady.ready).toBe(false);
  });

  it("手順の残りの数を締める手順の説明に出す", () => {
    const steps = buildClosingSteps(facts({ pending: 1 }), "2026-08", "2026-09");
    // 承認待ち ＋ 手作業 2 つ
    expect(steps.find((s) => s.key === "close")?.detail).toContain("残りの手順が 3 つ");
  });
});

describe("isManualCloseKey", () => {
  it("手作業の手順の名前だけを通す（Server Action で使う）", () => {
    expect(isManualCloseKey("statements_sent")).toBe(true);
    expect(isManualCloseKey("transfer_done")).toBe(true);
    expect(isManualCloseKey("close")).toBe(false);
    expect(isManualCloseKey("DROP")).toBe(false);
  });
});
