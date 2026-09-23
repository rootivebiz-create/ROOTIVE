"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { BookOpen, CircleHelp } from "lucide-react";
import { Button, buttonVariants } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import type { Role } from "@/lib/db/types";
import { guideForPath } from "@/lib/guide/match";
import { PAGE_GUIDES } from "@/lib/guide/pages";
import { PageGuideContent } from "./guide-content";

/** 「？」を開くイベント（スマホのメニューからも開けるように） */
const OPEN_HELP_EVENT = "rootive:open-help";

export function openHelp() {
  window.dispatchEvent(new Event(OPEN_HELP_EVENT));
}

/**
 * ヘッダーの「？」。いま開いている画面の使い方を出す（見られない画面のガイドは出さない）。
 * 下の「使い方ガイド（全体）」から、毎日の流れ・月締めの流れ・よくある質問へ。
 */
export function HelpButton({
  role,
  management,
  hideOnMobile = false,
}: {
  role: Role;
  /** 経営の数字を見せるか（見られない画面のガイドは出さない。省くとロールの既定） */
  management?: boolean;
  /** スマホではヘッダーに出さない（メニューから開く） */
  hideOnMobile?: boolean;
}) {
  const pathname = usePathname() ?? "/";
  const [open, setOpen] = useState(false);

  useEffect(() => {
    const onOpen = () => setOpen(true);
    window.addEventListener(OPEN_HELP_EVENT, onOpen);
    return () => window.removeEventListener(OPEN_HELP_EVENT, onOpen);
  }, []);
  const guide = guideForPath(PAGE_GUIDES, pathname, role, management);
  const overall = role === "driver" ? "/driver/guide" : "/guide";

  return (
    <>
      <Button variant="ghost" size="icon" className={hideOnMobile ? "hidden h-11 w-11 sm:inline-flex" : "h-11 w-11"} aria-label="この画面の使い方" onClick={() => setOpen(true)}>
        <CircleHelp className="h-5 w-5" />
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-h-[85dvh] overflow-y-auto sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>{guide ? `使い方：${guide.title}` : "使い方"}</DialogTitle>
            <DialogDescription>{guide ? "この画面でできることと、使う順番です。" : "この画面の説明はまだありません。全体のガイドをご覧ください。"}</DialogDescription>
          </DialogHeader>
          {guide && <PageGuideContent guide={guide} role={role} />}
          <DialogFooter className="gap-2 sm:justify-between">
            <Link href={guide ? `${overall}#${guide.slug}` : overall} className={buttonVariants({ variant: "outline" })} onClick={() => setOpen(false)}>
              <BookOpen />
              使い方ガイド（全体）
            </Link>
            <Button onClick={() => setOpen(false)}>閉じる</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
