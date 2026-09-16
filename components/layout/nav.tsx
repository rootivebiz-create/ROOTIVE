"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Home, ClipboardList, Wallet, Briefcase, Settings, type LucideIcon } from "lucide-react";
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

function isActive(pathname: string, href: string) {
  return pathname === href || pathname.startsWith(href + "/");
}

/** スマホ用 下タブナビ */
export function BottomTabs({ items = MAIN_NAV }: { items?: NavItem[] }) {
  const pathname = usePathname();
  const { href } = useMonth();
  return (
    <nav className="fixed inset-x-0 bottom-0 z-40 border-t bg-card/95 backdrop-blur md:hidden pb-safe no-print" aria-label="メインナビゲーション">
      <ul className="grid grid-cols-5">
        {items.map((item) => {
          const active = isActive(pathname, item.href);
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
export function SideNav({ items = MAIN_NAV, sub }: { items?: NavItem[]; sub?: { parent: string; items: { href: string; label: string }[] } }) {
  const pathname = usePathname();
  const { href } = useMonth();
  return (
    <nav className="hidden w-56 shrink-0 flex-col gap-1 border-r bg-card p-3 md:flex no-print" aria-label="メインナビゲーション">
      {items.map((item) => {
        const active = isActive(pathname, item.href);
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
