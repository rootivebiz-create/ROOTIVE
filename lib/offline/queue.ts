/**
 * 送信キューの保存先（IndexedDB "rootive-offline" / ストア "outbox"）の薄いラッパー
 *
 * - **例外を投げない**。IndexedDB が使えない（SSR・プライベートモード・容量不足）ときは
 *   `isOutboxAvailable()` が false を返し、その場でメモリへ退避する（アプリを閉じると消える）
 * - 中身の検査・並べ替えは `queue-core.ts` の純関数に任せる
 */
import { mergeQueued, toOutboxItem, toOutboxItems, type OutboxItem } from "./queue-core";

export const OUTBOX_DB_NAME = "rootive-offline";
export const OUTBOX_DB_VERSION = 1;
export const OUTBOX_STORE = "outbox";

/** IndexedDB が使えないときの退避先（この画面を閉じるまで） */
const memory = new Map<string, OutboxItem>();
let memoryOnly = false;

let dbPromise: Promise<IDBDatabase | null> | null = null;

/** IndexedDB に保存できるか（false でもキューは使えるが、アプリを閉じると消える） */
export function isOutboxAvailable(): boolean {
  if (memoryOnly) return false;
  try {
    return typeof globalThis !== "undefined" && typeof globalThis.indexedDB !== "undefined" && globalThis.indexedDB !== null;
  } catch {
    return false;
  }
}

function openDb(): Promise<IDBDatabase | null> {
  if (!isOutboxAvailable()) return Promise.resolve(null);
  if (dbPromise) return dbPromise;
  dbPromise = new Promise<IDBDatabase | null>((resolve) => {
    const fail = () => {
      memoryOnly = true;
      dbPromise = null;
      resolve(null);
    };
    try {
      const req = globalThis.indexedDB.open(OUTBOX_DB_NAME, OUTBOX_DB_VERSION);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains(OUTBOX_STORE)) db.createObjectStore(OUTBOX_STORE, { keyPath: "id" });
      };
      req.onsuccess = () => {
        const db = req.result;
        // 別のタブが新しい版へ上げたら閉じる（次回に開き直す）
        db.onversionchange = () => {
          try {
            db.close();
          } catch {
            /* 何もしない */
          }
          dbPromise = null;
        };
        resolve(db);
      };
      req.onerror = fail;
      req.onblocked = fail;
    } catch {
      fail();
    }
  });
  return dbPromise;
}

/** ストアを開いて 1 つの処理を行う（失敗したら fallback を返す） */
async function withStore<T>(mode: IDBTransactionMode, run: (store: IDBObjectStore) => IDBRequest, fallback: T, pick: (result: unknown) => T): Promise<T> {
  const db = await openDb();
  if (!db) return fallback;
  return new Promise<T>((resolve) => {
    let settled = false;
    const done = (value: T) => {
      if (!settled) {
        settled = true;
        resolve(value);
      }
    };
    try {
      const tx = db.transaction(OUTBOX_STORE, mode);
      const req = run(tx.objectStore(OUTBOX_STORE));
      req.onsuccess = () => done(pick(req.result));
      req.onerror = () => done(fallback);
      tx.onabort = () => done(fallback);
      tx.onerror = () => done(fallback);
    } catch {
      done(fallback);
    }
  });
}

/** 未送信の一覧（古い順。IndexedDB とメモリ退避の両方をまとめる） */
export async function listOutbox(): Promise<OutboxItem[]> {
  const rows: unknown[] = isOutboxAvailable()
    ? await withStore<unknown[]>(
        "readonly",
        (store) => store.getAll(),
        [],
        (result) => (Array.isArray(result) ? result : []),
      )
    : [];
  // メモリ退避のほうが新しいので後ろに置く（同じ id は mergeQueued で置き換わる）
  return mergeQueued(toOutboxItems(rows), toOutboxItems([...memory.values()]));
}

/** 未送信の件数 */
export async function countOutbox(): Promise<number> {
  return (await listOutbox()).length;
}

/** 1 件を保存する（同じ id は上書き）。保存できたら true */
export async function saveOutboxItem(item: OutboxItem): Promise<boolean> {
  const safe = toOutboxItem(item);
  if (!safe) return false;
  if (!isOutboxAvailable()) {
    memory.set(safe.id, safe);
    return true;
  }
  const ok = await withStore<boolean>("readwrite", (store) => store.put(safe), false, () => true);
  // 保存できなかったとき（容量不足など）はメモリへ退避する
  if (!ok) memory.set(safe.id, safe);
  return true;
}

/** 1 件を消す（送信できた・送り直しても無駄なとき） */
export async function deleteOutboxItem(id: string): Promise<boolean> {
  if (typeof id !== "string" || id === "") return false;
  memory.delete(id);
  if (!isOutboxAvailable()) return true;
  return withStore<boolean>("readwrite", (store) => store.delete(id), false, () => true);
}

/** すべて消す（ログアウト・復旧できない壊れ方をしたとき） */
export async function clearOutbox(): Promise<boolean> {
  memory.clear();
  if (!isOutboxAvailable()) return true;
  return withStore<boolean>("readwrite", (store) => store.clear(), false, () => true);
}
