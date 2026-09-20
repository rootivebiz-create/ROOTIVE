"use client";

import { CloudOff, UploadCloud } from "lucide-react";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { flushOutbox } from "@/lib/offline/sync";
import { cn } from "@/lib/utils";
import { useOfflineStatus } from "./use-offline";

/**
 * 画面の中に出す「未送信 n 件」の案内（ドライバーの「今日の報告」で使う）
 * オンラインで未送信も無いときは何も出さない
 */
export function OutboxNotice({ className }: { className?: string }) {
  const { online, pending, pendingLabel, syncing, persistent } = useOfflineStatus();
  if (online && pending === 0) return null;

  return (
    <Alert variant="warning" className={cn("flex flex-wrap items-center gap-2", className)}>
      <CloudOff className="h-4 w-4 shrink-0" aria-hidden />
      <div className="min-w-0 flex-1 space-y-0.5">
        <p className="break-words font-medium">{pending > 0 ? pendingLabel : "オフラインです"}</p>
        <p className="break-words text-xs">
          {pending > 0
            ? "電波が戻ると自動で送信します。このまま入力を続けられます。"
            : "入力した内容は端末に保存され、電波が戻ると自動で送信します。"}
        </p>
        {pending > 0 && !persistent && <p className="break-words text-xs">この端末では保存できないため、アプリを閉じると未送信が消えます。</p>}
      </div>
      {pending > 0 && (
        <Button size="sm" variant="outline" onClick={() => void flushOutbox({ manual: true })} disabled={syncing}>
          <UploadCloud aria-hidden />
          {syncing ? "送信中…" : "今すぐ送信"}
        </Button>
      )}
    </Alert>
  );
}
