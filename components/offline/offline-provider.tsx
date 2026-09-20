"use client";

import { useEffect } from "react";
import { registerServiceWorker } from "@/lib/offline/register-sw";
import { startOfflineSync } from "@/lib/offline/sync";
import { OfflineBanner } from "./offline-banner";

/**
 * オフライン対応の土台（画面には細い帯だけを出す）
 * - Service Worker（`/sw.js`）を登録する（失敗しても何も起きない）
 * - `online` / `offline` の監視と 30 秒ごとの再送を始める
 */
export function OfflineProvider() {
  useEffect(() => {
    registerServiceWorker();
  }, []);

  useEffect(() => {
    const stop = startOfflineSync();
    return () => stop();
  }, []);

  return <OfflineBanner />;
}
