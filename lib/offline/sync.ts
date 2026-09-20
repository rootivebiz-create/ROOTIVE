/**
 * 未送信データの送信（オンラインに戻ったとき・30 秒ごと・「今すぐ送信」）
 *
 * - 送信は **既存の Server Action をそのまま呼ぶ**（`lib/actions/daily.ts` は変えない）
 * - 成功したらキューから消す。通信が原因の失敗は回数を増やして次回へ（指数バックオフ）
 * - サーバーが日本語の理由（締め済み・権限・入力の誤り）を返したものは送り直さず、利用者に伝えてキューから外す
 * - `navigator.onLine` は信用しきれないため、実際の送信結果でもオンライン・オフラインを判断する
 */
import { toast } from "sonner";
import { saveDailyReportAction, submitDayEntriesAction } from "@/lib/actions/daily";
import type { ActionResult } from "@/lib/actions/result";
import { deleteOutboxItem, isOutboxAvailable, listOutbox, saveOutboxItem } from "./queue";
import {
  createOutboxItem,
  dedupeKey,
  describeOutboxEntry,
  errorMessage,
  isDue,
  markFailed,
  shouldRetry,
  sortOutbox,
  type OutboxEntry,
  type OutboxItem,
} from "./queue-core";
import { setOfflineState, setOutboxItems } from "./store";

/** 定期送信の間隔（30 秒） */
export const SYNC_INTERVAL_MS = 30_000;

/** 送信できたときに window へ出す合図（画面はこれを受けて再読み込みする） */
export const OUTBOX_SYNCED_EVENT = "rootive:outbox-synced";

/** キューに入れたときの案内 */
export const QUEUED_MESSAGE = "保存しました（電波が戻ると送信します）";

/** キューにも保存できなかったときの案内 */
const QUEUE_FAILED_MESSAGE = "保存できませんでした。電波の良い場所でもう一度お試しください。";

/** 画面へ返す結果 */
export type SubmitOutcome =
  | { status: "sent"; message: string }
  | { status: "queued"; message: string }
  | { status: "failed"; error: string };

type SendOutcome = { status: "sent"; message: string } | { status: "error"; error: string; retry: boolean };

function isOffline(): boolean {
  return typeof navigator !== "undefined" && navigator.onLine === false;
}

function emitSynced(): void {
  if (typeof window === "undefined") return;
  try {
    window.dispatchEvent(new CustomEvent(OUTBOX_SYNCED_EVENT));
  } catch {
    /* 古いブラウザ対策：合図が出せなくても送信自体は済んでいる */
  }
}

/** 種類ごとに既存の Server Action を呼ぶ */
async function callAction(entry: OutboxEntry): Promise<ActionResult<unknown>> {
  if (entry.kind === "daily_report") return saveDailyReportAction(entry.payload.input);
  return submitDayEntriesAction(entry.payload.work_date, entry.payload.rows);
}

/** 1 件を送る（例外は投げない） */
async function sendEntry(entry: OutboxEntry): Promise<SendOutcome> {
  try {
    const res = await callAction(entry);
    if (res.ok) {
      setOfflineState({ online: true });
      return { status: "sent", message: res.message ?? "送信しました" };
    }
    // サーバーまで届いている＝通信はできている
    setOfflineState({ online: true });
    return { status: "error", error: res.error, retry: shouldRetry(res.error) };
  } catch (e) {
    const retry = shouldRetry(e);
    if (retry) setOfflineState({ online: false });
    return { status: "error", error: errorMessage(e), retry };
  }
}

/** 未送信の一覧を読み直して状態へ反映する */
export async function refreshOutbox(): Promise<OutboxItem[]> {
  const items = sortOutbox(await listOutbox());
  setOutboxItems(items);
  setOfflineState({ persistent: isOutboxAvailable() });
  return items;
}

/** 1 件をキューへ入れる（同じ日・同じ内容は新しいほうで置き換わる） */
export async function queueEntry(entry: OutboxEntry, now: number = Date.now()): Promise<boolean> {
  const ok = await saveOutboxItem(createOutboxItem(entry, now));
  await refreshOutbox();
  return ok;
}

/**
 * 画面からの送信：まず送ってみて、通信できなければキューへ入れる
 * - オフラインが分かっているときは試さずにキューへ入れる（待たせない）
 * - 送信できたときは、同じ内容の未送信が残っていれば消す（二重送信を防ぐ）
 */
export async function submitWithOfflineFallback(entry: OutboxEntry): Promise<SubmitOutcome> {
  const key = dedupeKey(entry.kind, entry.payload);

  if (isOffline()) {
    setOfflineState({ online: false });
    const queued = await queueEntry(entry);
    return queued ? { status: "queued", message: QUEUED_MESSAGE } : { status: "failed", error: QUEUE_FAILED_MESSAGE };
  }

  const out = await sendEntry(entry);
  if (out.status === "sent") {
    await deleteOutboxItem(key);
    await refreshOutbox();
    return { status: "sent", message: out.message };
  }
  if (out.retry) {
    const queued = await queueEntry(entry);
    return queued ? { status: "queued", message: QUEUED_MESSAGE } : { status: "failed", error: QUEUE_FAILED_MESSAGE };
  }
  // 送り直しても同じ理由（締め済み・権限・入力の誤り）なのでキューには残さない
  await deleteOutboxItem(key);
  await refreshOutbox();
  return { status: "failed", error: out.error };
}

export interface FlushResult {
  /** 送信できた件数 */
  sent: number;
  /** 次回へ回した件数 */
  kept: number;
  /** 送り直しても無駄なので取り下げた件数 */
  dropped: number;
  /** 残っている未送信の件数 */
  pending: number;
}

let flushing = false;

/**
 * 未送信をまとめて送る
 * @param options.manual 「今すぐ送信」から呼ぶとき（待ち時間を無視し、結果をトーストで知らせる）
 */
export async function flushOutbox(options: { manual?: boolean } = {}): Promise<FlushResult> {
  const manual = options.manual === true;
  if (flushing) return { sent: 0, kept: 0, dropped: 0, pending: (await refreshOutbox()).length };
  if (!manual && isOffline()) {
    const items = await refreshOutbox();
    return { sent: 0, kept: items.length, dropped: 0, pending: items.length };
  }

  flushing = true;
  setOfflineState({ syncing: true });
  let sent = 0;
  let kept = 0;
  let dropped = 0;
  try {
    const items = sortOutbox(await listOutbox());
    if (items.length === 0) {
      if (manual) toast.info("未送信はありません");
      return { sent: 0, kept: 0, dropped: 0, pending: 0 };
    }

    const now = Date.now();
    for (const item of items) {
      if (!manual && !isDue(item, now)) {
        kept += 1;
        continue;
      }
      const out = await sendEntry(item);
      if (out.status === "sent") {
        await deleteOutboxItem(item.id);
        sent += 1;
        continue;
      }
      if (!out.retry) {
        await deleteOutboxItem(item.id);
        dropped += 1;
        toast.error(`${describeOutboxEntry(item)}は送信できませんでした：${out.error}`, { duration: 12_000 });
        continue;
      }
      await saveOutboxItem(markFailed(item, out.error, Date.now()));
      kept += 1;
      // 通信できていないなら残りも同じ結果になるため、ここで止めて次回に回す
      break;
    }
    if (sent > 0) {
      toast.success(`未送信の ${sent} 件を送信しました`);
      emitSynced();
    } else if (manual && kept > 0) {
      toast.warning("まだ送信できません。電波の良い場所でもう一度お試しください。");
    }
    const pending = (await listOutbox()).length;
    return { sent, kept, dropped, pending };
  } finally {
    flushing = false;
    setOfflineState({ syncing: false });
    await refreshOutbox();
  }
}

let stop: (() => void) | null = null;

/**
 * オンライン復帰（`online`）と 30 秒ごとの定期送信を始める
 * 二重には起動しない。戻り値を呼ぶと止まる
 */
export function startOfflineSync(): () => void {
  if (typeof window === "undefined") return () => {};
  if (stop) return stop;

  const onOnline = () => {
    setOfflineState({ online: true });
    void flushOutbox();
  };
  const onOffline = () => setOfflineState({ online: false });
  const onVisible = () => {
    if (typeof document !== "undefined" && document.visibilityState === "visible") void flushOutbox();
  };

  window.addEventListener("online", onOnline);
  window.addEventListener("offline", onOffline);
  document.addEventListener("visibilitychange", onVisible);
  const timer = window.setInterval(() => void flushOutbox(), SYNC_INTERVAL_MS);

  setOfflineState({ online: !isOffline(), persistent: isOutboxAvailable() });
  void refreshOutbox().then(() => flushOutbox());

  stop = () => {
    window.removeEventListener("online", onOnline);
    window.removeEventListener("offline", onOffline);
    document.removeEventListener("visibilitychange", onVisible);
    window.clearInterval(timer);
    stop = null;
  };
  return stop;
}
