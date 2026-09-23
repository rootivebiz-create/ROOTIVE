import Link from "next/link";
import type { ReactNode } from "react";
import { NAV } from "~/components/nav";
import { roleAtLeast, type SessionUser } from "~/server/auth";

const ROLE_LABEL = { owner: "オーナー", staff: "事務", viewer: "閲覧" } as const;

/** 画面の外枠。パソコンは左のメニュー、スマホは上の横スクロールのメニュー */
export function AppShell({ user, children, demo }: { user: SessionUser; children: ReactNode; demo: boolean }) {
  const items = NAV.filter((n) => roleAtLeast(user.role, n.need));
  return (
    <div className="min-h-dvh">
      {demo && (
        <div className="no-print bg-accent px-4 py-2 text-center text-sm font-bold text-accent-foreground">
          デモです（架空の会社・架空のデータ）。あなた専用なので自由に触ってください。24 時間で消えます。{" "}
          <a href="/demo/start" className="underline">
            最初からやり直す
          </a>
        </div>
      )}
      <header className="no-print sticky top-0 z-30 border-b border-border bg-background/95 backdrop-blur">
        <div className="mx-auto flex h-14 max-w-6xl items-center gap-3 px-4">
          <Link href="/" className="flex items-center gap-2 font-bold text-foreground no-underline">
            <span aria-hidden className="inline-flex h-7 min-w-10 items-center justify-center rounded-md border-2 border-plate-foreground bg-plate px-1.5 text-sm leading-none text-plate-foreground">
              締
            </span>
            <span className="whitespace-nowrap text-[15px]">しめ日ラボ</span>
          </Link>
          <div className="ml-auto flex items-center gap-2 text-sm">
            <Link href="/settings/account" className="hidden text-muted-foreground no-underline hover:underline sm:inline" title="自分のアカウント（パスワードを変える）">
              {user.name}（{ROLE_LABEL[user.role]}）
            </Link>
            {!demo && (
              <form action="/logout" method="post">
                <button type="submit" className="min-h-11 rounded-md px-2 text-foreground hover:bg-muted">
                  ログアウト
                </button>
              </form>
            )}
          </div>
        </div>
        <nav aria-label="メニュー" className="no-print border-t border-border md:hidden">
          <ul className="flex gap-1 overflow-x-auto px-2 py-1 text-sm">
            {items.map((n) => (
              <li key={n.href}>
                <Link href={n.href} className="inline-flex min-h-11 items-center whitespace-nowrap rounded-md px-3 text-foreground no-underline hover:bg-muted">
                  {n.short}
                </Link>
              </li>
            ))}
          </ul>
        </nav>
      </header>
      <div className="mx-auto flex max-w-6xl gap-6 px-4">
        <nav aria-label="メニュー" className="no-print hidden w-48 shrink-0 py-6 md:block">
          <ul className="sticky top-20 space-y-1 text-sm">
            {items.map((n) => (
              <li key={n.href}>
                <Link href={n.href} className="flex min-h-11 items-center rounded-md px-3 text-foreground no-underline hover:bg-muted">
                  {n.label}
                </Link>
              </li>
            ))}
          </ul>
        </nav>
        <main id="main" className="min-w-0 flex-1 py-6">
          {children}
        </main>
      </div>
    </div>
  );
}
