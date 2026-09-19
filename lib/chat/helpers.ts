/**
 * 社内チャットの純関数（React・DB に依存しない。画面と Vitest から使う）
 *
 * - 時刻は日本時間で表示する（DB は timestamptz。Intl に頼らず UTC+9 で組み立てるので結果が環境に左右されない）
 * - メンションは本文の「@表示名」を v_staff の一覧と突き合わせて profiles.id に変換する
 *   （同じ表示名のスタッフが複数いるときは全員宛にする。長い名前を優先して一致させる）
 * - ビュー（v_chat_channel_list / v_chat_message_list / v_staff）の列はすべて null 許容なので、
 *   画面で使う形はここで正規化する
 */
import { ROLE_LABELS, type ChatChannelRow, type ChatMessageRow, type Role, type StaffRow } from "@/lib/db/types";

// ---------------------------------------------------------------------------
// 画面で扱う形
// ---------------------------------------------------------------------------

/** メンションの候補（v_staff の 1 行） */
export interface ChatStaff {
  id: string;
  /** 表示名（空なら email が入る。v_staff 側で coalesce 済み） */
  name: string;
  role: Role;
  roleLabel: string;
  email: string;
  isActive: boolean;
}

/** ルーム一覧の 1 件 */
export interface ChatChannelItem {
  id: string;
  name: string;
  description: string;
  isDefault: boolean;
  isActive: boolean;
  sortOrder: number;
  messageCount: number;
  lastMessageAt: string | null;
  lastAuthorName: string;
  lastBody: string;
  unreadCount: number;
  mentionCount: number;
}

/** 発言の 1 件 */
export interface ChatMessageItem {
  id: string;
  channelId: string;
  authorId: string;
  authorName: string;
  authorRole: Role | null;
  /** オーナー／管理者／閲覧者（不明なら ""） */
  roleLabel: string;
  body: string;
  /** 宛先（profiles.id の配列） */
  mentions: string[];
  isMine: boolean;
  isMentioned: boolean;
  editedAt: string | null;
  createdAt: string;
}

const EMPTY_ROLE_LABEL = "";

/** v_staff の行 → メンション候補（id と名前が無い行は捨てる） */
export function toChatStaff(rows: (StaffRow | null | undefined)[] | null | undefined): ChatStaff[] {
  const out: ChatStaff[] = [];
  for (const r of rows ?? []) {
    if (!r || !r.id) continue;
    const name = (r.display_name ?? r.email ?? "").trim();
    if (name === "") continue;
    const role = (r.role ?? "viewer") as Role;
    out.push({
      id: r.id,
      name,
      role,
      roleLabel: ROLE_LABELS[role] ?? EMPTY_ROLE_LABEL,
      email: r.email ?? "",
      isActive: r.is_active !== false,
    });
  }
  return out;
}

/** v_chat_channel_list の行 → ルーム一覧の 1 件 */
export function toChannelItem(row: ChatChannelRow): ChatChannelItem | null {
  if (!row?.id) return null;
  return {
    id: row.id,
    name: row.name ?? "",
    description: row.description ?? "",
    isDefault: row.is_default === true,
    isActive: row.is_active !== false,
    sortOrder: Number(row.sort_order ?? 0),
    messageCount: Number(row.message_count ?? 0),
    lastMessageAt: row.last_message_at ?? null,
    lastAuthorName: row.last_author_name ?? "",
    lastBody: row.last_body ?? "",
    unreadCount: Number(row.unread_count ?? 0),
    mentionCount: Number(row.mention_count ?? 0),
  };
}

export function toChannelItems(rows: (ChatChannelRow | null | undefined)[] | null | undefined): ChatChannelItem[] {
  const out: ChatChannelItem[] = [];
  for (const r of rows ?? []) {
    const item = r ? toChannelItem(r) : null;
    if (item) out.push(item);
  }
  return out;
}

/** jsonb の mentions（profiles.id の文字列配列）を安全に配列へ */
export function toMentionIds(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return unique(value.filter((v): v is string => typeof v === "string" && v !== ""));
}

/** v_chat_message_list の行 → 発言の 1 件 */
export function toMessageItem(row: ChatMessageRow): ChatMessageItem | null {
  if (!row?.id) return null;
  const role = (row.author_role ?? null) as Role | null;
  return {
    id: row.id,
    channelId: row.channel_id ?? "",
    authorId: row.author_id ?? "",
    authorName: (row.author_name ?? "").trim() || "（退職・削除されたユーザー）",
    authorRole: role,
    roleLabel: role ? (ROLE_LABELS[role] ?? EMPTY_ROLE_LABEL) : EMPTY_ROLE_LABEL,
    body: row.body ?? "",
    mentions: toMentionIds(row.mentions),
    isMine: row.is_mine === true,
    isMentioned: row.is_mentioned === true,
    editedAt: row.edited_at ?? null,
    createdAt: row.created_at ?? "",
  };
}

export function toMessageItems(rows: (ChatMessageRow | null | undefined)[] | null | undefined): ChatMessageItem[] {
  const out: ChatMessageItem[] = [];
  for (const r of rows ?? []) {
    const item = r ? toMessageItem(r) : null;
    if (item) out.push(item);
  }
  return out;
}

/** 最初に開くルーム（既定のルーム → 並び順の先頭。1 件も無ければ null） */
export function pickDefaultChannel(channels: ChatChannelItem[]): ChatChannelItem | null {
  if (channels.length === 0) return null;
  return channels.find((c) => c.isDefault && c.isActive) ?? channels.find((c) => c.isActive) ?? channels[0] ?? null;
}

// ---------------------------------------------------------------------------
// 時刻（日本時間）
// ---------------------------------------------------------------------------

const JST_OFFSET_MS = 9 * 60 * 60 * 1000;
const WEEKDAYS_JA = ["日", "月", "火", "水", "木", "金", "土"];

function pad2(n: number): string {
  return String(n).padStart(2, "0");
}

interface JstParts {
  y: number;
  m: number;
  d: number;
  hh: number;
  mm: number;
  w: number;
}

function toDate(value: string | number | Date | null | undefined): Date | null {
  if (value == null || value === "") return null;
  const d = value instanceof Date ? value : new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
}

/** 日本時間の年月日時分（UTC+9） */
function jstParts(d: Date): JstParts {
  const j = new Date(d.getTime() + JST_OFFSET_MS);
  return {
    y: j.getUTCFullYear(),
    m: j.getUTCMonth() + 1,
    d: j.getUTCDate(),
    hh: j.getUTCHours(),
    mm: j.getUTCMinutes(),
    w: j.getUTCDay(),
  };
}

function sameDay(a: JstParts, b: JstParts): boolean {
  return a.y === b.y && a.m === b.m && a.d === b.d;
}

/**
 * 発言の時刻表示（日本時間）
 * - 今日 → "14:32"
 * - 今年の別の日 → "9/18 14:32"
 * - 去年より前 → "2025/12/1 14:32"
 * 不正な値は "" を返す（画面が落ちないように）
 */
export function formatChatTime(iso: string | number | Date | null | undefined, now: string | number | Date = new Date()): string {
  const at = toDate(iso);
  if (!at) return "";
  const base = toDate(now) ?? new Date();
  const a = jstParts(at);
  const b = jstParts(base);
  const time = `${pad2(a.hh)}:${pad2(a.mm)}`;
  if (sameDay(a, b)) return time;
  if (a.y === b.y) return `${a.m}/${a.d} ${time}`;
  return `${a.y}/${a.m}/${a.d} ${time}`;
}

/**
 * 日付の区切り見出し（日本時間）
 * - 今日 → "今日"
 * - 昨日 → "昨日"
 * - 今年 → "9月18日(木)"
 * - それ以外 → "2025年12月1日(月)"
 */
export function chatDateLabel(iso: string | number | Date | null | undefined, now: string | number | Date = new Date()): string {
  const at = toDate(iso);
  if (!at) return "";
  const base = toDate(now) ?? new Date();
  const a = jstParts(at);
  const b = jstParts(base);
  if (sameDay(a, b)) return "今日";
  if (sameDay(a, jstParts(new Date(base.getTime() - 24 * 60 * 60 * 1000)))) return "昨日";
  const w = WEEKDAYS_JA[a.w] ?? "";
  const head = a.y === b.y ? "" : `${a.y}年`;
  return `${head}${a.m}月${a.d}日(${w})`;
}

/** 同じ日（日本時間）か。日付の区切りを入れる判定に使う */
export function isSameChatDay(a: string | number | Date | null | undefined, b: string | number | Date | null | undefined): boolean {
  const da = toDate(a);
  const db = toDate(b);
  if (!da || !db) return false;
  return sameDay(jstParts(da), jstParts(db));
}

// ---------------------------------------------------------------------------
// メンション
// ---------------------------------------------------------------------------

/** 半角・全角どちらの @ も宛先として扱う */
const MENTION_MARKS = ["@", "＠"];

/** メールアドレスの途中（rootive@example.com）を宛先と誤認しないための直前文字 */
const EMAIL_LIKE = /[A-Za-z0-9._%+\-@＠]/;

function unique(values: string[]): string[] {
  return [...new Set(values)];
}

function isMentionStart(body: string, i: number): boolean {
  if (i === 0) return true;
  return !EMAIL_LIKE.test(body.charAt(i - 1));
}

interface MentionHit {
  start: number;
  end: number;
  name: string;
  ids: string[];
}

/** 長い名前を優先して並べ替えた候補（同名は両方残す） */
function sortedCandidates(staff: ChatStaff[]): ChatStaff[] {
  return [...staff]
    .filter((s) => s.id !== "" && s.name !== "")
    .sort((a, b) => b.name.length - a.name.length || a.name.localeCompare(b.name, "ja"));
}

/** 本文を走査して「@表示名」の位置を拾う（内部用） */
function scanMentions(body: string, staff: ChatStaff[]): MentionHit[] {
  const text = body ?? "";
  const candidates = sortedCandidates(staff);
  if (text === "" || candidates.length === 0) return [];
  const hits: MentionHit[] = [];
  let i = 0;
  while (i < text.length) {
    const ch = text.charAt(i);
    if (MENTION_MARKS.includes(ch) && isMentionStart(text, i)) {
      const rest = text.slice(i + 1);
      const hit = candidates.find((s) => rest.startsWith(s.name));
      if (hit) {
        const end = i + 1 + hit.name.length;
        hits.push({
          start: i,
          end,
          name: hit.name,
          // 同じ表示名のスタッフが複数いるときは全員を宛先にする（取りこぼしを防ぐ）
          ids: unique(staff.filter((s) => s.name === hit.name && s.id !== "").map((s) => s.id)),
        });
        i = end;
        continue;
      }
    }
    i += 1;
  }
  return hits;
}

/**
 * 本文の「@表示名」から宛先（profiles.id）の配列を作る。
 * - 長い名前を優先（"@田中太郎" は「田中」ではなく「田中太郎」に一致する）
 * - 同じ id は 1 回だけ（出現順）
 * - 同じ表示名のスタッフが複数いるときは全員を宛先にする
 */
export function parseMentions(body: string | null | undefined, staff: ChatStaff[]): string[] {
  return unique(scanMentions(body ?? "", staff).flatMap((h) => h.ids));
}

/** 表示用に分割した本文の 1 片 */
export interface MentionPart {
  type: "text" | "mention";
  /** 表示する文字列（mention は "@表示名" のように @ を含む） */
  value: string;
  /** mention のときだけ。同名が複数いる場合は最初のスタッフの id */
  id?: string;
}

/**
 * 本文を「ただの文字列」と「メンション」に分割する（強調表示用）。
 * 分割した value をつなげると元の本文に戻る。
 */
export function renderMentionParts(body: string | null | undefined, staff: ChatStaff[]): MentionPart[] {
  const text = body ?? "";
  if (text === "") return [];
  const hits = scanMentions(text, staff);
  if (hits.length === 0) return [{ type: "text", value: text }];
  const parts: MentionPart[] = [];
  let cursor = 0;
  for (const h of hits) {
    if (h.start > cursor) parts.push({ type: "text", value: text.slice(cursor, h.start) });
    parts.push({ type: "mention", value: text.slice(h.start, h.end), id: h.ids[0] });
    cursor = h.end;
  }
  if (cursor < text.length) parts.push({ type: "text", value: text.slice(cursor) });
  return parts;
}

/**
 * 入力欄へメンションを差し込む（キャレット位置に "@表示名 " を入れる）。
 * 直前が空白でなければ空白を足し、直後が空白なら空白を足さない。
 */
export function insertMention(text: string, name: string, caret?: number | null): { text: string; caret: number } {
  const source = text ?? "";
  const pos = caret == null || caret < 0 || caret > source.length ? source.length : caret;
  const before = source.slice(0, pos);
  const after = source.slice(pos);
  const lead = before !== "" && !/\s$/u.test(before) ? " " : "";
  const tail = /^\s/u.test(after) ? "" : " ";
  const token = `${lead}@${name}${tail}`;
  return { text: `${before}${token}${after}`, caret: before.length + token.length };
}

// ---------------------------------------------------------------------------
// 一覧の表示
// ---------------------------------------------------------------------------

/** 一覧用の 1 行要約（改行・タブは空白に、max 文字で切って「…」） */
export function summarizeBody(body: string | null | undefined, max = 40): string {
  const text = (body ?? "").replace(/\s+/gu, " ").trim();
  if (max <= 0 || text === "") return "";
  const chars = [...text];
  if (chars.length <= max) return text;
  return `${chars.slice(0, max).join("")}…`;
}

/** 未読バッジの文字（0 以下は ""、100 以上は "99+"） */
export function unreadLabel(count: number | null | undefined, max = 99): string {
  const n = Math.floor(Number(count ?? 0));
  if (!Number.isFinite(n) || n <= 0) return "";
  return n > max ? `${max}+` : String(n);
}

/** メンションのバッジの文字（"@3"。0 以下は ""） */
export function mentionLabel(count: number | null | undefined, max = 99): string {
  const label = unreadLabel(count, max);
  return label === "" ? "" : `@${label}`;
}
