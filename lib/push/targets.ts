/**
 * 誰に通知するか・何を出すかを決める（純関数）。
 *
 * 送信そのもの（ネットワーク・鍵）は `lib/push/send.ts`、
 * ここは「設定と発言から、通知すべきかと文面を決める」だけ。テストしやすいように分けている。
 */

/** チャットの通知の受け取り方（DB の profiles.notify_chat） */
export type NotifyChatMode = "all" | "mention" | "off";

export const NOTIFY_CHAT_LABELS: Record<NotifyChatMode, string> = {
  all: "すべての発言",
  mention: "自分あてだけ",
  off: "受け取らない",
};

/** 通知の受け取り手（送信側が DB から集める） */
export interface NotifyTarget {
  profileId: string;
  notifyChat: NotifyChatMode;
  notifyLine: boolean;
  lineUserId: string;
}

/** 端末に出す内容 */
export interface PushPayload {
  title: string;
  body: string;
  /** 押したときに開く画面（同じオリジンの相対パス） */
  url: string;
  /** 同じ種類の通知をまとめる（同じルームの連投で通知が積み上がらない） */
  tag: string;
}

/** 通知の本文に載せる長さ（長い発言は切る） */
const BODY_LIMIT = 120;

/** 通知の本文用に短くする（改行は 1 つの空白にまとめる） */
export function trimForNotification(text: string, limit: number = BODY_LIMIT): string {
  const oneLine = text.replace(/\s+/g, " ").trim();
  if (oneLine.length <= limit) return oneLine;
  return `${oneLine.slice(0, limit - 1)}…`;
}

/**
 * この人に、この発言の通知を出すか。
 * - 自分の発言では鳴らさない
 * - off は出さない。mention は自分あてのときだけ。all はいつでも
 */
export function shouldNotifyChat(target: { profileId: string; notifyChat: NotifyChatMode }, opts: { authorId: string; mentions: string[] }): boolean {
  if (target.profileId === opts.authorId) return false;
  if (target.notifyChat === "off") return false;
  const mentioned = opts.mentions.includes(target.profileId);
  if (target.notifyChat === "mention") return mentioned;
  return true;
}

/**
 * LINE にも送るか。
 * **自分あて（メンション）のときだけ**送る。全部の発言を LINE に流すと、
 * 通数の上限にも当たるし、そもそも読まれなくなるため。
 */
export function shouldNotifyLine(target: NotifyTarget, opts: { authorId: string; mentions: string[] }): boolean {
  if (target.profileId === opts.authorId) return false;
  if (!target.notifyLine) return false;
  if (target.notifyChat === "off") return false;
  if (!target.lineUserId) return false;
  return opts.mentions.includes(target.profileId);
}

/** チャットの通知の中身 */
export function chatPushPayload(opts: { channelId: string; channelName: string; authorName: string; body: string; mentioned: boolean }): PushPayload {
  const room = opts.channelName || "チャット";
  return {
    title: opts.mentioned ? `${opts.authorName}さんから（${room}）` : `${room}：${opts.authorName}さん`,
    body: trimForNotification(opts.body),
    url: `/chat/${opts.channelId}`,
    tag: `chat:${opts.channelId}`,
  };
}

/** LINE に送る文面 */
export function chatLineText(opts: { channelName: string; authorName: string; body: string; appUrl: string; channelId: string }): string {
  const room = opts.channelName || "チャット";
  const lines = [`💬 ${room}：${opts.authorName}さんから`, trimForNotification(opts.body, 200)];
  const url = `${opts.appUrl.replace(/\/$/, "")}/chat/${opts.channelId}`;
  if (opts.appUrl) lines.push(url);
  return lines.join("\n");
}

/** 「9月22日」のような表示（DB の YYYY-MM-DD から。複数の日があれば「ほか」を付ける） */
export function formatDayLabel(dates: string[]): string {
  const uniq = Array.from(new Set(dates.filter(Boolean))).sort();
  if (uniq.length === 0) return "";
  const [, m, d] = uniq[0].split("-");
  if (!m || !d) return "";
  const head = `${Number(m)}月${Number(d)}日`;
  return uniq.length > 1 ? `${head}ほか` : head;
}

/** 稼働報告の承認・差戻しの知らせ（ドライバー本人あて） */
export function dayEntryPushPayload(opts: { approved: boolean; count: number; dateLabel: string; reason: string }): PushPayload {
  const what = opts.approved ? "承認されました" : "差し戻されました";
  const detail = opts.approved
    ? `${opts.dateLabel}の稼働 ${opts.count} 件が${what}。`
    : `${opts.dateLabel}の稼働 ${opts.count} 件が${what}。${opts.reason ? `理由：${trimForNotification(opts.reason, 60)}` : "内容を確認してください。"}`;
  return {
    title: opts.approved ? "稼働を承認しました" : "稼働を差し戻しました",
    body: detail,
    url: "/driver/today",
    tag: "day-entries",
  };
}

/** 稼働報告の承認・差戻しを LINE で知らせる文面 */
export function dayEntryLineText(opts: { companyName: string; approved: boolean; count: number; dateLabel: string; reason: string; appUrl: string }): string {
  const head = opts.approved ? "✅ 稼働を承認しました" : "↩️ 稼働を差し戻しました";
  const lines = [head, `${opts.dateLabel}の稼働 ${opts.count} 件`];
  if (!opts.approved && opts.reason) lines.push(`理由：${trimForNotification(opts.reason, 120)}`);
  if (opts.appUrl) lines.push(`${opts.appUrl.replace(/\/$/, "")}/driver/today`);
  if (opts.companyName) lines.push(`（${opts.companyName}）`);
  return lines.join("\n");
}

/** 明日の配車 1 行（「三郷Amazon 1日」） */
export interface DispatchLine {
  label: string;
  qtyPlan: number;
  unitSuffix: string;
}

/** 明日の配車を 1 行ずつの文にする */
export function dispatchLines(lines: readonly DispatchLine[]): string[] {
  return lines.map((l) => `${l.label} ${l.qtyPlan}${l.unitSuffix}`);
}

/** 明日の配車の通知（ドライバー本人あて） */
export function dispatchPushPayload(opts: { dateLabel: string; lines: readonly DispatchLine[] }): PushPayload {
  const body = dispatchLines(opts.lines).join("／");
  return {
    title: `${opts.dateLabel}の予定`,
    body: body || "予定はありません",
    url: "/driver/schedule",
    tag: "dispatch",
  };
}

/** 明日の配車を LINE で知らせる文面 */
export function dispatchLineText(opts: {
  companyName: string;
  dateLabel: string;
  lines: readonly DispatchLine[];
  appUrl: string;
}): string {
  const out = [`🚚 ${opts.dateLabel}の配車`, ...dispatchLines(opts.lines).map((l) => `・${l}`)];
  if (opts.appUrl) out.push(`${opts.appUrl.replace(/\/$/, "")}/driver/schedule`);
  if (opts.companyName) out.push(`（${opts.companyName}）`);
  return out.join("\n");
}
