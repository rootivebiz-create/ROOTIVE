"use client";

import { useEffect } from "react";
import { RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";

/** ドライバーポータルのエラー表示 */
export default function DriverError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    console.error("[driver]", error);
  }, [error]);

  return (
    <div className="flex flex-col items-center justify-center gap-3 rounded-lg border border-dashed p-8 text-center">
      <p className="text-lg font-bold">この画面を表示できませんでした</p>
      <p className="max-w-md break-words text-sm text-muted-foreground">
        {error.message || "電波の良いところで、もう一度お試しください。"}
      </p>
      <Button onClick={() => reset()}>
        <RefreshCw /> もう一度読み込む
      </Button>
    </div>
  );
}
