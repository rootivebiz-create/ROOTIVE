/**
 * 送信キュー（オフラインのときの未送信データ）の純関数
 *
 * - ブラウザ API（IndexedDB・fetch・window）に依存しない。保存は `lib/offline/queue.ts`、送信は `lib/offline/sync.ts`
 * - 時刻はエポックミリ秒で持ち、表示は日本時間（`lib/daily/helpers` の変換を使う）
 * - 「同じ日・同じ内容」の二重送信は `dedupeKey()` で防ぐ（キューの id ＝ dedupeKey）
 */
import { formatWorkDate, isWorkDate, isoToJstDate, isoToJstTime } from "@/lib/daily/helpers";
import type { DailyReportFormInput, DayEntryRowInput } from "@/lib/schemas/daily";

/** 送信できる種類（いずれも既存の Server Action をそのまま呼ぶ） */
export const OUTBOX_KINDS = ["daily_report", "day_entries"] as const;
export type OutboxKind = (typeof OUTBOX_KINDS)[number];

/** 種類の表示名（トースト・帯に出す） */
export const OUTBOX_KIND_LABELS: Record<OutboxKind, string> = {
  daily_report: "点呼・業務記録",
  day_entries: "今日の稼働",
};

/** 日報（点呼・業務記録）の保存。`saveDailyReportAction(input)` に渡す */
export interface DailyReportPayload {
  input: DailyReportFormInput;
}

/** 日別の稼働報告。`submitDayEntriesAction(work_date, rows)` に渡す */
export interface DayEntriesPayload {
  work_date: string;
  rows: DayEntryRowInput[];
}

/** 送信 1 件ぶんの中身（種類ごとに payload が決まる） */
export type OutboxEntry =
  | { kind: "daily_report"; payload: DailyReportPayload }
  | { kind: "day_entries"; payload: DayEntriesPayload };

/** キューに入っている 1 件（id は dedupeKey と同じ＝同じ内容は 1 件にまとまる） */
export type OutboxItem = OutboxEntry & {
  id: string;
  /** キューに入れた時刻（エポックミリ秒） */
  createdAt: number;
  /** 送信を試みた回数 */
  tries: number;
  /** 直近の失敗理由（日本語）。未失敗は null */
  lastError: string | null;
  /** 直近に送信を試みた時刻。未試行は null */
  lastTriedAt: number | null;
};

/** 再送の最短の待ち時間（ミリ秒） */
export const RETRY_BASE_MS = 5_000;
/** 再送の最長の待ち時間（ミリ秒・5 分） */
export const RETRY_MAX_MS = 5 * 60 * 1000;

type Obj = Record<string, unknown>;

function isObj(v: unknown): v is Obj {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function workDateOf(v: unknown): string {
  return isWorkDate(v) ? v : "";
}

/** エポックミリ秒 → 日本時間の "9/20(日) 14:03"。不正なら "" */
export function formatQueuedAt(ms: number | null | undefined): string {
  if (ms == null || !Number.isFinite(ms) || Math.abs(ms) > 8.64e15) return "";
  let iso = "";
  try {
    iso = new Date(ms).toISOString();
  } catch {
    return "";
  }
  const date = isoToJstDate(iso);
  if (date === "") return "";
  const time = isoToJstTime(iso);
  return time === "" ? formatWorkDate(date) : `${formatWorkDate(date)} ${time}`;
}

// ---------------------------------------------------------------------------
// 二重送信を防ぐキー
// ---------------------------------------------------------------------------

/**
 * 同じ日・同じ内容を 1 件にまとめるキー
 * - 日報は「日付 ＋ 区分（出発前・終了後・業務記録）」ごと（出発前と終了後は別の記録なので混ざらない）
 * - 日別の稼働は「日付」ごと（その日の全行をまとめて送るため、新しい入力で置き換える）
 */
export function dedupeKey(kind: OutboxKind, payload: unknown): string {
  const p = isObj(payload) ? payload : {};
  if (kind === "day_entries") return `day_entries:${workDateOf(p.work_date)}`;
  const input = isObj(p.input) ? p.input : {};
  const parts: string[] = [];
  if (isObj(input.pre)) parts.push("pre");
  if (isObj(input.post)) parts.push("post");
  if (isObj(input.work)) parts.push("work");
  if (input.vehicle_id !== undefined && parts.length === 0) parts.push("vehicle");
  if (parts.length === 0) parts.push("other");
  return `${String(kind)}:${workDateOf(input.work_date)}:${parts.join("+")}`;
}

/** その 1 件が対象にしている稼働日 "YYYY-MM-DD"（分からなければ ""） */
export function entryWorkDate(entry: OutboxEntry | OutboxItem): string {
  if (entry.kind === "day_entries") return workDateOf(entry.payload?.work_date);
  return workDateOf(entry.payload?.input?.work_date);
}

/** トーストに出す説明（「今日の稼働（9/20(日)）」） */
export function describeOutboxEntry(entry: OutboxEntry | OutboxItem): string {
  const label = OUTBOX_KIND_LABELS[entry.kind] ?? "未送信の記録";
  const date = entryWorkDate(entry);
  return date === "" ? label : `${label}（${formatWorkDate(date)}）`;
}

// ---------------------------------------------------------------------------
// キューの操作（すべて新しい配列・オブジェクトを返す）
// ---------------------------------------------------------------------------

/** キューに入れる 1 件を作る（id は dedupeKey） */
export function createOutboxItem(entry: OutboxEntry, now: number = Date.now()): OutboxItem {
  return {
    ...entry,
    id: dedupeKey(entry.kind, entry.payload),
    createdAt: Number.isFinite(now) ? now : 0,
    tries: 0,
    lastError: null,
    lastTriedAt: null,
  } as OutboxItem;
}

/** 古い順（キューに入れた順）に並べ替える */
export function sortOutbox(items: readonly OutboxItem[]): OutboxItem[] {
  return [...items].sort((a, b) => a.createdAt - b.createdAt || a.id.localeCompare(b.id));
}

/**
 * 同じ dedupeKey（＝ id）は新しいほうで置き換える
 * 置き換えるときは元の位置を保ち、新しいキーは末尾に足す
 */
export function mergeQueued(items: readonly OutboxItem[], incoming: OutboxItem | readonly OutboxItem[]): OutboxItem[] {
  const list = Array.isArray(incoming) ? [...incoming] : [incoming as OutboxItem];
  const out = [...items];
  for (const next of list) {
    if (!next || typeof next.id !== "string") continue;
    const at = out.findIndex((x) => x.id === next.id);
    if (at >= 0) out[at] = next;
    else out.push(next);
  }
  return out;
}

/** 送信に失敗した 1 件（再試行の回数と理由を進める） */
export function markFailed(item: OutboxItem, error: string, now: number = Date.now()): OutboxItem {
  return {
    ...item,
    tries: (Number.isFinite(item.tries) ? item.tries : 0) + 1,
    lastError: typeof error === "string" && error.trim() !== "" ? error : "送信できませんでした。",
    lastTriedAt: Number.isFinite(now) ? now : null,
  };
}

// ---------------------------------------------------------------------------
// 再送の間隔
// ---------------------------------------------------------------------------

/** 再送までの待ち時間（指数バックオフ。5 秒から倍々で最大 5 分） */
export function nextRetryDelayMs(tries: number): number {
  if (!Number.isFinite(tries) || tries <= 0) return RETRY_BASE_MS;
  const n = Math.min(Math.floor(tries), 20);
  return Math.min(RETRY_BASE_MS * 2 ** n, RETRY_MAX_MS);
}

/** いま送ってよい 1 件か（1 回目はすぐ、2 回目以降は待ち時間が過ぎてから） */
export function isDue(item: OutboxItem, now: number = Date.now()): boolean {
  const tries = Number.isFinite(item.tries) ? item.tries : 0;
  if (tries <= 0) return true;
  const last = Number.isFinite(item.lastTriedAt) && item.lastTriedAt != null ? item.lastTriedAt : item.createdAt;
  if (!Number.isFinite(last)) return true;
  return now - last >= nextRetryDelayMs(tries);
}

// ---------------------------------------------------------------------------
// 再試行してよい失敗か
// ---------------------------------------------------------------------------

/** 通信が原因のときに出るメッセージ（日本語・英語の両方） */
const NETWORK_PATTERNS: RegExp[] = [
  /failed to fetch/i,
  /fetch failed/i,
  /network\s?error/i,
  /network request failed/i,
  /load failed/i,
  /connection (closed|reset|refused|lost)/i,
  /internet connection/i,
  /err_(internet_disconnected|network_changed|connection_[a-z_]+|name_not_resolved|timed_out)/i,
  /time(d)? ?out/i,
  /abort(ed)?/i,
  /socket hang up/i,
  /オフライン/,
  /ネットワーク/,
  /通信/,
  /電波/,
  /接続でき/,
  /タイムアウト/,
  /サーバーに(接続|到達)/,
  // セッション切れ・サーバー側の不調は、あとで送り直せば通る可能性がある
  // （法令上 1 年保存が必要な記録なので、ここで捨てない）
  /ログイン/,
  /セッション/,
  /データベースエラー/,
];

/** 日本語（ひらがな・カタカナ・漢字）を含むか＝サーバーが返した案内文 */
const JAPANESE_RE = /[぀-ヿ一-龯]/;

function messageOf(error: unknown): string {
  if (error == null) return "";
  if (typeof error === "string") return error;
  if (error instanceof Error) return error.message;
  if (isObj(error)) {
    if (typeof error.error === "string") return error.error;
    if (typeof error.message === "string") return error.message;
  }
  return "";
}

function statusOf(error: unknown): number | null {
  if (!isObj(error)) return null;
  const raw = error.status ?? error.statusCode;
  return typeof raw === "number" && Number.isFinite(raw) ? raw : null;
}

/**
 * その失敗をあとで送り直してよいか
 * - 通信が原因・原因不明：true（電波が戻ったら送る）
 * - サーバーが日本語で返した理由（締め済み・権限・入力の誤り）：false（送り直しても同じなのでキューから外す）
 */
export function shouldRetry(error: unknown): boolean {
  const message = messageOf(error).trim();
  if (NETWORK_PATTERNS.some((re) => re.test(message))) return true;

  const status = statusOf(error);
  if (status != null) {
    if (status === 408 || status === 429 || status >= 500) return true;
    if (status >= 400) return false;
  }

  if (message === "") return true;
  return !JAPANESE_RE.test(message);
}

/** 失敗の理由を日本語のメッセージにする（空なら既定の文言） */
export function errorMessage(error: unknown): string {
  const message = messageOf(error).trim();
  if (message === "") return "送信できませんでした。電波の良い場所でもう一度お試しください。";
  if (!JAPANESE_RE.test(message)) return "通信できませんでした。電波が戻ると自動で送信します。";
  return message;
}

// ---------------------------------------------------------------------------
// まとめ（帯・通知に出す）
// ---------------------------------------------------------------------------

export interface OutboxSummary {
  /** 未送信の件数 */
  count: number;
  /** いちばん古い未送信の時刻（エポックミリ秒）。無ければ null */
  oldestAt: number | null;
  /** いちばん古い未送信の日本時間の表示。無ければ "" */
  oldestLabel: string;
  /** 画面に出す 1 行（例「未送信 2 件（最も古い記録：9/20(日) 14:03）」） */
  label: string;
}

/** 未送信の件数と、いちばん古い日時の日本語表示 */
export function summarizeOutbox(items: readonly OutboxItem[] | null | undefined): OutboxSummary {
  const list = Array.isArray(items) ? items.filter((i) => i != null) : [];
  if (list.length === 0) return { count: 0, oldestAt: null, oldestLabel: "", label: "未送信はありません" };
  let oldestAt: number | null = null;
  for (const item of list) {
    const at = Number.isFinite(item.createdAt) ? item.createdAt : null;
    if (at == null) continue;
    if (oldestAt == null || at < oldestAt) oldestAt = at;
  }
  const oldestLabel = formatQueuedAt(oldestAt);
  const label = oldestLabel === "" ? `未送信 ${list.length} 件` : `未送信 ${list.length} 件（最も古い記録：${oldestLabel}）`;
  return { count: list.length, oldestAt, oldestLabel, label };
}

// ---------------------------------------------------------------------------
// 保存されていた値の読み戻し（壊れた行は捨てる）
// ---------------------------------------------------------------------------

function isOutboxKind(v: unknown): v is OutboxKind {
  return typeof v === "string" && (OUTBOX_KINDS as readonly string[]).includes(v);
}

/** IndexedDB から読んだ値を安全に 1 件へ変換する（不正なら null） */
export function toOutboxItem(value: unknown): OutboxItem | null {
  if (!isObj(value)) return null;
  const kind = value.kind;
  if (!isOutboxKind(kind)) return null;
  const payload = value.payload;
  if (!isObj(payload)) return null;
  if (kind === "day_entries") {
    if (!isWorkDate(payload.work_date) || !Array.isArray(payload.rows) || payload.rows.length === 0) return null;
  } else if (!isObj(payload.input) || !isWorkDate((payload.input as Obj).work_date)) {
    return null;
  }
  const id = typeof value.id === "string" && value.id !== "" ? value.id : dedupeKey(kind, payload);
  const createdAt = typeof value.createdAt === "number" && Number.isFinite(value.createdAt) ? value.createdAt : 0;
  const tries = typeof value.tries === "number" && Number.isFinite(value.tries) && value.tries > 0 ? Math.floor(value.tries) : 0;
  const lastError = typeof value.lastError === "string" && value.lastError !== "" ? value.lastError : null;
  const lastTriedAt = typeof value.lastTriedAt === "number" && Number.isFinite(value.lastTriedAt) ? value.lastTriedAt : null;
  return { kind, payload, id, createdAt, tries, lastError, lastTriedAt } as unknown as OutboxItem;
}

/** 読み戻した配列（壊れた行は捨てて古い順に並べる） */
export function toOutboxItems(values: readonly unknown[] | null | undefined): OutboxItem[] {
  if (!Array.isArray(values)) return [];
  const out: OutboxItem[] = [];
  for (const v of values) {
    const item = toOutboxItem(v);
    if (item) out.push(item);
  }
  return sortOutbox(out);
}
