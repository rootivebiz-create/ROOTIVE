/**
 * オフラインの状態（画面が見に行く小さなストア）
 *
 * React の `useSyncExternalStore` から読む。スナップショットは変化したときだけ新しい参照になる
 * （サーバー描画では初期値のまま＝ハイドレーションのずれが起きない）。
 */
import { summarizeOutbox, type OutboxItem } from "./queue-core";

export interface OfflineState {
  /** 通信できているか（`navigator.onLine` と実際の送信結果の両方で決める） */
  online: boolean;
  /** 未送信の件数 */
  pending: number;
  /** いちばん古い未送信の時刻（エポックミリ秒） */
  oldestAt: number | null;
  /** 画面に出す 1 行 */
  pendingLabel: string;
  /** いま送信中か */
  syncing: boolean;
  /** 端末に保存できているか（false＝アプリを閉じると未送信が消える） */
  persistent: boolean;
}

const INITIAL: OfflineState = {
  online: true,
  pending: 0,
  oldestAt: null,
  pendingLabel: "未送信はありません",
  syncing: false,
  persistent: true,
};

let state: OfflineState = INITIAL;
const listeners = new Set<() => void>();

/** いまの状態（同じ内容なら同じ参照を返す） */
export function getOfflineState(): OfflineState {
  return state;
}

/** 変化を受け取る（戻り値を呼ぶと解除） */
export function subscribeOffline(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function isSame(a: OfflineState, b: OfflineState): boolean {
  return (
    a.online === b.online &&
    a.pending === b.pending &&
    a.oldestAt === b.oldestAt &&
    a.pendingLabel === b.pendingLabel &&
    a.syncing === b.syncing &&
    a.persistent === b.persistent
  );
}

/** 状態を更新する（変化が無ければ何もしない） */
export function setOfflineState(patch: Partial<OfflineState>): void {
  const next: OfflineState = { ...state, ...patch };
  if (isSame(state, next)) return;
  state = next;
  for (const listener of [...listeners]) {
    try {
      listener();
    } catch {
      /* 画面側の例外で他の購読者を止めない */
    }
  }
}

/** 未送信の一覧から件数・表示を作り直す */
export function setOutboxItems(items: readonly OutboxItem[]): void {
  const s = summarizeOutbox(items);
  setOfflineState({ pending: s.count, oldestAt: s.oldestAt, pendingLabel: s.label });
}

/** テスト・ログアウト用に初期状態へ戻す */
export function resetOfflineState(): void {
  state = INITIAL;
  for (const listener of [...listeners]) listener();
}
