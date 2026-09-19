"use client";

import { useEffect } from "react";
import { RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";

/**
 * スタッフ画面のエラー表示（Server Component の例外をここで受ける）。
 * アプリのシェル（ナビ）は残るので、別の画面へ移動して続きの作業ができる。
 */
export default function AppError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    console.error("[app]", error);
  }, [error]);

  return (
    <div className="flex flex-col items-center justify-center gap-3 rounded-lg border border-dashed p-8 text-center">
      <p className="text-lg font-bold">この画面を表示できませんでした</p>
      <p className="max-w-md break-words text-sm text-muted-foreground">
        {error.message || "時間をおいてもう一度お試しください。"}
      </p>
      <div className="flex flex-wrap items-center justify-center gap-2">
        <Button onClick={() => reset()}>
          <RefreshCw /> もう一度読み込む
        </Button>
      </div>
      {error.digest && <p className="text-xs text-muted-foreground">エラー番号：{error.digest}</p>}
    </div>
  );
}
