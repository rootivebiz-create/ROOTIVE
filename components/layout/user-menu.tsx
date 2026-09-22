"use client";

import * as DropdownMenu from "@radix-ui/react-dropdown-menu";
import { useTheme } from "next-themes";
import Link from "next/link";
import { useRef } from "react";
import { LogOut, Moon, Sun, UserCircle, Monitor } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { ROLE_LABELS, type Role } from "@/lib/db/types";
import { clearOutbox } from "@/lib/offline/queue";
import { clearServiceWorkerCache } from "@/lib/offline/register-sw";

/** ログアウトの前に、端末に残っているキャッシュと未送信の控えを消す（失敗してもログアウトは続ける） */
async function signOutCleanup(): Promise<void> {
  try {
    clearServiceWorkerCache();
    await clearOutbox();
  } catch {
    // 消せなくてもログアウトは止めない
  }
}

export function UserMenu({ displayName, email, role, build }: { displayName: string; email: string; role: Role; build?: string }) {
  const { theme, setTheme } = useTheme();
  const signOutForm = useRef<HTMLFormElement>(null);
  return (
    <DropdownMenu.Root>
      <DropdownMenu.Trigger asChild>
        <button type="button" className="flex items-center gap-2 rounded-md px-2 py-1.5 hover:bg-muted" aria-label="ユーザーメニュー">
          <UserCircle className="h-6 w-6" />
          <span className="hidden max-w-[10rem] truncate text-sm font-medium md:inline">{displayName || email}</span>
          <Badge variant="secondary" className="hidden md:inline-flex">
            {ROLE_LABELS[role]}
          </Badge>
        </button>
      </DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        <DropdownMenu.Content align="end" sideOffset={6} className="z-50 min-w-[14rem] rounded-md border bg-card p-1 shadow-lg">
          <div className="px-2 py-1.5">
            <p className="truncate text-sm font-medium">{displayName || "（表示名なし）"}</p>
            <p className="truncate text-xs text-muted-foreground">{email}</p>
            {build && <p className="mt-0.5 truncate text-[11px] text-muted-foreground">版 {build}</p>}
            <Badge variant="secondary" className="mt-1">
              {ROLE_LABELS[role]}
            </Badge>
          </div>
          <DropdownMenu.Separator className="my-1 h-px bg-border" />
          <DropdownMenu.Label className="px-2 py-1 text-xs text-muted-foreground">表示テーマ</DropdownMenu.Label>
          <div className="flex gap-1 px-2 pb-1">
            {(
              [
                ["light", Sun, "ライト"],
                ["dark", Moon, "ダーク"],
                ["system", Monitor, "自動"],
              ] as const
            ).map(([key, Icon, label]) => (
              <button
                key={key}
                type="button"
                onClick={() => setTheme(key)}
                className={`flex flex-1 items-center justify-center gap-1 rounded border px-2 py-1 text-xs ${theme === key ? "bg-accent text-accent-foreground" : "hover:bg-muted"}`}
              >
                <Icon className="h-3.5 w-3.5" />
                {label}
              </button>
            ))}
          </div>
          <DropdownMenu.Separator className="my-1 h-px bg-border" />
          {role !== "driver" && (
            <DropdownMenu.Item asChild>
              <Link href="/settings/account" className="flex cursor-pointer items-center gap-2 rounded px-2 py-1.5 text-sm outline-none hover:bg-muted">
                <UserCircle className="h-4 w-4" /> アカウント
              </Link>
            </DropdownMenu.Item>
          )}
          {role === "driver" && (
            <DropdownMenu.Item asChild>
              <Link href="/driver/account" className="flex cursor-pointer items-center gap-2 rounded px-2 py-1.5 text-sm outline-none hover:bg-muted">
                <UserCircle className="h-4 w-4" /> アカウント
              </Link>
            </DropdownMenu.Item>
          )}
          {/* Radix のメニュー項目は選択時に閉じるため、submit ボタンではなく onSelect でフォームを送信する */}
          <form ref={signOutForm} action="/auth/signout" method="post">
            <DropdownMenu.Item
              className="flex w-full cursor-pointer items-center gap-2 rounded px-2 py-1.5 text-sm outline-none hover:bg-muted data-[highlighted]:bg-muted"
              onSelect={(e) => {
                e.preventDefault();
                // 共有の端末で次の利用者に見えないよう、キャッシュと未送信の控えを消してから出る
                void signOutCleanup().finally(() => signOutForm.current?.requestSubmit());
              }}
            >
              <LogOut className="h-4 w-4" /> ログアウト
            </DropdownMenu.Item>
          </form>
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  );
}
