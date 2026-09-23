"use client";

import { House } from "lucide-react";
import { Button } from "@/components/ui/button";
import { setStartPageAction } from "@/lib/actions/office";
import { useRun } from "./use-run";

/** 事務を最初に開く画面にする（設定 → アカウント でも変えられる） */
export function StartPageButton({ isStart }: { isStart: boolean }) {
  const { pending, run } = useRun();
  if (isStart) {
    return <p className="text-xs text-muted-foreground">ログインするとこの画面が開きます</p>;
  }
  return (
    <Button size="sm" variant="outline" onClick={() => run(() => setStartPageAction("office"), "ログインしたらこの画面を開きます")} disabled={pending} aria-busy={pending}>
      <House />
      最初に開く画面にする
    </Button>
  );
}
