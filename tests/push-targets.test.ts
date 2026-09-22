import { describe, expect, it } from "vitest";
import {
  chatLineText,
  chatPushPayload,
  dayEntryLineText,
  dayEntryPushPayload,
  formatDayLabel,
  shouldNotifyChat,
  shouldNotifyLine,
  trimForNotification,
  type NotifyTarget,
} from "@/lib/push/targets";

/**
 * 通知の宛先と文面を決める純関数のテスト。
 * 「鳴りすぎない」「自分あては必ず届く」「自分の発言では鳴らない」を固める。
 */

const AUTHOR = "p-author";
const ME = "p-me";

function target(patch: Partial<NotifyTarget> = {}): NotifyTarget {
  return { profileId: ME, notifyChat: "mention", notifyLine: true, lineUserId: "U1", ...patch };
}

describe("shouldNotifyChat", () => {
  it("自分の発言では鳴らさない", () => {
    expect(shouldNotifyChat({ profileId: AUTHOR, notifyChat: "all" }, { authorId: AUTHOR, mentions: [AUTHOR] })).toBe(false);
  });

  it("off は受け取らない（自分あてでも）", () => {
    expect(shouldNotifyChat(target({ notifyChat: "off" }), { authorId: AUTHOR, mentions: [ME] })).toBe(false);
  });

  it("mention（既定）は自分あてのときだけ", () => {
    expect(shouldNotifyChat(target(), { authorId: AUTHOR, mentions: [ME] })).toBe(true);
    expect(shouldNotifyChat(target(), { authorId: AUTHOR, mentions: [] })).toBe(false);
  });

  it("all はいつでも受け取る", () => {
    expect(shouldNotifyChat(target({ notifyChat: "all" }), { authorId: AUTHOR, mentions: [] })).toBe(true);
  });
});

describe("shouldNotifyLine", () => {
  it("自分あてのときだけ LINE に送る（全部の発言は流さない）", () => {
    expect(shouldNotifyLine(target({ notifyChat: "all" }), { authorId: AUTHOR, mentions: [] })).toBe(false);
    expect(shouldNotifyLine(target({ notifyChat: "all" }), { authorId: AUTHOR, mentions: [ME] })).toBe(true);
  });

  it("LINE を切っている人・未連携の人には送らない", () => {
    expect(shouldNotifyLine(target({ notifyLine: false }), { authorId: AUTHOR, mentions: [ME] })).toBe(false);
    expect(shouldNotifyLine(target({ lineUserId: "" }), { authorId: AUTHOR, mentions: [ME] })).toBe(false);
  });

  it("チャットの通知を切っていれば LINE にも送らない", () => {
    expect(shouldNotifyLine(target({ notifyChat: "off" }), { authorId: AUTHOR, mentions: [ME] })).toBe(false);
  });

  it("自分の発言では送らない", () => {
    expect(shouldNotifyLine(target({ profileId: AUTHOR }), { authorId: AUTHOR, mentions: [AUTHOR] })).toBe(false);
  });
});

describe("trimForNotification", () => {
  it("改行をまとめて 1 行にする", () => {
    expect(trimForNotification("あ\n\nい  う")).toBe("あ い う");
  });

  it("長い発言は切って … を付ける", () => {
    const long = "あ".repeat(200);
    const out = trimForNotification(long);
    expect(out).toHaveLength(120);
    expect(out.endsWith("…")).toBe(true);
  });

  it("短ければそのまま", () => {
    expect(trimForNotification("おはようございます")).toBe("おはようございます");
  });
});

describe("chatPushPayload", () => {
  it("自分あては誰からかを先に出す", () => {
    const p = chatPushPayload({ channelId: "c1", channelName: "全体", authorName: "川島幹太", body: "確認お願いします", mentioned: true });
    expect(p.title).toBe("川島幹太さんから（全体）");
    expect(p.body).toBe("確認お願いします");
    expect(p.url).toBe("/chat/c1");
    expect(p.tag).toBe("chat:c1");
  });

  it("自分あてでなければルーム名を先に出す", () => {
    const p = chatPushPayload({ channelId: "c2", channelName: "経営", authorName: "相曽慧", body: "了解です", mentioned: false });
    expect(p.title).toBe("経営：相曽慧さん");
  });

  it("ルーム名が空でも文になる", () => {
    const p = chatPushPayload({ channelId: "c3", channelName: "", authorName: "相曽慧", body: "x", mentioned: false });
    expect(p.title).toBe("チャット：相曽慧さん");
  });
});

describe("chatLineText", () => {
  it("ルーム・発言者・本文・リンクを 1 通にまとめる", () => {
    const text = chatLineText({ channelName: "全体", authorName: "川島幹太", body: "確認お願いします", appUrl: "https://example.test/", channelId: "c1" });
    expect(text).toContain("全体：川島幹太さんから");
    expect(text).toContain("確認お願いします");
    expect(text).toContain("https://example.test/chat/c1");
    expect(text).not.toContain("//chat");
  });
});

describe("formatDayLabel", () => {
  it("日付を「9月22日」にする", () => {
    expect(formatDayLabel(["2026-09-22"])).toBe("9月22日");
  });

  it("複数の日なら「ほか」を付ける（いちばん古い日を先に出す）", () => {
    expect(formatDayLabel(["2026-09-24", "2026-09-22"])).toBe("9月22日ほか");
  });

  it("同じ日が重なっても 1 日として扱う", () => {
    expect(formatDayLabel(["2026-09-22", "2026-09-22"])).toBe("9月22日");
  });

  it("空なら空", () => {
    expect(formatDayLabel([])).toBe("");
  });
});

describe("dayEntryPushPayload", () => {
  it("承認は結果だけを短く伝える", () => {
    const p = dayEntryPushPayload({ approved: true, count: 2, dateLabel: "9月22日", reason: "" });
    expect(p.title).toBe("稼働を承認しました");
    expect(p.body).toContain("9月22日の稼働 2 件");
    expect(p.url).toBe("/driver/today");
  });

  it("差戻しは理由まで伝える", () => {
    const p = dayEntryPushPayload({ approved: false, count: 1, dateLabel: "9月22日", reason: "個数が違います" });
    expect(p.title).toBe("稼働を差し戻しました");
    expect(p.body).toContain("理由：個数が違います");
  });

  it("差戻しで理由が無くても案内する", () => {
    const p = dayEntryPushPayload({ approved: false, count: 1, dateLabel: "9月22日", reason: "" });
    expect(p.body).toContain("内容を確認してください");
  });
});

describe("dayEntryLineText", () => {
  it("承認と差戻しで見出しを変え、リンクを付ける", () => {
    const ok = dayEntryLineText({ companyName: "株式会社ROOTIVE", approved: true, count: 1, dateLabel: "9月22日", reason: "", appUrl: "https://example.test" });
    expect(ok).toContain("稼働を承認しました");
    expect(ok).toContain("https://example.test/driver/today");
    expect(ok).toContain("株式会社ROOTIVE");

    const ng = dayEntryLineText({ companyName: "", approved: false, count: 3, dateLabel: "9月22日ほか", reason: "写真が無い", appUrl: "" });
    expect(ng).toContain("稼働を差し戻しました");
    expect(ng).toContain("理由：写真が無い");
    expect(ng).not.toContain("http");
  });
});
