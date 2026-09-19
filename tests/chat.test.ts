import { describe, expect, it } from "vitest";
import {
  chatDateLabel,
  formatChatTime,
  insertMention,
  isSameChatDay,
  mentionLabel,
  parseMentions,
  pickDefaultChannel,
  renderMentionParts,
  summarizeBody,
  toChannelItem,
  toChannelItems,
  toChatStaff,
  toMentionIds,
  toMessageItem,
  toMessageItems,
  unreadLabel,
  type ChatStaff,
} from "@/lib/chat/helpers";
import {
  chatBodySchema,
  createChannelSchema,
  editChatMessageSchema,
  postChatMessageSchema,
  updateChannelSchema,
} from "@/lib/schemas/chat";
import type { ChatChannelRow, ChatMessageRow, StaffRow } from "@/lib/db/types";

const COMPANY = "00000000-0000-4000-8000-000000000000";
const ID_A = "11111111-1111-4111-8111-111111111111";
const ID_B = "22222222-2222-4222-8222-222222222222";
const ID_C = "33333333-3333-4333-8333-333333333333";
const ID_D = "44444444-4444-4444-8444-444444444444";

const staff = (over: Partial<ChatStaff> & { id: string; name: string }): ChatStaff => ({
  role: "admin",
  roleLabel: "管理者",
  email: "",
  isActive: true,
  ...over,
});

/** 代表的なスタッフ（オーナー・管理者・閲覧者） */
const STAFF: ChatStaff[] = [
  staff({ id: ID_A, name: "川島幹太", role: "owner", roleLabel: "オーナー" }),
  staff({ id: ID_B, name: "相曽慧" }),
  staff({ id: ID_C, name: "田中", role: "viewer", roleLabel: "閲覧者" }),
];

// ---------------------------------------------------------------------------
// formatChatTime
// ---------------------------------------------------------------------------

describe("formatChatTime", () => {
  // 2026-09-18T05:32Z = 日本時間 2026-09-18 14:32
  const at = "2026-09-18T05:32:00Z";

  it("今日なら HH:mm", () => {
    expect(formatChatTime(at, "2026-09-18T01:00:00Z")).toBe("14:32");
    expect(formatChatTime(at, "2026-09-18T14:59:00Z")).toBe("14:32");
  });

  it("時・分は 2 桁に揃える", () => {
    expect(formatChatTime("2026-09-18T00:05:00Z", "2026-09-18T01:00:00Z")).toBe("09:05");
    expect(formatChatTime("2026-09-17T15:00:00Z", "2026-09-18T01:00:00Z")).toBe("00:00");
  });

  it("同じ年の別の日は M/D HH:mm", () => {
    expect(formatChatTime(at, "2026-09-20T01:00:00Z")).toBe("9/18 14:32");
    expect(formatChatTime("2026-01-03T05:32:00Z", "2026-09-20T01:00:00Z")).toBe("1/3 14:32");
  });

  it("別の年は YYYY/M/D HH:mm", () => {
    expect(formatChatTime("2025-12-01T05:32:00Z", "2026-09-20T01:00:00Z")).toBe("2025/12/1 14:32");
  });

  it("日付の境目は日本時間で判定する（UTC の 15 時が翌日の 0 時）", () => {
    // UTC では 9/17 だが日本時間では 9/18 00:30 なので「今日」
    expect(formatChatTime("2026-09-17T15:30:00Z", "2026-09-18T02:00:00Z")).toBe("00:30");
    // UTC では 9/18 だが日本時間では 9/18 08:59 → 9/19 から見ると別の日
    expect(formatChatTime("2026-09-17T23:59:00Z", "2026-09-19T00:00:00Z")).toBe("9/18 08:59");
  });

  it("Date でも数値でも受け取れる", () => {
    expect(formatChatTime(new Date(at), new Date("2026-09-18T01:00:00Z"))).toBe("14:32");
    expect(formatChatTime(new Date(at).getTime(), new Date("2026-09-18T01:00:00Z").getTime())).toBe("14:32");
  });

  it("空・不正な値は空文字", () => {
    expect(formatChatTime("", "2026-09-18T01:00:00Z")).toBe("");
    expect(formatChatTime(null, "2026-09-18T01:00:00Z")).toBe("");
    expect(formatChatTime(undefined, "2026-09-18T01:00:00Z")).toBe("");
    expect(formatChatTime("あいうえお", "2026-09-18T01:00:00Z")).toBe("");
  });

  it("now が不正なら現在時刻を使う（落ちない）", () => {
    expect(formatChatTime(at, "----")).toMatch(/^(14:32|9\/18 14:32|2026\/9\/18 14:32)$/);
  });
});

// ---------------------------------------------------------------------------
// chatDateLabel / isSameChatDay
// ---------------------------------------------------------------------------

describe("chatDateLabel", () => {
  it("今日・昨日", () => {
    expect(chatDateLabel("2026-09-18T05:32:00Z", "2026-09-18T13:00:00Z")).toBe("今日");
    expect(chatDateLabel("2026-09-18T05:32:00Z", "2026-09-19T01:00:00Z")).toBe("昨日");
  });

  it("今年はカッコ付きの曜日、別の年は年から出す", () => {
    expect(chatDateLabel("2026-09-18T05:32:00Z", "2026-09-25T01:00:00Z")).toBe("9月18日(金)");
    expect(chatDateLabel("2025-12-01T05:32:00Z", "2026-09-25T01:00:00Z")).toBe("2025年12月1日(月)");
  });

  it("空・不正な値は空文字", () => {
    expect(chatDateLabel(null, "2026-09-18T01:00:00Z")).toBe("");
    expect(chatDateLabel("x", "2026-09-18T01:00:00Z")).toBe("");
  });
});

describe("isSameChatDay", () => {
  it("日本時間で同じ日か", () => {
    expect(isSameChatDay("2026-09-17T15:30:00Z", "2026-09-18T05:00:00Z")).toBe(true);
    expect(isSameChatDay("2026-09-17T14:59:00Z", "2026-09-18T05:00:00Z")).toBe(false);
    expect(isSameChatDay(null, "2026-09-18T05:00:00Z")).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// parseMentions
// ---------------------------------------------------------------------------

describe("parseMentions", () => {
  it("@ が無ければ空", () => {
    expect(parseMentions("おつかれさまです", STAFF)).toEqual([]);
    expect(parseMentions("", STAFF)).toEqual([]);
    expect(parseMentions(null, STAFF)).toEqual([]);
    expect(parseMentions("メールは rootive.biz@gmail.com です", STAFF)).toEqual([]);
  });

  it("本文の @表示名 から profiles.id を作る", () => {
    expect(parseMentions("@川島幹太 確認おねがいします", STAFF)).toEqual([ID_A]);
    expect(parseMentions("確認おねがいします @相曽慧", STAFF)).toEqual([ID_B]);
  });

  it("複数の宛先は出現順、同じ人は 1 回だけ", () => {
    expect(parseMentions("@相曽慧 と @川島幹太 へ。@相曽慧 もう一度", STAFF)).toEqual([ID_B, ID_A]);
  });

  it("全角の＠でも宛先になる", () => {
    expect(parseMentions("＠川島幹太　おねがいします", STAFF)).toEqual([ID_A]);
  });

  it("長い名前を優先する", () => {
    const list = [staff({ id: ID_C, name: "田中" }), staff({ id: ID_D, name: "田中太郎" })];
    expect(parseMentions("@田中太郎 さん", list)).toEqual([ID_D]);
    expect(parseMentions("@田中 さん", list)).toEqual([ID_C]);
  });

  it("同名のスタッフがいるときは全員が宛先になる", () => {
    const list = [staff({ id: ID_C, name: "田中" }), staff({ id: ID_D, name: "田中" })];
    expect(parseMentions("@田中 おねがいします", list)).toEqual([ID_C, ID_D]);
  });

  it("知らない名前・候補なしでは宛先にならない", () => {
    expect(parseMentions("@佐藤 さん", STAFF)).toEqual([]);
    expect(parseMentions("@川島幹太", [])).toEqual([]);
  });

  it("メールアドレスの途中の @ は宛先にしない", () => {
    const list = [staff({ id: ID_C, name: "gmail" })];
    expect(parseMentions("rootive.biz@gmail.com", list)).toEqual([]);
    expect(parseMentions("宛先は @gmail です", list)).toEqual([ID_C]);
  });

  it("日本語の直後や行頭・改行の直後でも拾う", () => {
    expect(parseMentions("至急@相曽慧お願いします", STAFF)).toEqual([ID_B]);
    expect(parseMentions("連絡です\n@田中 よろしく", STAFF)).toEqual([ID_C]);
  });

  it("空白を含む表示名でも一致する", () => {
    const list = [staff({ id: ID_A, name: "川島 幹太" })];
    expect(parseMentions("@川島 幹太 おつかれさまです", list)).toEqual([ID_A]);
  });

  it("id や名前が空の候補は無視する", () => {
    const list = [staff({ id: "", name: "空" }), staff({ id: ID_A, name: "" })];
    expect(parseMentions("@空 @", list)).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// renderMentionParts
// ---------------------------------------------------------------------------

describe("renderMentionParts", () => {
  it("空の本文は空の配列", () => {
    expect(renderMentionParts("", STAFF)).toEqual([]);
    expect(renderMentionParts(null, STAFF)).toEqual([]);
  });

  it("@ が無ければ 1 片のテキスト", () => {
    expect(renderMentionParts("おつかれさまです", STAFF)).toEqual([{ type: "text", value: "おつかれさまです" }]);
  });

  it("メンションを切り出す（@ を含めた文字列と id）", () => {
    expect(renderMentionParts("@川島幹太 確認おねがいします", STAFF)).toEqual([
      { type: "mention", value: "@川島幹太", id: ID_A },
      { type: "text", value: " 確認おねがいします" },
    ]);
  });

  it("前後にテキストがあっても分割できる", () => {
    const parts = renderMentionParts("至急 @相曽慧 と ＠田中 まで", STAFF);
    expect(parts).toEqual([
      { type: "text", value: "至急 " },
      { type: "mention", value: "@相曽慧", id: ID_B },
      { type: "text", value: " と " },
      { type: "mention", value: "＠田中", id: ID_C },
      { type: "text", value: " まで" },
    ]);
  });

  it("つなげると元の本文に戻る", () => {
    const body = "@川島幹太\n明日の件です @田中 。よろしく";
    expect(
      renderMentionParts(body, STAFF)
        .map((p) => p.value)
        .join(""),
    ).toBe(body);
  });

  it("同名のスタッフがいるときは最初の id を返す", () => {
    const list = [staff({ id: ID_C, name: "田中" }), staff({ id: ID_D, name: "田中" })];
    expect(renderMentionParts("@田中", list)).toEqual([{ type: "mention", value: "@田中", id: ID_C }]);
  });

  it("知らない名前はただのテキスト", () => {
    expect(renderMentionParts("@佐藤 さん", STAFF)).toEqual([{ type: "text", value: "@佐藤 さん" }]);
  });
});

// ---------------------------------------------------------------------------
// insertMention
// ---------------------------------------------------------------------------

describe("insertMention", () => {
  it("空の入力欄にはそのまま入る", () => {
    expect(insertMention("", "田中", 0)).toEqual({ text: "@田中 ", caret: 4 });
  });

  it("直前が空白でなければ空白を足す", () => {
    const r = insertMention("確認", "田中", 2);
    expect(r.text).toBe("確認 @田中 ");
    expect(r.caret).toBe(r.text.length);
  });

  it("キャレットの位置に差し込む", () => {
    const r = insertMention("確認 お願いします", "田中", 3);
    expect(r.text).toBe("確認 @田中 お願いします");
    expect(r.caret).toBe("確認 @田中 ".length);
  });

  it("直後が空白なら空白を足さない", () => {
    expect(insertMention("確認 お願い", "田中", 2).text).toBe("確認 @田中 お願い");
  });

  it("キャレットが無い・範囲外なら末尾に足す", () => {
    expect(insertMention("確認", "田中").text).toBe("確認 @田中 ");
    expect(insertMention("確認", "田中", 999).text).toBe("確認 @田中 ");
    expect(insertMention("確認", "田中", -1).text).toBe("確認 @田中 ");
  });
});

// ---------------------------------------------------------------------------
// summarizeBody
// ---------------------------------------------------------------------------

describe("summarizeBody", () => {
  it("改行・タブ・連続する空白は 1 つの空白にする", () => {
    expect(summarizeBody("明日の件\nよろしく")).toBe("明日の件 よろしく");
    expect(summarizeBody("明日の件\r\n\tよろしく")).toBe("明日の件 よろしく");
    expect(summarizeBody("  前後の空白  ")).toBe("前後の空白");
    expect(summarizeBody("全角　空白")).toBe("全角 空白");
  });

  it("max 文字を超えたら「…」を付ける", () => {
    expect(summarizeBody("あいうえお", 3)).toBe("あいう…");
    expect(summarizeBody("あいうえお", 5)).toBe("あいうえお");
    expect(summarizeBody("あいうえお", 6)).toBe("あいうえお");
  });

  it("既定は 40 文字", () => {
    const body = "あ".repeat(41);
    expect(summarizeBody(body)).toBe(`${"あ".repeat(40)}…`);
    expect(summarizeBody("あ".repeat(40))).toBe("あ".repeat(40));
  });

  it("絵文字（サロゲートペア）も 1 文字として数える", () => {
    expect(summarizeBody("🙂🙂🙂", 2)).toBe("🙂🙂…");
  });

  it("空・null・max が 0 以下なら空文字", () => {
    expect(summarizeBody("")).toBe("");
    expect(summarizeBody(null)).toBe("");
    expect(summarizeBody(undefined)).toBe("");
    expect(summarizeBody("   \n  ")).toBe("");
    expect(summarizeBody("あいう", 0)).toBe("");
    expect(summarizeBody("あいう", -3)).toBe("");
  });
});

// ---------------------------------------------------------------------------
// unreadLabel / mentionLabel
// ---------------------------------------------------------------------------

describe("unreadLabel", () => {
  it("0 以下は空文字", () => {
    expect(unreadLabel(0)).toBe("");
    expect(unreadLabel(-1)).toBe("");
    expect(unreadLabel(null)).toBe("");
    expect(unreadLabel(undefined)).toBe("");
  });

  it("1〜99 はそのまま、100 以上は 99+", () => {
    expect(unreadLabel(1)).toBe("1");
    expect(unreadLabel(99)).toBe("99");
    expect(unreadLabel(100)).toBe("99+");
    expect(unreadLabel(1234)).toBe("99+");
  });

  it("上限を変えられる", () => {
    expect(unreadLabel(10, 9)).toBe("9+");
    expect(unreadLabel(9, 9)).toBe("9");
  });

  it("小数は切り捨て", () => {
    expect(unreadLabel(2.7)).toBe("2");
  });
});

describe("mentionLabel", () => {
  it("@ を付ける（0 以下は空文字）", () => {
    expect(mentionLabel(3)).toBe("@3");
    expect(mentionLabel(120)).toBe("@99+");
    expect(mentionLabel(0)).toBe("");
    expect(mentionLabel(null)).toBe("");
  });
});

// ---------------------------------------------------------------------------
// ビューの行 → 画面で扱う形
// ---------------------------------------------------------------------------

const channelRow = (over: Partial<ChatChannelRow> = {}): ChatChannelRow => ({
  id: ID_A,
  company_id: COMPANY,
  name: "全体",
  description: "みんなへの連絡はここへ",
  is_default: true,
  is_active: true,
  sort_order: 1,
  created_at: "2026-09-01T00:00:00Z",
  message_count: 3,
  last_message_at: "2026-09-18T05:32:00Z",
  last_author_name: "川島幹太",
  last_body: "おつかれさまです",
  unread_count: 2,
  mention_count: 1,
  last_read_at: null,
  ...over,
});

const messageRow = (over: Partial<ChatMessageRow> = {}): ChatMessageRow => ({
  id: ID_B,
  company_id: COMPANY,
  channel_id: ID_A,
  author_id: ID_A,
  author_name: "川島幹太",
  author_role: "owner",
  body: "おつかれさまです",
  mentions: [ID_B],
  is_mine: false,
  is_mentioned: true,
  edited_at: null,
  created_at: "2026-09-18T05:32:00Z",
  ...over,
});

const staffRow = (over: Partial<StaffRow> = {}): StaffRow => ({
  id: ID_A,
  company_id: COMPANY,
  display_name: "川島幹太",
  email: "owner@example.com",
  role: "owner",
  is_active: true,
  line_linked: false,
  created_at: "2026-09-01T00:00:00Z",
  ...over,
});

describe("toChannelItem / toChannelItems", () => {
  it("ビューの行を画面用に正規化する", () => {
    expect(toChannelItem(channelRow())).toEqual({
      id: ID_A,
      name: "全体",
      description: "みんなへの連絡はここへ",
      isDefault: true,
      isActive: true,
      sortOrder: 1,
      messageCount: 3,
      lastMessageAt: "2026-09-18T05:32:00Z",
      lastAuthorName: "川島幹太",
      lastBody: "おつかれさまです",
      unreadCount: 2,
      mentionCount: 1,
    });
  });

  it("null は既定値に置き換える", () => {
    const item = toChannelItem(
      channelRow({ name: null, description: null, is_default: null, is_active: null, sort_order: null, message_count: null, unread_count: null, mention_count: null, last_author_name: null, last_body: null, last_message_at: null }),
    );
    expect(item).toMatchObject({ name: "", description: "", isDefault: false, isActive: true, sortOrder: 0, messageCount: 0, unreadCount: 0, mentionCount: 0, lastMessageAt: null });
  });

  it("id の無い行は捨てる", () => {
    expect(toChannelItem(channelRow({ id: null }))).toBeNull();
    expect(toChannelItems([channelRow(), channelRow({ id: null }), null])).toHaveLength(1);
    expect(toChannelItems(null)).toEqual([]);
  });
});

describe("toMessageItem / toMessageItems", () => {
  it("ロールのラベルと宛先を整える", () => {
    const item = toMessageItem(messageRow());
    expect(item).toMatchObject({ id: ID_B, authorName: "川島幹太", roleLabel: "オーナー", mentions: [ID_B], isMine: false, isMentioned: true, editedAt: null });
  });

  it("発言者が消えていても表示が崩れない", () => {
    expect(toMessageItem(messageRow({ author_name: "  ", author_role: null }))).toMatchObject({ authorName: "（退職・削除されたユーザー）", roleLabel: "" });
  });

  it("mentions が jsonb の変な値でも配列にする", () => {
    expect(toMessageItem(messageRow({ mentions: null }))?.mentions).toEqual([]);
    expect(toMessageItem(messageRow({ mentions: "x" }))?.mentions).toEqual([]);
    expect(toMessageItem(messageRow({ mentions: [ID_B, ID_B, 1, "", null] }))?.mentions).toEqual([ID_B]);
  });

  it("id の無い行は捨てる", () => {
    expect(toMessageItem(messageRow({ id: null }))).toBeNull();
    expect(toMessageItems([messageRow(), messageRow({ id: null })])).toHaveLength(1);
    expect(toMessageItems(undefined)).toEqual([]);
  });
});

describe("toMentionIds", () => {
  it("文字列だけを重複なく取り出す", () => {
    expect(toMentionIds([ID_A, ID_A, ID_B])).toEqual([ID_A, ID_B]);
    expect(toMentionIds("x")).toEqual([]);
    expect(toMentionIds(null)).toEqual([]);
  });
});

describe("toChatStaff", () => {
  it("表示名とロールのラベルを付ける", () => {
    expect(toChatStaff([staffRow()])).toEqual([
      { id: ID_A, name: "川島幹太", role: "owner", roleLabel: "オーナー", email: "owner@example.com", isActive: true },
    ]);
  });

  it("表示名が無ければメールアドレスを使い、どちらも無い行は捨てる", () => {
    expect(toChatStaff([staffRow({ display_name: null })])[0]?.name).toBe("owner@example.com");
    expect(toChatStaff([staffRow({ display_name: null, email: null })])).toEqual([]);
    expect(toChatStaff([staffRow({ id: null })])).toEqual([]);
    expect(toChatStaff(null)).toEqual([]);
  });

  it("ロールが無ければ閲覧者として扱う", () => {
    expect(toChatStaff([staffRow({ role: null })])[0]).toMatchObject({ role: "viewer", roleLabel: "閲覧者" });
  });
});

describe("pickDefaultChannel", () => {
  const list = toChannelItems([
    channelRow({ id: ID_B, name: "経営", is_default: false, sort_order: 2 }),
    channelRow({ id: ID_A, name: "全体", is_default: true, sort_order: 1 }),
  ]);

  it("既定のルームを返す", () => {
    expect(pickDefaultChannel(list)?.id).toBe(ID_A);
  });

  it("既定が無ければ先頭を返す", () => {
    const noDefault = toChannelItems([channelRow({ id: ID_B, name: "経営", is_default: false })]);
    expect(pickDefaultChannel(noDefault)?.id).toBe(ID_B);
  });

  it("停止中のルームは選ばない", () => {
    const inactiveDefault = toChannelItems([
      channelRow({ id: ID_A, is_default: true, is_active: false }),
      channelRow({ id: ID_B, name: "経営", is_default: false, is_active: true }),
    ]);
    expect(pickDefaultChannel(inactiveDefault)?.id).toBe(ID_B);
  });

  it("1 件も無ければ null", () => {
    expect(pickDefaultChannel([])).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// zod スキーマ
// ---------------------------------------------------------------------------

describe("chat のスキーマ", () => {
  it("本文は前後の空白を落として 1〜4000 文字", () => {
    expect(chatBodySchema.parse("  おつかれさまです  ")).toBe("おつかれさまです");
    expect(chatBodySchema.safeParse("").success).toBe(false);
    expect(chatBodySchema.safeParse("   ").success).toBe(false);
    expect(chatBodySchema.safeParse("あ".repeat(4000)).success).toBe(true);
    expect(chatBodySchema.safeParse("あ".repeat(4001)).success).toBe(false);
  });

  it("エラーは日本語", () => {
    const res = chatBodySchema.safeParse("");
    expect(res.success).toBe(false);
    if (!res.success) expect(res.error.issues[0]?.message).toBe("メッセージを入力してください");
  });

  it("発言は宛先の重複を取り除く", () => {
    const v = postChatMessageSchema.parse({ channel_id: ID_A, body: "やります", mentions: [ID_B, ID_B, ID_C] });
    expect(v.mentions).toEqual([ID_B, ID_C]);
  });

  it("宛先は省略できる（既定は空）", () => {
    expect(postChatMessageSchema.parse({ channel_id: ID_A, body: "やります" }).mentions).toEqual([]);
  });

  it("宛先が uuid でなければ弾く", () => {
    expect(postChatMessageSchema.safeParse({ channel_id: ID_A, body: "やります", mentions: ["abc"] }).success).toBe(false);
    expect(postChatMessageSchema.safeParse({ channel_id: "abc", body: "やります" }).success).toBe(false);
  });

  it("編集は id と本文", () => {
    expect(editChatMessageSchema.parse({ id: ID_B, body: " 直しました " })).toEqual({ id: ID_B, body: "直しました" });
    expect(editChatMessageSchema.safeParse({ id: ID_B, body: "" }).success).toBe(false);
  });

  it("ルーム名は 1〜60 文字、説明は 200 文字まで", () => {
    expect(createChannelSchema.parse({ name: " 現場 ", description: " 連絡 " })).toEqual({ name: "現場", description: "連絡" });
    expect(createChannelSchema.parse({ name: "現場" }).description).toBe("");
    expect(createChannelSchema.safeParse({ name: "" }).success).toBe(false);
    expect(createChannelSchema.safeParse({ name: "あ".repeat(61) }).success).toBe(false);
    expect(createChannelSchema.safeParse({ name: "現場", description: "あ".repeat(201) }).success).toBe(false);
  });

  it("ルームの更新は渡した項目だけ（何も無ければエラー）", () => {
    expect(updateChannelSchema.parse({ id: ID_A, is_active: false })).toEqual({ id: ID_A, is_active: false });
    expect(updateChannelSchema.safeParse({ id: ID_A }).success).toBe(false);
  });
});
