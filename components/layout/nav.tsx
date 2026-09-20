"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  Home,
  ClipboardList,
  Wallet,
  Receipt,
  Coins,
  Banknote,
  Landmark,
  Briefcase,
  BarChart3,
  PiggyBank,
  Download,
  FolderSearch,
  ClipboardCheck,
  Truck,
  UserPlus,
  FileUp,
  TriangleAlert,
  Sparkles,
  MessagesSquare,
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
  /** PC のサイドナビの見出し（同じ見出しが続く項目はひとまとまりに表示する） */
  group?: string;
}

/** 未読・未対応の件数（href をキーにした数。0 は出さない） */
export type NavBadges = Record<string, number>;

/** PC のサイドナビ（20 項目。group ごとに見出しを付けて表示する） */
export const MAIN_NAV: NavItem[] = [
  { href: "/dashboard", label: "ホーム", icon: Home },
  { href: "/entries", label: "稼働", icon: ClipboardList, group: "入力" },
  { href: "/daily", label: "日報・点呼", icon: ClipboardCheck, group: "入力" },
  { href: "/intake", label: "取り込み", icon: FileUp, group: "入力" },
  { href: "/payouts", label: "支払", icon: Wallet, group: "入力" },
  { href: "/invoices", label: "請求", icon: Receipt, group: "入力" },
  { href: "/expenses", label: "経費", icon: Coins, group: "入力" },
  { href: "/bank", label: "入金", icon: Banknote, group: "入力" },
  { href: "/cashflow", label: "資金繰り", icon: Landmark, group: "経営" },
  { href: "/projects", label: "案件", icon: Briefcase, group: "経営" },
  { href: "/finance", label: "財務", icon: PiggyBank, group: "経営" },
  { href: "/reports", label: "レポート", icon: BarChart3, group: "経営" },
  { href: "/alerts", label: "気になること", icon: TriangleAlert, group: "経営" },
  { href: "/fleet", label: "車両と書類", icon: Truck, group: "管理" },
  { href: "/hr", label: "採用と契約", icon: UserPlus, group: "管理" },
  { href: "/records", label: "書類の検索", icon: FolderSearch, group: "管理" },
  { href: "/exports", label: "出力", icon: Download, group: "管理" },
  { href: "/ai", label: "AI 相談", icon: Sparkles, group: "相談" },
  { href: "/chat", label: "チャット", icon: MessagesSquare, group: "相談" },
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

/** ドライバーポータル用（毎日の入口である「今日の報告」を先頭に置く） */
export const DRIVER_NAV: NavItem[] = [
  { href: "/driver/today", label: "今日の報告", icon: ClipboardCheck },
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

/** 未読・未対応の件数バッジ（99 を超えたら 99+） */
export function badgeText(count: number | undefined): string | null {
  if (!count || count <= 0) return null;
  return count > 99 ? "99+" : String(count);
}

function NavBadge({ count, className }: { count?: number; className?: string }) {
  const text = badgeText(count);
  if (!text) return null;
  return (
    <span
      className={cn("inline-flex min-w-5 items-center justify-center rounded-full bg-destructive px-1.5 py-0.5 text-[10px] font-bold leading-none text-destructive-foreground", className)}
      aria-label={`${text} 件`}
    >
      {text}
    </span>
  );
}

/** 現在のパスがナビ項目に該当するか。他の項目がより具体的に一致する場合（例: /driver と /driver/account）はそちらを優先 */
function isActive(pathname: string, href: string, items: { href: string }[] = []) {
  if (pathname === href) return true;
  if (!pathname.startsWith(href + "/")) return false;
  return !items.some((o) => o.href !== href && o.href.startsWith(href + "/") && (pathname === o.href || pathname.startsWith(o.href + "/")));
}

/** スマホ用 下タブナビ（スタッフ：4 項目 ＋ メニュー、ドライバー：2 項目） */
export function BottomTabs({
  variant,
  sub,
  badges,
}: {
  variant?: NavVariant;
  sub?: { parent: string; items: { href: string; label: string }[] };
  badges?: NavBadges;
}) {
  const isDriver = variant === "driver";
  const all = navItemsFor(variant);
  const items = bottomItemsFor(variant);
  const pathname = usePathname();
  const { href } = useMonth();
  const columns = items.length + (isDriver ? 0 : 1);
  const moreActive = !isDriver && MORE_NAV.some((i) => isActive(pathname, i.href, all));
  const moreCount = isDriver ? 0 : MORE_NAV.reduce((sum, i) => sum + (badges?.[i.href] ?? 0), 0);
  return (
    <nav className="fixed inset-x-0 bottom-0 z-40 border-t bg-card/95 backdrop-blur md:hidden pb-safe no-print" aria-label="メインナビゲーション">
      <ul className="grid" style={{ gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))` }}>
        {items.map((item) => {
          const active = isActive(pathname, item.href, all);
          return (
            <li key={item.href}>
              <Link
                href={href(item.href)}
                className={cn("relative flex flex-col items-center gap-0.5 py-2 text-[11px]", active ? "text-primary" : "text-muted-foreground")}
                aria-current={active ? "page" : undefined}
              >
                <item.icon className="h-5 w-5" />
                <NavBadge count={badges?.[item.href]} className="absolute right-[22%] top-1" />
                {item.label}
              </Link>
            </li>
          );
        })}
        {!isDriver && (
          <li>
            <MoreMenu items={MORE_NAV} sub={sub} active={moreActive} badges={badges} count={moreCount} />
          </li>
        )}
      </ul>
    </nav>
  );
}

/** PC 用 サイドナビ */
export function SideNav({
  variant,
  sub,
  badges,
}: {
  variant?: NavVariant;
  sub?: { parent: string; items: { href: string; label: string }[] };
  badges?: NavBadges;
}) {
  const items = navItemsFor(variant);
  const pathname = usePathname();
  const { href } = useMonth();
  return (
    <nav className="hidden w-56 shrink-0 flex-col gap-0.5 border-r bg-card p-3 md:flex no-print" aria-label="メインナビゲーション">
      {items.map((item, index) => {
        const active = isActive(pathname, item.href, items);
        const newGroup = item.group && item.group !== items[index - 1]?.group;
        return (
          <div key={item.href} className={cn(newGroup && "pt-2")}>
            {newGroup && <p className="px-3 pb-1 text-[11px] font-semibold text-muted-foreground">{item.group}</p>}
            <Link
              href={href(item.href)}
              className={cn("flex items-center gap-2 rounded-md px-3 py-2 text-sm font-medium", active ? "bg-accent text-accent-foreground" : "hover:bg-muted")}
              aria-current={active ? "page" : undefined}
            >
              <item.icon className="h-4 w-4 shrink-0" />
              <span className="truncate">{item.label}</span>
              <NavBadge count={badges?.[item.href]} className="ml-auto" />
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
