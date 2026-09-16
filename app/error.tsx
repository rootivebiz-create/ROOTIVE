"use client";

import { Button } from "@/components/ui/button";

export default function GlobalError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <main className="flex min-h-dvh flex-col items-center justify-center gap-4 p-6 text-center">
      <h1 className="text-2xl font-bold">エラーが発生しました</h1>
      <p className="max-w-md break-words text-sm text-muted-foreground">{error.message || "画面の表示に失敗しました。"}</p>
      <Button onClick={() => reset()}>再読み込み</Button>
    </main>
  );
}
