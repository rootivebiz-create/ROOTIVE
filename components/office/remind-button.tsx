"use client";

import { useState } from "react";
import { BellRing, Send } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { remindReportsAction } from "@/lib/actions/office";
import type { Reporter } from "@/lib/office/desk";
import { useRun } from "./use-run";

/**
 * 今日の報告がまだの人へ、まとめて催促する。
 * 送る前に宛先を見せる（人に届くものなので、押し間違いで送らない）。
 * 1 人 1 日 1 回まで（二度目は DB が弾き、送らない）。
 */
export function RemindButton({ targets, size = "sm" }: { targets: Reporter[]; size?: "sm" | "default" }) {
  const [open, setOpen] = useState(false);
  const { pending, run } = useRun();
  const send = () => run(() => remindReportsAction({ driverIds: targets.map((t) => t.driverId) }), "催促しました", () => setOpen(false));

  if (targets.length === 0) return null;
  return (
    <>
      <Button size={size} onClick={() => setOpen(true)}>
        <BellRing />
        まとめて催促（{targets.length} 人）
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>今日の報告を催促する</DialogTitle>
            <DialogDescription>次の {targets.length} 人に「今日の報告がまだです」と知らせます。同じ人へは 1 日 1 回までです。</DialogDescription>
          </DialogHeader>
          <ul className="space-y-1 text-sm">
            {targets.map((t) => (
              <li key={t.driverId} className="flex items-center justify-between gap-2 rounded-md bg-muted/50 px-2 py-1.5">
                <span className="font-medium">{t.name}</span>
                <span className="text-xs text-muted-foreground">{[t.hasLogin ? "アプリ" : "", t.lineLinked ? "LINE" : ""].filter(Boolean).join("・")}</span>
              </li>
            ))}
          </ul>
          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={() => setOpen(false)} disabled={pending}>
              やめる
            </Button>
            <Button onClick={send} disabled={pending} aria-busy={pending}>
              <Send />
              {targets.length} 人に送る
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
