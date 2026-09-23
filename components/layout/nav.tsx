"use client";

import { useEffect, useRef, useState } from "react";
import Link, { useLinkStatus } from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { toast } from "sonner";
import * as Popover from "@radix-ui/react-popover";
import {
  Home,
  Inbox,
  ClipboardList,
  Wallet,
  Receipt,
  Coins,
  Banknote,
  Landmark,
  Loader2,
  Briefcase,
  BarChart3,
  PiggyBank,
  Download,
  FolderSearch,
  ClipboardCheck,
  CalendarRange,
  ChevronDown,
  ShieldCheck,
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
  Bell,
  Crown,
  type LucideIcon,
} from "lucide-react";
import { useMonth } from "@/lib/hooks/use-month";
import { visibleForRole } from "@/lib/nav/visibility";
import type { Role } from "@/lib/db/types";
import { cn } from "@/lib/utils";
import { MoreMenu } from "./more-menu";

export interface NavItem {
  href: string;
  label: string;
  icon: LucideIcon;
  /** PC のサイドナビの見出し（同じ見出しが続く項目はひとまとまりに表示する） */
  group?: string;
  /** 代表（owner）だけに出す（画面側は requirePageRole(["owner"]) でも閉じる） */
  ownerOnly?: boolean;
  /** 登録・編集ができる人（owner・admin）だけに出す（画面側も requirePageRole で閉じる） */
  adminOnly?: boolean;
}

/** 未読・未対応の件数（href をキーにした数。0 は出さない） */
export type NavBadges = Record<string, number>;

/** PC のサイドナビ（24 項目。group ごとに見出しを付けて表示する。「代表」は owner、「事務」は owner・admin だけ） */
export const MAIN_NAV: NavItem[] = [
  { href: "/executive", label: "代表", icon: Crown, group: "代表", ownerOnly: true },
  { href: "/dashboard", label: "ホーム", icon: Home },
  { href: "/office", label: "事務", icon: Inbox, adminOnly: true },
  { href: "/dispatch", label: "配車", icon: CalendarRange, group: "入力" },
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
  { href: "/compliance", label: "法令対応", icon: ShieldCheck, group: "管理" },
  { href: "/hr", label: "採用と契約", icon: UserPlus, group: "管理" },
  { href: "/records", label: "書類の検索", icon: FolderSearch, group: "管理" },
  { href: "/exports", label: "出力", icon: Download, group: "管理" },
  { href: "/ai", label: "AI 相談", icon: Sparkles, group: "相談" },
  { href: "/chat", label: "チャット", icon: MessagesSquare, group: "相談" },
  { href: "/settings", label: "設定", icon: Settings },
];

/** スマホの下タブに直接出す項目（5 つ目は「メニュー」）。最初に開く画面が「事務」の人は先頭が事務になる */
export const BOTTOM_NAV_HREFS = ["/dashboard", "/entries", "/payouts", "/invoices"];

/** 最初に開く画面（profiles.start_page）。lib/schemas/office.ts の StartPage と同じ */
export type NavStartPage = "dashboard" | "office";

/** 下タブの並び（最初に開く画面が事務なら、ホームの代わりに事務を先頭に置く） */
export function bottomHrefsFor(startPage?: NavStartPage): string[] {
  return startPage === "office" ? ["/office", ...BOTTOM_NAV_HREFS.slice(1)] : BOTTOM_NAV_HREFS;
}

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
  { href: "/driver/schedule", label: "予定", icon: CalendarRange },
  { href: "/driver", label: "支払明細", icon: FileText },
  { href: "/driver/account", label: "アカウント", icon: UserCircle },
];

export type NavVariant = "staff" | "driver";

/**
 * Server Component からは関数（アイコン）を渡せないため、種別の文字列で選ぶ。
 * role を渡すと ownerOnly の項目を出し分ける（省略したときは今までどおり全部返す）
 */
export function navItemsFor(variant: NavVariant | undefined, role?: Role): NavItem[] {
  return visibleForRole(variant === "driver" ? DRIVER_NAV : MAIN_NAV, role);
}

/** スマホの下タブに出すリンク（ドライバーはメニュー無しで全項目） */
export function bottomItemsFor(variant: NavVariant | undefined, role?: Role, startPage?: NavStartPage): NavItem[] {
  if (variant === "driver") return visibleForRole(DRIVER_NAV, role);
  const hrefs = bottomHrefsFor(startPage);
  const items = hrefs.map((h) => MAIN_NAV.find((i) => i.href === h)).filter((i): i is NavItem => Boolean(i));
  const visible = visibleForRole(items, role);
  // 事務を使えないロール（閲覧者）には、いつもの 4 つを出す
  return visible.length === hrefs.length ? visible : visibleForRole(BOTTOM_NAV, role);
}

/** スマホの「メニュー」シートに出す項目（下タブに入らない残り。代表・事務はここに入る） */
export function moreItemsFor(role?: Role, startPage?: NavStartPage): NavItem[] {
  const bottom = new Set(bottomItemsFor("staff", role, startPage).map((i) => i.href));
  return visibleForRole(MAIN_NAV.filter((i) => !bottom.has(i.href)), role);
}

/* ------------------------------------------------------------------ *
 * サイドナビのまとまり（見出しごとに畳める）
 * ------------------------------------------------------------------ */

export interface NavGroup {
  /** 見出し（「入力」など）。見出しの無い項目（ホーム・設定）は undefined */
  group?: string;
  items: NavItem[];
}

/** 項目を見出しごとにまとめる（並びは変えない。純関数） */
export function groupNavItems(items: readonly NavItem[]): NavGroup[] {
  const out: NavGroup[] = [];
  for (const item of items) {
    const last = out[out.length - 1];
    if (last && last.group === item.group) last.items.push(item);
    else out.push({ group: item.group, items: [item] });
  }
  return out;
}

/**
 * その見出しを開いて見せるか（純関数）。
 * - 見出しが無いまとまり（ホーム・設定）は常に開く
 * - 畳んでいても、**いま開いている画面が入っていれば開く**（自分の居場所を見失わないため）
 */
export function isGroupOpen(g: NavGroup, collapsed: readonly string[], activeHref?: string): boolean {
  if (!g.group) return true;
  if (!collapsed.includes(g.group)) return true;
  return activeHref != null && g.items.some((i) => i.href === activeHref);
}

/** 畳む・開くを切り替える（純関数。並びは見出しの名前順で安定させる） */
export function toggleNavGroup(collapsed: readonly string[], group: string): string[] {
  const set = new Set(collapsed);
  if (set.has(group)) set.delete(group);
  else set.add(group);
  return [...set].sort();
}

/** 端末に覚えておくときのキー（会社ではなく端末ごと） */
export const NAV_COLLAPSED_KEY = "rootive.nav.collapsed";

/** localStorage から読む（使えない端末・壊れた値では「全部開く」に倒す） */
export function readCollapsedGroups(raw: string | null | undefined): string[] {
  if (!raw) return [];
  try {
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((v): v is string => typeof v === "string") : [];
  } catch {
    return [];
  }
}

/** 未読・未対応の件数バッジ（99 を超えたら 99+） */
export function badgeText(count: number | undefined): string | null {
  if (!count || count <= 0) return null;
  return count > 99 ? "99+" : String(count);
}

/**
 * 押した瞬間に「効いた」と分かるようにする（Link の中でだけ使える）。
 *
 * サーバーの応答を待っているあいだ、押した項目を選択中の見た目にして
 * アイコンをくるくるに差し替える。タップの空振り感をなくすのが目的。
 */
function usePending(): boolean {
  const { pending } = useLinkStatus();
  return pending;
}

/** 押しているあいだだけ出るくるくる（アイコンと同じ大きさ） */
function NavPendingIcon({ icon: Icon, className }: { icon: LucideIcon; className?: string }) {
  const pending = usePending();
  if (pending) return <Loader2 className={cn(className, "animate-spin")} aria-hidden />;
  return <Icon className={className} />;
}

/** 下タブ：押しているあいだ、その項目に色を付ける（押した場所で反応が返る） */
function NavPendingTab() {
  const pending = usePending();
  if (!pending) return null;
  return <span className="pointer-events-none absolute inset-x-2 top-0 h-0.5 rounded-full bg-primary" aria-hidden />;
}

/** 押しているあいだ、その項目を選択中の見た目にする */
function NavPendingHighlight({ className }: { className: string }) {
  const pending = usePending();
  if (!pending) return null;
  return <span className={cn("pointer-events-none absolute inset-0 -z-10 rounded-md", className)} aria-hidden />;
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
  role,
  startPage,
}: {
  variant?: NavVariant;
  sub?: { parent: string; items: { href: string; label: string }[] };
  badges?: NavBadges;
  role?: Role;
  startPage?: NavStartPage;
}) {
  const isDriver = variant === "driver";
  const all = navItemsFor(variant, role);
  const items = bottomItemsFor(variant, role, startPage);
  const more = isDriver ? [] : moreItemsFor(role, startPage);
  const pathname = usePathname();
  const { href } = useMonth();
  const columns = items.length + (isDriver ? 0 : 1);
  const moreActive = more.some((i) => isActive(pathname, i.href, all));
  const moreCount = more.reduce((sum, i) => sum + (badges?.[i.href] ?? 0), 0);
  return (
    <nav className="fixed inset-x-0 bottom-0 z-40 border-t bg-card/95 backdrop-blur md:hidden pb-safe no-print" aria-label="メインナビゲーション">
      <ul className="grid" style={{ gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))` }}>
        {items.map((item) => {
          const active = isActive(pathname, item.href, all);
          return (
            <li key={item.href}>
              <Link
                href={href(item.href)}
                className={cn(
                  "relative flex flex-col items-center gap-0.5 py-2 text-[11px] transition-colors active:bg-muted",
                  active ? "text-primary" : "text-muted-foreground",
                )}
                aria-current={active ? "page" : undefined}
              >
                <NavPendingTab />
                <NavPendingIcon icon={item.icon} className="h-5 w-5" />
                <NavBadge count={badges?.[item.href]} className="absolute right-[22%] top-1" />
                {item.label}
              </Link>
            </li>
          );
        })}
        {!isDriver && (
          <li>
            <MoreMenu items={more} sub={sub} active={moreActive} badges={badges} count={moreCount} />
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
  role,
}: {
  variant?: NavVariant;
  sub?: { parent: string; items: { href: string; label: string }[] };
  badges?: NavBadges;
  role?: Role;
}) {
  const items = navItemsFor(variant, role);
  const pathname = usePathname();
  const { href } = useMonth();
  // 畳んだ見出しは端末ごとに覚える（既定はすべて開いたまま。使えない端末でも普通に動く）
  const [collapsed, setCollapsed] = useState<string[]>([]);
  useEffect(() => {
    try {
      setCollapsed(readCollapsedGroups(window.localStorage.getItem(NAV_COLLAPSED_KEY)));
    } catch {
      /* 使えない端末（プライベートモードなど）では全部開いたままでよい */
    }
  }, []);
  const toggle = (group: string) => {
    const next = toggleNavGroup(collapsed, group);
    setCollapsed(next);
    try {
      window.localStorage.setItem(NAV_COLLAPSED_KEY, JSON.stringify(next));
    } catch {
      /* 覚えられなくても畳めること自体は成立させる */
    }
  };

  const activeItem = items.find((i) => isActive(pathname, i.href, items));
  const groups = groupNavItems(items);

  return (
    <nav className="hidden w-56 shrink-0 flex-col gap-0.5 border-r bg-card p-3 md:flex no-print" aria-label="メインナビゲーション">
      {groups.map((g) => {
        const open = isGroupOpen(g, collapsed, activeItem?.href);
        return (
          <div key={g.group ?? g.items[0].href} className={cn(g.group && "pt-2")}>
            {g.group && (
              <button
                type="button"
                onClick={() => toggle(g.group as string)}
                aria-expanded={open}
                className="flex w-full items-center gap-1 rounded px-3 pb-1 text-left text-[11px] font-semibold text-muted-foreground hover:text-foreground"
              >
                <ChevronDown className={cn("h-3 w-3 shrink-0 transition-transform", !open && "-rotate-90")} aria-hidden />
                <span className="truncate">{g.group}</span>
                {!open && <span className="ml-auto tabular-nums">{g.items.length}</span>}
              </button>
            )}
            {open &&
              g.items.map((item) => {
                const active = isActive(pathname, item.href, items);
                return (
                  <div key={item.href}>
                    <Link
                      href={href(item.href)}
                      className={cn(
                        "relative isolate flex items-center gap-2 rounded-md px-3 py-2 text-sm font-medium transition-colors active:bg-muted",
                        active ? "bg-accent text-accent-foreground" : "hover:bg-muted",
                      )}
                      aria-current={active ? "page" : undefined}
                    >
                      <NavPendingHighlight className="bg-accent" />
                      <NavPendingIcon icon={item.icon} className="h-4 w-4 shrink-0" />
                      <span className="truncate">{item.label}</span>
                      <NavBadge count={badges?.[item.href]} className="ml-auto" />
                    </Link>
                    {sub && sub.parent === item.href && active && (
                      <ul className="ml-6 mt-1 flex flex-col gap-0.5 border-l pl-2">
                        {sub.items.map((s) => (
                          <li key={s.href}>
                            <Link
                              href={href(s.href)}
                              className={cn(
                                "block rounded px-2 py-1 text-sm",
                                isActive(pathname, s.href) ? "font-semibold text-primary" : "text-muted-foreground hover:text-foreground",
                              )}
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
          </div>
        );
      })}
    </nav>
  );
}

/** ヘッダーのベルに出す 1 行 */
export interface NotificationRow {
  href: string;
  label: string;
  count: number;
}

/**
 * ベルにまとめて出す未対応の件数（純関数）。
 * 材料はナビのバッジ（href をキーにした件数）だけで、新しい問い合わせはしない。
 * 「決裁待ち」は代表のときだけ（件数は /executive のバッジとして渡ってくる）。0 件の行は出さない。
 */
export function notificationRows(badges: NavBadges | undefined, role?: Role): NotificationRow[] {
  const rows: NotificationRow[] = [
    { href: "/alerts", label: "気になること", count: badges?.["/alerts"] ?? 0 },
    { href: "/chat", label: "未読のチャット", count: badges?.["/chat"] ?? 0 },
  ];
  if (role === "owner") rows.push({ href: "/executive/approvals", label: "決裁待ち", count: badges?.["/executive"] ?? 0 });
  // 0026：事務の承認待ち（稼働報告 ＋ 休み希望）。登録・編集ができる人だけ
  if (role === "owner" || role === "admin") rows.push({ href: "/office", label: "事務の承認待ち", count: badges?.["/office"] ?? 0 });
  return rows.filter((r) => r.count > 0);
}

/** 何秒おきに件数を見に行くか（タブに戻ったときにも見に行く） */
const BADGE_POLL_MS = 60 * 1000;

/**
 * ヘッダーのベル（未対応の件数をまとめて出す。スマホでも押せるよう 44px 角）
 *
 * サーバーが描いた件数から始めて、そのあとは `/api/nav-badges` を定期的に見る。
 * 画面を開いたままでも数が増え、未読のチャットが増えたらその場で知らせる。
 */
export function NotificationBell({ badges, role }: { badges?: NavBadges; role?: Role }) {
  const [open, setOpen] = useState(false);
  const { href } = useMonth();
  const router = useRouter();
  const [live, setLive] = useState<NavBadges | undefined>(badges);
  const lastChat = useRef<number>(badges?.["/chat"] ?? 0);
  const lastOffice = useRef<number>(badges?.["/office"] ?? 0);

  // サーバーが描き直したら、そちらを正とする
  useEffect(() => {
    setLive(badges);
    lastChat.current = badges?.["/chat"] ?? 0;
    lastOffice.current = badges?.["/office"] ?? 0;
  }, [badges]);

  useEffect(() => {
    let stopped = false;
    const check = async () => {
      // 見えていないタブでは問い合わせない（戻ってきたときに visibilitychange で見に行く）
      if (document.visibilityState !== "visible") return;
      try {
        const res = await fetch("/api/nav-badges", { cache: "no-store" });
        if (!res.ok || stopped) return;
        const json = (await res.json()) as { alerts?: number; chat?: number; approvals?: number; office?: number };
        const next: NavBadges = {
          "/alerts": Number(json.alerts ?? 0),
          "/chat": Number(json.chat ?? 0),
          "/executive": Number(json.approvals ?? 0),
          "/office": Number(json.office ?? 0),
        };
        setLive(next);
        const chat = next["/chat"] ?? 0;
        if (chat > lastChat.current) {
          toast("新しいメッセージがあります", {
            description: `未読 ${chat} 件`,
            action: { label: "開く", onClick: () => router.push(href("/chat")) },
          });
        }
        lastChat.current = chat;
        // 事務：稼働報告や休み希望が届いたら知らせる（RPC は admin 以上にしか数を返さない）
        const office = next["/office"] ?? 0;
        if (office > lastOffice.current) {
          toast("承認待ちが届きました", {
            description: `事務の承認待ち ${office} 件`,
            action: { label: "開く", onClick: () => router.push("/office") },
          });
        }
        lastOffice.current = office;
      } catch {
        // 電波が無いときは黙って次の機会を待つ
      }
    };
    const onVisible = () => {
      if (document.visibilityState === "visible") void check();
    };
    const id = window.setInterval(check, BADGE_POLL_MS);
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      stopped = true;
      window.clearInterval(id);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [href, router]);

  const rows = notificationRows(live, role);
  const total = rows.reduce((sum, r) => sum + r.count, 0);
  return (
    <Popover.Root open={open} onOpenChange={setOpen}>
      <Popover.Trigger asChild>
        <button
          type="button"
          aria-label={total > 0 ? `お知らせ ${badgeText(total)} 件` : "お知らせ"}
          className="relative flex h-11 w-11 shrink-0 items-center justify-center rounded-md text-muted-foreground hover:bg-muted no-print"
        >
          <Bell className="h-5 w-5" />
          <NavBadge count={total} className="absolute right-1 top-1.5" />
        </button>
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content align="end" sideOffset={6} className="z-50 w-64 rounded-md border bg-card p-1 shadow-lg no-print">
          <p className="px-2 py-1.5 text-xs font-semibold text-muted-foreground">お知らせ</p>
          {rows.length === 0 ? (
            <p className="px-2 pb-3 pt-1 text-sm text-muted-foreground">いまは何もありません</p>
          ) : (
            <ul>
              {rows.map((row) => (
                <li key={row.href}>
                  <Link
                    href={href(row.href)}
                    onClick={() => setOpen(false)}
                    className="flex min-h-11 items-center justify-between gap-2 rounded px-2 py-2 text-sm hover:bg-muted"
                  >
                    <span className="truncate">{row.label}</span>
                    <NavBadge count={row.count} />
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}
