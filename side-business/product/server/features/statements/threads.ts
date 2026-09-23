/**
 * 明細についてのやりとりを「どの行の話か」（lineKey）ごとにまとめる（純関数）。
 * 会社の画面とドライバーの画面の両方で使う。日時は日本時間の文字にしてから渡す（端末の時計に左右されない）。
 */
import { jpShortDateTime, lineKeyLabel, type DriverStatementView } from "~/server/features/statements/view";

export const MESSAGE_MAX = 1000;

export type RawMessage = {
  id: string;
  author: string;
  authorName?: string | null;
  lineKey: string | null;
  body: string;
  createdAt: Date;
  readAt: Date | null;
  resolvedAt: Date | null;
};

export type ThreadMessage = {
  id: string;
  author: "driver" | "staff";
  authorName: string | null;
  body: string;
  at: string;
  read: boolean;
  resolved: boolean;
};

export type Thread = {
  /** 全体の話なら null */
  lineKey: string | null;
  label: string;
  messages: ThreadMessage[];
  /** 解決していないドライバーの質問の数 */
  open: number;
  /** 事務がまだ読んでいないドライバーの質問の数 */
  unread: number;
  /** ドライバーがまだ読んでいない事務の返事の数 */
  unreadReplies: number;
  lastAtMs: number;
};

/** 同じ lineKey の発言を 1 つの話にまとめる。解決していない話を先に、その中は新しい順 */
export function groupThreads(messages: RawMessage[], view: DriverStatementView): Thread[] {
  const map = new Map<string, Thread>();
  const sorted = [...messages].sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
  for (const m of sorted) {
    const k = m.lineKey ?? "";
    let t = map.get(k);
    if (!t) {
      t = { lineKey: m.lineKey, label: lineKeyLabel(view, m.lineKey), messages: [], open: 0, unread: 0, unreadReplies: 0, lastAtMs: 0 };
      map.set(k, t);
    }
    const author = m.author === "staff" ? "staff" : "driver";
    t.messages.push({
      id: m.id,
      author,
      authorName: m.authorName ?? null,
      body: m.body,
      at: jpShortDateTime(m.createdAt),
      read: !!m.readAt,
      resolved: !!m.resolvedAt,
    });
    if (author === "driver" && !m.resolvedAt) t.open++;
    if (author === "driver" && !m.readAt) t.unread++;
    if (author === "staff" && !m.readAt) t.unreadReplies++;
    t.lastAtMs = Math.max(t.lastAtMs, m.createdAt.getTime());
  }
  return [...map.values()].sort((a, b) => (b.open > 0 ? 1 : 0) - (a.open > 0 ? 1 : 0) || b.lastAtMs - a.lastAtMs);
}

/** 本文の形をそろえる（前後の空白・3 行以上の空行を詰める）。空か長すぎれば null */
export function cleanBody(body: string): string | null {
  const v = body.replace(/\r\n?/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
  if (!v || v.length > MESSAGE_MAX) return null;
  return v;
}
