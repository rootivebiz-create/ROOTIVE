import { Suspense } from "react";
import Link from "next/link";
import { BottomTabs, SideNav, type NavItem } from "./nav";
import { MonthSelector, type MonthOption } from "./month-selector";
import { UserMenu } from "./user-menu";
import type { Role } from "@/lib/db/types";

export function AppShell({
  companyName,
  displayName,
  email,
  role,
  months,
  navItems,
  subNav,
  showMonthSelector = true,
  homeHref = "/dashboard",
  children,
}: {
  companyName: string;
  displayName: string;
  email: string;
  role: Role;
  months: MonthOption[];
  navItems?: NavItem[];
  subNav?: { parent: string; items: { href: string; label: string }[] };
  showMonthSelector?: boolean;
  homeHref?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex min-h-dvh flex-col">
      <header className="sticky top-0 z-40 border-b bg-card/95 backdrop-blur no-print">
        <div className="flex h-14 items-center justify-between gap-2 px-3 md:px-4">
          <Link href={homeHref} className="flex items-center gap-2 font-bold">
            <span className="flex h-7 w-7 items-center justify-center rounded-md bg-primary text-sm text-primary-foreground">R</span>
            <span className="hidden truncate sm:inline">{companyName}</span>
          </Link>
          {showMonthSelector && (
            <Suspense fallback={<div className="h-9 w-40" />}>
              <MonthSelector months={months} />
            </Suspense>
          )}
          <UserMenu displayName={displayName} email={email} role={role} />
        </div>
      </header>
      <div className="flex flex-1">
        <Suspense fallback={<div className="hidden w-56 md:block" />}>
          <SideNav items={navItems} sub={subNav} />
        </Suspense>
        <main className="min-w-0 flex-1 px-4 pb-24 pt-4 md:px-6 md:pb-8">
          <div className="mx-auto w-full max-w-6xl">{children}</div>
        </main>
      </div>
      <Suspense fallback={null}>
        <BottomTabs items={navItems} />
      </Suspense>
    </div>
  );
}
