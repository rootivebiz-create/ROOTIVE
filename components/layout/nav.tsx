"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  Home,
  ClipboardList,
  Wallet,
  Receipt,
  Coins,
  Briefcase,
  BarChart3,
  Settings,
  FileText,
  UserCircle,
  Menu,
  type LucideIcon,
} from "lucide-react";
import { useMonth } from "@/lib/hooks/use-month";
import { cn } from "@/lib/utils";
import { MoreMenu } from "./more-menu";

export interface NavItem {
  href: string;
  label: string;
  icon: LucideIcon;
}

/** PC のサイドナビ（8 項目） */
export const MAIN_NAV: NavItem[] = [
  { href: "/dashboard", label: "ホーム", icon: Home },
  { href: "/entries", label: "稼働", icon: ClipboardList },
  { href: "/payouts", label: "支払", icon: Wallet },
  { href: "/invoices", label: "請求", icon: Receipt },
  { href: "/expenses", label: "経費", icon: Coins },
  { href: "/projects", label: "案件", icon: Briefcase },
  { href: "/reports", label: "レポート", icon: BarChart3 },
  { href: "/settings", label: "設定", icon: Settings },
];

/** スマホの下タブに直接出す項目（5 つ目は「メニュー」） */
export const BOTTOM_NAV_HREFS = ["/dashboard", "/entries", "/payouts", "/invoices"];

/** スマホの下タブ（4 項目）。5 つ目の「メニュー」は MENU_TAB */
export const BOTTOM_NAV: NavItem[] = MAIN_NAV.filter((i) => BOTTOM_NAV_HREFS.includes(i.href));

/** スマホの「メニュー」シートに入れる残りの項目 */
export const MORE_NAV: NavItem[] = MAIN_NAV.filter((i) => !BOTTOM_NAV_HREFS.includes(i.href));

/** スマホの下タブの 5 つ目 */
export const MENU_TAB = { label: "メニュー", icon: Menu } as const;

/** スマホの下タブの上限（ホーム・稼働・支払・請求・メニュー） */
export const BOTTOM_TABS_MAX = 5;

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

/** スマホの下タブに出すリンク（ドライバーはメニュー無しで全項目） */
export function bottomItemsFor(variant: NavVariant | undefined): NavItem[] {
  return variant === "driver" ? DRIVER_NAV : BOTTOM_NAV;
}

/** 現在のパスがナビ項目に該当するか。他の項目がより具体的に一致する場合（例: /driver と /driver/account）はそちらを優先 */
function isActive(pathname: string, href: string, items: { href: string }[] = []) {
  if (pathname === href) return true;
  if (!pathname.startsWith(href + "/")) return false;
  return !items.some((o) => o.href !== href && o.href.startsWith(href + "/") && (pathname === o.href || pathname.startsWith(o.href + "/")));
}

/** スマホ用 下タブナビ（スタッフ：4 項目 ＋ メニュー、ドライバー：2 項目） */
export function BottomTabs({ variant, sub }: { variant?: NavVariant; sub?: { parent: string; items: { href: string; label: string }[] } }) {
  const isDriver = variant === "driver";
  const all = navItemsFor(variant);
  const items = bottomItemsFor(variant);
  const pathname = usePathname();
  const { href } = useMonth();
  const columns = items.length + (isDriver ? 0 : 1);
  const moreActive = !isDriver && MORE_NAV.some((i) => isActive(pathname, i.href, all));
  return (
    <nav className="fixed inset-x-0 bottom-0 z-40 border-t bg-card/95 backdrop-blur md:hidden pb-safe no-print" aria-label="メインナビゲーション">
      <ul className="grid" style={{ gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))` }}>
        {items.map((item) => {
          const active = isActive(pathname, item.href, all);
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
        {!isDriver && (
          <li>
            <MoreMenu items={MORE_NAV} sub={sub} active={moreActive} />
          </li>
        )}
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
