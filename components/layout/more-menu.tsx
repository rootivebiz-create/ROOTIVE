"use client";

import { useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { ChevronRight, Menu, Search } from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useMonth } from "@/lib/hooks/use-month";
import { cn } from "@/lib/utils";
import { openCommandPalette } from "./command-palette";
import type { NavItem } from "./nav";

/**
 * スマホの下タブの 5 つ目「メニュー」。
 * 下から出るシート（components/ui/dialog.tsx はスマホで全幅シートになる）に
 * 下タブに入りきらない画面・設定のサブ項目・検索（コマンドパレット）を並べる。
 */
export function MoreMenu({
  items,
  sub,
  active,
}: {
  items: NavItem[];
  sub?: { parent: string; items: { href: string; label: string }[] };
  active?: boolean;
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
        className={cn("flex w-full flex-col items-center gap-0.5 py-2 text-[11px]", active ? "text-primary" : "text-muted-foreground")}
      >
        <Menu className="h-5 w-5" />
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

          <ul className="grid grid-cols-2 gap-2">
            {items.map((item) => {
              const isCurrent = pathname === item.href || pathname.startsWith(item.href + "/");
              return (
                <li key={item.href}>
                  <Link
                    href={href(item.href)}
                    onClick={() => setOpen(false)}
                    className={cn(
                      "flex h-20 flex-col items-center justify-center gap-1 rounded-lg border text-sm font-medium",
                      isCurrent ? "border-primary bg-accent text-accent-foreground" : "hover:bg-muted",
                    )}
                    aria-current={isCurrent ? "page" : undefined}
                  >
                    <item.icon className="h-6 w-6" />
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
