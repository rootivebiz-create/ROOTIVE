"use client";

import { useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { ChevronRight, CircleHelp, Menu, Search } from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useMonth } from "@/lib/hooks/use-month";
import { cn } from "@/lib/utils";
import { openCommandPalette } from "./command-palette";
import { openHelp } from "@/components/guide/help-button";
import { badgeText, type NavBadges, type NavItem } from "./nav";

/**
 * スマホの下タブの 5 つ目「メニュー」。
 * 下から出るシート（components/ui/dialog.tsx はスマホで全幅シートになる）に
 * 下タブに入りきらない画面・設定のサブ項目・検索（コマンドパレット）を並べる。
 */
export function MoreMenu({
  items,
  sub,
  active,
  badges,
  count,
}: {
  items: NavItem[];
  sub?: { parent: string; items: { href: string; label: string }[] };
  active?: boolean;
  badges?: NavBadges;
  /** メニュー全体の未読・未対応の合計（下タブのバッジ） */
  count?: number;
}) {
  const [open, setOpen] = useState(false);
  const pathname = usePathname();
  const { href } = useMonth();
  const subItems = sub?.items ?? [];

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-haspopup="dialog"
        aria-expanded={open}
        className={cn("relative flex w-full flex-col items-center gap-0.5 py-2 text-[11px]", active ? "text-primary" : "text-muted-foreground")}
      >
        <Menu className="h-5 w-5" />
        {badgeText(count) && (
          <span
            className="absolute right-[22%] top-1 inline-flex min-w-5 items-center justify-center rounded-full bg-destructive px-1.5 py-0.5 text-[10px] font-bold leading-none text-destructive-foreground"
            aria-label={`${badgeText(count)} 件`}
          >
            {badgeText(count)}
          </span>
        )}
        {"メニュー"}
      </button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-h-[80dvh]">
          <DialogHeader>
            <DialogTitle>メニュー</DialogTitle>
          </DialogHeader>

          <button
            type="button"
            onClick={() => {
              setOpen(false);
              openCommandPalette();
            }}
            className="flex w-full items-center gap-2 rounded-md border px-3 py-2.5 text-left text-sm text-muted-foreground"
          >
            <Search className="h-4 w-4 shrink-0" />
            画面・ドライバー・案件・月を検索
          </button>
          <button
            type="button"
            onClick={() => {
              setOpen(false);
              openHelp();
            }}
            className="flex w-full items-center gap-2 rounded-md border px-3 py-2.5 text-left text-sm"
          >
            <CircleHelp className="h-4 w-4 shrink-0 text-primary" />
            この画面の使い方
          </button>

          <ul className="grid grid-cols-2 gap-2">
            {items.map((item) => {
              const isCurrent = pathname === item.href || pathname.startsWith(item.href + "/");
              return (
                <li key={item.href}>
                  <Link
                    href={href(item.href)}
                    onClick={() => setOpen(false)}
                    className={cn(
                      "relative flex h-20 flex-col items-center justify-center gap-1 rounded-lg border text-center text-sm font-medium",
                      isCurrent ? "border-primary bg-accent text-accent-foreground" : "hover:bg-muted",
                    )}
                    aria-current={isCurrent ? "page" : undefined}
                  >
                    <item.icon className="h-6 w-6" />
                    {badgeText(badges?.[item.href]) && (
                      <span className="absolute right-2 top-2 inline-flex min-w-5 items-center justify-center rounded-full bg-destructive px-1.5 py-0.5 text-[10px] font-bold leading-none text-destructive-foreground">
                        {badgeText(badges?.[item.href])}
                      </span>
                    )}
                    {item.label}
                  </Link>
                </li>
              );
            })}
          </ul>

          {subItems.length > 0 && (
            <div>
              <p className="mb-1 text-xs font-semibold text-muted-foreground">設定</p>
              <ul className="divide-y rounded-md border">
                {subItems.map((s) => (
                  <li key={s.href}>
                    <Link
                      href={href(s.href)}
                      onClick={() => setOpen(false)}
                      className="flex items-center justify-between gap-2 px-3 py-2.5 text-sm active:bg-muted"
                    >
                      {s.label}
                      <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" />
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}
