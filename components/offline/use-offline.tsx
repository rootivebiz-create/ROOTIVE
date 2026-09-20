"use client";

import { useSyncExternalStore } from "react";
import { getOfflineState, subscribeOffline, type OfflineState } from "@/lib/offline/store";

/**
 * オフラインの状態と未送信の件数を読む
 * サーバー描画では初期値（オンライン・未送信 0 件）なので、ハイドレーションでずれない
 */
export function useOfflineStatus(): OfflineState {
  return useSyncExternalStore(subscribeOffline, getOfflineState, getOfflineState);
}
