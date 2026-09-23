import { describe, expect, it } from "vitest";
import {
  countStatuses,
  countsSentence,
  deemedDaysOf,
  matchesFilter,
  parseFilter,
  statementStatus,
  type StatusInput,
} from "~/server/features/statements/status";
import { cleanBody, groupThreads, MESSAGE_MAX } from "~/server/features/statements/threads";
import {
  jpDateTime,
  jpDateWithWeekday,
  jpShortDateTime,
  linkExpiresAt,
  maskAccount,
  shareLinks,
  shareMessage,
  type DriverStatementView,
} from "~/server/features/statements/view";

const DAY = 86_400_000;
const t0 = new Date("2026-11-02T09:00:00+09:00");
const at = (days: number) => new Date(t0.getTime() + days * DAY);

function input(over: Partial<StatusInput> = {}): StatusInput {
  return { version: 1, sentAt: null, viewedAt: null, updatedAt: at(-1), confirmations: [], driverMessages: [], ...over };
}

describe("明細の状態", () => {
  it("未送付 → 送付済み → 開封 → 確認済み", () => {
    expect(statementStatus(input(), t0, 7)).toMatchObject({ key: "unsent", label: "未送付", needsResend: false });
    expect(statementStatus(input({ sentAt: t0 }), at(1), 7)).toMatchObject({ key: "sent", label: "送付済み" });
    expect(statementStatus(input({ sentAt: t0, viewedAt: at(0.1) }), at(1), 7)).toMatchObject({ key: "viewed", label: "開封" });
    const confirmed = statementStatus(input({ sentAt: t0, viewedAt: at(0.1), confirmations: [{ version: 1, createdAt: at(0.2) }] }), at(1), 7);
    expect(confirmed).toMatchObject({ key: "confirmed", label: "確認済み", tone: "green", lastConfirmedVersion: 1 });
    expect(confirmed.confirmedAt?.getTime()).toBe(at(0.2).getTime());
  });

  it("前の版だけ確認していれば「確認後に変更あり」、送ったあとで変わっていれば送り直しの印", () => {
    const st = statementStatus(
      input({ version: 2, sentAt: t0, viewedAt: at(0.1), updatedAt: at(2), confirmations: [{ version: 1, createdAt: at(0.2) }] }),
      at(3),
      7,
    );
    expect(st).toMatchObject({ key: "changed", label: "確認後に変更あり", needsResend: true, lastConfirmedVersion: 1, confirmedAt: null });
    // 送り直したら送り直しの印は消えるが、確認はまだ
    const resent = statementStatus(
      input({ version: 2, sentAt: at(2.5), viewedAt: at(0.1), updatedAt: at(2), confirmations: [{ version: 1, createdAt: at(0.2) }] }),
      at(3),
      7,
    );
    expect(resent).toMatchObject({ key: "changed", needsResend: false });
  });

  it("みなし確認：今の中身を送ってから決めた日数が過ぎ、連絡が無いときだけ", () => {
    expect(statementStatus(input({ sentAt: t0 }), at(6.9), 7).key).toBe("sent");
    const deemed = statementStatus(input({ sentAt: t0 }), at(7), 7);
    expect(deemed).toMatchObject({ key: "deemed", label: "みなし確認（7日経過）", deemedDays: 7, tone: "green" });
    expect(statementStatus(input({ sentAt: t0 }), at(10.5), 7).label).toBe("みなし確認（10日経過）");
    // 日数は会社ごと
    expect(statementStatus(input({ sentAt: t0 }), at(3), 3).key).toBe("deemed");
    // 送ってから質問があった（解決していても）→ みなさない
    const asked = input({ sentAt: t0, driverMessages: [{ createdAt: at(1), resolvedAt: at(2), readAt: at(1) }] });
    expect(statementStatus(asked, at(9), 7).key).toBe("sent");
    // 送る前の質問でも、解決していなければみなさない
    const open = input({ sentAt: t0, driverMessages: [{ createdAt: at(-0.5), resolvedAt: null, readAt: null }] });
    expect(statementStatus(open, at(9), 7).key).toBe("sent");
    // 送ったあとで中身が変わった（新しい中身は送っていない）→ みなさない
    expect(statementStatus(input({ sentAt: t0, updatedAt: at(1) }), at(9), 7)).toMatchObject({ key: "sent", needsResend: true });
    // はっきり確認していれば、そちらが先
    expect(statementStatus(input({ sentAt: t0, confirmations: [{ version: 1, createdAt: at(8) }] }), at(9), 7).key).toBe("confirmed");
  });

  it("質問の数と未読", () => {
    const st = statementStatus(
      input({
        driverMessages: [
          { createdAt: at(0), resolvedAt: null, readAt: null },
          { createdAt: at(0), resolvedAt: null, readAt: at(0.5) },
          { createdAt: at(0), resolvedAt: at(1), readAt: at(0.5) },
        ],
      }),
      at(2),
      7,
    );
    expect(st).toMatchObject({ openQuestions: 2, unread: 1 });
  });

  it("日数の設定：既定 7、範囲外は 1〜60 に収める", () => {
    expect(deemedDaysOf({})).toBe(7);
    expect(deemedDaysOf(null)).toBe(7);
    expect(deemedDaysOf({ deemedConfirmDays: 10 })).toBe(10);
    expect(deemedDaysOf({ deemedConfirmDays: 0 })).toBe(7);
    expect(deemedDaysOf({ deemedConfirmDays: 365 })).toBe(60);
  });

  it("絞り込みと件数・一文", () => {
    const list = [
      statementStatus(input(), t0, 7),
      statementStatus(input({ sentAt: t0 }), at(1), 7),
      statementStatus(input({ sentAt: t0, confirmations: [{ version: 1, createdAt: at(1) }] }), at(1), 7),
      statementStatus(input({ sentAt: t0 }), at(8), 7),
      statementStatus(input({ sentAt: t0, driverMessages: [{ createdAt: at(1), resolvedAt: null, readAt: null }] }), at(2), 7),
    ];
    const c = countStatuses(list);
    expect(c).toMatchObject({ all: 5, unsent: 1, sent: 2, confirmed: 1, deemed: 1, todo: 3, question: 1, changed: 0 });
    expect(countsSentence(c)).toBe("5人中 1人が確認済み（ほかに みなし確認 1人）");
    expect(matchesFilter(list[4], "question")).toBe(true);
    expect(parseFilter("deemed")).toBe("deemed");
    expect(parseFilter("x")).toBe("all");
    expect(parseFilter(undefined)).toBe("all");
  });
});

describe("送る文面・リンク・口座・日付", () => {
  it("決まった文面で、LINE・SMS・メールのリンクを作る", () => {
    const msg = shareMessage("青木 翔太", "2026-10-01", "https://example.test/s/abc");
    expect(msg).toBe("青木 翔太さん　2026年10月分の支払明細です。内容をご確認のうえ『確認しました』を押してください。https://example.test/s/abc");
    const links = shareLinks({ message: msg, subject: "件名", phone: "090-1234-5678", email: "a@example.test" });
    expect(links.line).toBe(`https://line.me/R/msg/text/?${encodeURIComponent(msg)}`);
    expect(links.sms).toBe(`sms:09012345678?&body=${encodeURIComponent(msg)}`);
    expect(links.mail).toBe(`mailto:a@example.test?subject=${encodeURIComponent("件名")}&body=${encodeURIComponent(msg)}`);
    expect(shareLinks({ message: "x", subject: "y" }).sms).toBe("sms:?&body=x");
  });

  it("リンクの期限は 120 日後の日の終わり（日本時間）。同じ日なら同じ値", () => {
    const a = linkExpiresAt(new Date("2026-11-02T00:10:00+09:00"));
    const b = linkExpiresAt(new Date("2026-11-02T23:50:00+09:00"));
    expect(a).toBe(b);
    expect(new Date(a * 1000).toISOString()).toBe("2027-03-02T14:59:59.000Z"); // 2027-03-02 23:59:59 JST
    expect(linkExpiresAt(new Date("2026-11-03T00:00:00+09:00"))).toBe(a + 86_400);
  });

  it("口座は下 3 桁だけ", () => {
    const m = maskAccount({ bankNameKana: "ﾐｽﾞﾎ", bankCode: "0001", branchNameKana: "ｻﾝﾌﾟﾙ", branchCode: "101", accountType: "ordinary", accountNumber: "1234567" });
    expect(m).toEqual({ bank: "ﾐｽﾞﾎ", branch: "ｻﾝﾌﾟﾙ", type: "普通", last3: "567" });
    expect(JSON.stringify(m)).not.toContain("1234");
    expect(maskAccount({ bankNameKana: null, bankCode: null, branchNameKana: null, branchCode: null, accountType: "ordinary", accountNumber: null })).toBeNull();
  });

  it("日本時間で書く", () => {
    const d = new Date("2026-10-25T00:05:00Z");
    expect(jpShortDateTime(d)).toBe("10月25日 9:05");
    expect(jpDateTime(d)).toBe("2026年10月25日 9:05");
    expect(jpDateWithWeekday("2026-11-25")).toBe("2026年11月25日（水）");
  });
});

describe("やりとり", () => {
  const view = {
    lines: [{ key: "p1", project: "宅配（個建て）" }],
    deductions: [{ key: "r1", name: "管理費" }],
    adjustments: [{ key: "adj:0", label: "駐車場代の立替" }],
  } as unknown as DriverStatementView;

  it("行ごとにまとめ、解決していない話を先に出す", () => {
    const m = (id: string, author: string, lineKey: string | null, minutes: number, extra: { resolvedAt?: Date | null; readAt?: Date | null } = {}) => ({
      id,
      author,
      lineKey,
      body: id,
      createdAt: new Date(t0.getTime() + minutes * 60_000),
      readAt: extra.readAt ?? null,
      resolvedAt: extra.resolvedAt ?? null,
    });
    const threads = groupThreads(
      [
        m("a", "driver", "p1", 1, { resolvedAt: t0, readAt: t0 }),
        m("b", "staff", "p1", 2, { readAt: t0 }),
        m("c", "driver", "adj:0", 3),
        m("d", "driver", null, 4, { readAt: t0 }),
        m("e", "driver", "gone", 5),
      ],
      view,
    );
    expect(threads.map((t) => t.label)).toEqual(["前の版にあった行", "明細全体", "駐車場代の立替", "宅配（個建て）"]);
    const p1 = threads.find((t) => t.lineKey === "p1")!;
    expect(p1).toMatchObject({ open: 0, unread: 0, unreadReplies: 0 });
    expect(p1.messages.map((x) => x.author)).toEqual(["driver", "staff"]);
    expect(threads.find((t) => t.lineKey === "adj:0")).toMatchObject({ open: 1, unread: 1 });
  });

  it("本文は 1〜1,000 文字", () => {
    expect(cleanBody("  こんにちは \r\n\r\n\r\n\r\n よろしく ")).toBe("こんにちは \n\n よろしく");
    expect(cleanBody("   ")).toBeNull();
    expect(cleanBody("あ".repeat(MESSAGE_MAX))).toHaveLength(1000);
    expect(cleanBody("あ".repeat(MESSAGE_MAX + 1))).toBeNull();
  });
});
