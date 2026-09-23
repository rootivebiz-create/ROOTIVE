import { Suspense } from "react";
import Link from "next/link";
import { BottomTabs, NotificationBell, SideNav, type NavBadges, type NavStartPage, type NavVariant } from "./nav";
import { CommandPalette, type CommandItem } from "./command-palette";
import { MonthSelector, type MonthOption } from "./month-selector";
import { UserMenu } from "./user-menu";
import { RouteProgress } from "./route-progress";
import { UpdateBanner } from "./update-banner";
import { HelpButton } from "@/components/guide/help-button";
import type { Role } from "@/lib/db/types";

export function AppShell({
  companyName,
  displayName,
  email,
  role,
  months,
  navVariant,
  subNav,
  commandItems,
  badges,
  showMonthSelector = true,
  homeHref,
  startPage,
  build,
  children,
}: {
  companyName: string;
  displayName: string;
  email: string;
  role: Role;
  months: MonthOption[];
  /** ナビの種別（Server Component からアイコン関数を渡せないため文字列で指定） */
  navVariant?: NavVariant;
  subNav?: { parent: string; items: { href: string; label: string }[] };
  /** コマンドパレット（⌘K）の候補。省略すると検索ボタンを出さない */
  commandItems?: CommandItem[];
  /** ナビに出す未読・未対応の件数（href をキーにした数） */
  badges?: NavBadges;
  showMonthSelector?: boolean;
  /** ロゴの行き先（省くと最初に開く画面） */
  homeHref?: string;
  /** 最初に開く画面（事務の人はスマホの下タブの先頭とロゴの行き先が事務になる。0026） */
  startPage?: NavStartPage;
  /** いま配られている版（新しい版が出たら帯で知らせる） */
  build: string;
  children: React.ReactNode;
}) {
  const home = homeHref ?? (startPage === "office" ? "/office" : "/dashboard");
  return (
    <div className="flex min-h-dvh flex-col">
      <Suspense fallback={null}>
        <RouteProgress />
      </Suspense>
      <header className="sticky top-0 z-40 border-b bg-card/95 backdrop-blur no-print">
        {/* 新しい版が出ていたら、ヘッダーの上に帯を出す（ヘッダーごと固定されるので重ならない） */}
        <UpdateBanner build={build} />
        <div className="flex h-14 min-w-0 items-center justify-between gap-1 overflow-hidden px-3 md:gap-2 md:px-4">
          <Link href={home} className="flex shrink-0 items-center gap-2 font-bold">
            <span className="flex h-7 w-7 items-center justify-center rounded-md bg-primary text-sm text-primary-foreground">R</span>
            <span className="hidden truncate sm:inline">{companyName}</span>
          </Link>
          {showMonthSelector && (
            <Suspense fallback={<div className="h-9 w-40" />}>
              <MonthSelector months={months} />
            </Suspense>
          )}
          <div className="flex shrink-0 items-center gap-1">
            {badges && (
              <Suspense fallback={<div className="h-11 w-11" />}>
                <NotificationBell badges={badges} role={role} />
              </Suspense>
            )}
            {commandItems && commandItems.length > 0 && (
              <Suspense fallback={<div className="h-9 w-9" />}>
                <CommandPalette items={commandItems} />
              </Suspense>
            )}
            {/* スマホは幅が足りないので、スタッフは下の「メニュー」から開く（ドライバーはヘッダーに余裕がある） */}
            <Suspense fallback={null}>
              <HelpButton role={role} hideOnMobile={navVariant !== "driver"} />
            </Suspense>
            <UserMenu displayName={displayName} email={email} role={role} build={build} />
          </div>
        </div>
      </header>
      <div className="flex flex-1">
        <Suspense fallback={<div className="hidden w-56 md:block" />}>
          <SideNav variant={navVariant} sub={subNav} badges={badges} role={role} />
        </Suspense>
        <main className="min-w-0 flex-1 px-4 pb-24 pt-4 md:px-6 md:pb-8">
          <div className="mx-auto w-full max-w-6xl">{children}</div>
        </main>
      </div>
      <Suspense fallback={null}>
        <BottomTabs variant={navVariant} sub={subNav} badges={badges} role={role} startPage={startPage} />
      </Suspense>
    </div>
  );
}
