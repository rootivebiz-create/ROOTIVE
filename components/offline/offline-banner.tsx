"use client";

import { useEffect, useRef } from "react";
import { CloudOff, UploadCloud } from "lucide-react";
import { Button } from "@/components/ui/button";
import { flushOutbox } from "@/lib/offline/sync";
import { cn } from "@/lib/utils";
import { useOfflineStatus } from "./use-offline";

/*
 * 帯のぶんだけ本文と固定ヘッダーを下げる CSS は app/globals.css にある。
 * ここでは高さ（--offline-banner-h）だけを設定する。
 */

/**
 * 画面上部の細い帯
 * - オフラインのとき：「オフラインです。入力は保存され、電波が戻ると送信します」
 * - 未送信があるとき：件数と「今すぐ送信」
 */
export function OfflineBanner() {
  const { online, pending, pendingLabel, syncing, persistent } = useOfflineStatus();
  const ref = useRef<HTMLDivElement>(null);
  const visible = !online || pending > 0;

  useEffect(() => {
  }, []);

  useEffect(() => {
    const root = document.documentElement;
    const clear = () => root.style.removeProperty("--offline-banner-h");
    if (!visible) {
      clear();
      return clear;
    }
    const apply = () => root.style.setProperty("--offline-banner-h", `${ref.current?.offsetHeight ?? 0}px`);
    apply();
    window.addEventListener("resize", apply);
    return () => {
      window.removeEventListener("resize", apply);
      clear();
    };
  }, [visible, online, pending, syncing, persistent, pendingLabel]);

  if (!visible) return null;

  return (
    <div
      ref={ref}
      role="status"
      aria-live="polite"
      className={cn(
        "fixed inset-x-0 top-0 z-50 border-b bg-card/95 px-3 py-1.5 backdrop-blur no-print",
        "flex flex-wrap items-center justify-center gap-x-2 gap-y-1 text-xs",
      )}
      style={{ paddingTop: "max(0.375rem, env(safe-area-inset-top))" }}
    >
      <CloudOff className="h-3.5 w-3.5 shrink-0 text-warning" aria-hidden />
      <span className="min-w-0 break-words text-warning">
        {online ? "未送信の記録があります。" : "オフラインです。入力は保存され、電波が戻ると送信します。"}
      </span>
      {pending > 0 && (
        <>
          <span className="min-w-0 break-words text-muted-foreground">{pendingLabel}</span>
          <Button size="sm" variant="outline" className="h-7 px-2 text-xs" onClick={() => void flushOutbox({ manual: true })} disabled={syncing}>
            <UploadCloud className="h-3.5 w-3.5" aria-hidden />
            {syncing ? "送信中…" : "今すぐ送信"}
          </Button>
        </>
      )}
      {pending > 0 && !persistent && <span className="w-full text-center text-[11px] text-muted-foreground">この端末では保存できないため、アプリを閉じると未送信が消えます。</span>}
    </div>
  );
}
