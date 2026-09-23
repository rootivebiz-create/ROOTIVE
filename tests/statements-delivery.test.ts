import { describe, expect, it } from "vitest";
import {
  canReach,
  planStatementSend,
  sendPreviewText,
  sendStatementsMessage,
  sentCount,
  statementPushPayload,
  statementTargetStatus,
  type StatementTarget,
} from "@/lib/statements/delivery";

function target(id: string, patch: Partial<StatementTarget> = {}): StatementTarget {
  return {
    driverId: id,
    driverName: `ドライバー${id}`,
    payoutIncl: 100000,
    lineReady: false,
    pushReady: false,
    sentAt: null,
    sentChannel: null,
    sentByName: "",
    sentPayoutIncl: null,
    ...patch,
  };
}

const SENT = { sentAt: "2026-09-05T01:00:00Z", sentChannel: "line" as const, sentByName: "事務", sentPayoutIncl: 100000 };

describe("statementTargetStatus", () => {
  it("送信済み・金額が変わった・まだ・連絡手段なし", () => {
    expect(statementTargetStatus(target("a", { ...SENT }))).toBe("sent");
    // 締めを解除して直したら、送った時点の額と違ってくる → 送り直しが要る
    expect(statementTargetStatus(target("a", { ...SENT, payoutIncl: 98000 }))).toBe("changed");
    expect(statementTargetStatus(target("a", { lineReady: true }))).toBe("ready");
    expect(statementTargetStatus(target("a", { pushReady: true }))).toBe("ready");
    expect(statementTargetStatus(target("a"))).toBe("no_contact");
  });

  it("送った時点の額が無い記録（古い記録）は送信済みとみなし、1 円未満の差は同じ額", () => {
    expect(statementTargetStatus(target("a", { ...SENT, sentPayoutIncl: null }))).toBe("sent");
    expect(statementTargetStatus(target("a", { ...SENT, payoutIncl: 100000.4 }))).toBe("sent");
  });
});

describe("planStatementSend", () => {
  const targets = [
    target("a", { lineReady: true }),
    target("b", { lineReady: true, ...SENT }),
    target("c", { pushReady: true }),
    target("d"),
    target("e", { lineReady: true, ...SENT, payoutIncl: 5 }),
  ];

  it("既定：送信済みを飛ばし、連絡手段の無い人を数え、金額が変わった人には送る", () => {
    const plan = planStatementSend(targets);
    expect(plan.send.map((t) => t.driverId)).toEqual(["a", "c", "e"]);
    expect(plan.alreadySent).toBe(1);
    expect(plan.noContact).toBe(1);
  });

  it("送り直すときは送信済みの人にも送る", () => {
    expect(planStatementSend(targets, { resend: true }).send.map((t) => t.driverId)).toEqual(["a", "b", "c", "e"]);
  });

  it("指定した人だけに絞る（空の指定は全員）", () => {
    expect(planStatementSend(targets, { driverIds: ["b", "d"], resend: true })).toMatchObject({ alreadySent: 0, noContact: 1 });
    expect(planStatementSend(targets, { driverIds: ["b", "d"], resend: true }).send.map((t) => t.driverId)).toEqual(["b"]);
    expect(planStatementSend(targets, { driverIds: [] }).send).toHaveLength(3);
  });

  it("sentCount は金額が変わった人を数えない。canReach は LINE か通知", () => {
    expect(sentCount(targets)).toBe(1);
    expect(canReach(targets[0])).toBe(true);
    expect(canReach(targets[3])).toBe(false);
  });
});

describe("文面", () => {
  it("送る前の確認", () => {
    const plan = planStatementSend([target("a", { lineReady: true }), target("b", { pushReady: true }), target("c"), target("d", { lineReady: true, ...SENT })]);
    expect(sendPreviewText(plan)).toBe("LINE で 1 人・アプリの通知で 1 人に送ります（送信済みの 1 人には送りません。連絡手段が無い 1 人は PDF を渡してください）");
    expect(sendPreviewText(planStatementSend([]))).toBe("送れる人がいません");
  });

  it("送った結果", () => {
    expect(sendStatementsMessage({ sent: 3, line: 3, push: 1, failed: 0, alreadySent: 2, noContact: 1 })).toBe(
      "支払明細を 3 人に送りました（LINE 3・通知 1）。送信済みの 2 人は飛ばしました・連絡手段が無い人 1 人。",
    );
    expect(sendStatementsMessage({ sent: 1, line: 1, push: 0, failed: 1, alreadySent: 0, noContact: 0 })).toContain("1 人は送れませんでした");
    expect(sendStatementsMessage({ sent: 0, line: 0, push: 0, failed: 0, alreadySent: 4, noContact: 0 })).toContain("全員に送信済みです（4 人）");
    expect(sendStatementsMessage({ sent: 0, line: 0, push: 0, failed: 0, alreadySent: 2, noContact: 3 })).toBe(
      "送れる人はもういません（送信済み 2 人・連絡手段なし 3 人）。連絡手段が無い人には PDF を渡してください。",
    );
    expect(sendStatementsMessage({ sent: 0, line: 0, push: 0, failed: 0, alreadySent: 0, noContact: 0 })).toContain("送れる人がいませんでした");
  });

  it("端末の通知は明細のページを開く", () => {
    const p = statementPushPayload({ month: "2026-08", monthLabel: "2026年8月", payoutIncl: 123456 });
    expect(p).toMatchObject({ title: "2026年8月の支払明細が届きました", url: "/driver/statements/2026-08", tag: "statement-2026-08" });
    expect(p.body).toContain("¥123,456");
  });
});
