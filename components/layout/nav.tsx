"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Home, ClipboardList, Wallet, Briefcase, Settings, FileText, UserCircle, type LucideIcon } from "lucide-react";
import { useMonth } from "@/lib/hooks/use-month";
import { cn } from "@/lib/utils";

export interface NavItem {
  href: string;
  label: string;
  icon: LucideIcon;
}

export const MAIN_NAV: NavItem[] = [
  { href: "/dashboard", label: "ホーム", icon: Home },
  { href: "/entries", label: "稼働", icon: ClipboardList },
  { href: "/payouts", label: "支払", icon: Wallet },
  { href: "/projects", label: "案件", icon: Briefcase },
  { href: "/settings", label: "設定", icon: Settings },
];

/** ドライバーポータル用 */
export const DRIVER_NAV: NavItem[] = [
  { href: "/driver", label: "支払明細", icon: FileText },
  { href: "/driver/account", label: "アカウント", icon: UserCircle },
];

export type NavVariant = "staff" | "driver";

/** Server Component からは関数（アイコン）を渡せないため、種別の文字列で選ぶ */
export function navItemsFor(variant: NavVariant | undefined): NavItem[] {
  return variant === "driver" ? DRIVER_NAV : MAIN_NAV;
}

/** 現在のパスがナビ項目に該当するか。他の項目がより具体的に一致する場合（例: /driver と /driver/account）はそちらを優先 */
function isActive(pathname: string, href: string, items: { href: string }[] = []) {
  if (pathname === href) return true;
  if (!pathname.startsWith(href + "/")) return false;
  return !items.some((o) => o.href !== href && o.href.startsWith(href + "/") && (pathname === o.href || pathname.startsWith(o.href + "/")));
}

/** スマホ用 下タブナビ */
export function BottomTabs({ variant }: { variant?: NavVariant }) {
  const items = navItemsFor(variant);
  const pathname = usePathname();
  const { href } = useMonth();
  return (
    <nav className="fixed inset-x-0 bottom-0 z-40 border-t bg-card/95 backdrop-blur md:hidden pb-safe no-print" aria-label="メインナビゲーション">
      <ul className="grid" style={{ gridTemplateColumns: `repeat(${items.length}, minmax(0, 1fr))` }}>
        {items.map((item) => {
          const active = isActive(pathname, item.href, items);
          return (
            <li key={item.href}>
              <Link
                href={href(item.href)}
                className={cn("flex flex-col items-center gap-0.5 py-2 text-[11px]", active ? "text-primary" : "text-muted-foreground")}
                aria-current={active ? "page" : undefined}
              >
                <item.icon className="h-5 w-5" />
                {item.label}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}

/** PC 用 サイドナビ */
export function SideNav({ variant, sub }: { variant?: NavVariant; sub?: { parent: string; items: { href: string; label: string }[] } }) {
  const items = navItemsFor(variant);
  const pathname = usePathname();
  const { href } = useMonth();
  return (
    <nav className="hidden w-56 shrink-0 flex-col gap-1 border-r bg-card p-3 md:flex no-print" aria-label="メインナビゲーション">
      {items.map((item) => {
        const active = isActive(pathname, item.href, items);
        return (
          <div key={item.href}>
            <Link
              href={href(item.href)}
              className={cn("flex items-center gap-2 rounded-md px-3 py-2 text-sm font-medium", active ? "bg-accent text-accent-foreground" : "hover:bg-muted")}
              aria-current={active ? "page" : undefined}
            >
              <item.icon className="h-4 w-4" />
              {item.label}
            </Link>
            {sub && sub.parent === item.href && active && (
              <ul className="ml-6 mt-1 flex flex-col gap-0.5 border-l pl-2">
                {sub.items.map((s) => (
                  <li key={s.href}>
                    <Link
                      href={href(s.href)}
                      className={cn("block rounded px-2 py-1 text-sm", isActive(pathname, s.href) ? "font-semibold text-primary" : "text-muted-foreground hover:text-foreground")}
                    >
                      {s.label}
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </div>
        );
      })}
    </nav>
  );
}
