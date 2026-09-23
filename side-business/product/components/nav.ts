/** メニュー（締めの流れの順）。役割が足りない項目は出さない */
import type { Role } from "~/server/auth";

export type NavItem = { href: string; label: string; short: string; need: Role };

export const NAV: NavItem[] = [
  { href: "/", label: "今月の締め", short: "ホーム", need: "viewer" },
  { href: "/import", label: "取り込み", short: "取込", need: "viewer" },
  { href: "/work", label: "稼働と調整", short: "稼働", need: "viewer" },
  { href: "/watch", label: "見張り番", short: "見張り", need: "viewer" },
  { href: "/terms", label: "取引条件の明示", short: "条件", need: "viewer" },
  { href: "/statements", label: "支払明細", short: "明細", need: "viewer" },
  { href: "/close", label: "締め", short: "締め", need: "viewer" },
  { href: "/transfer", label: "振込データ", short: "振込", need: "viewer" },
  { href: "/parallel", label: "Excel と比べる", short: "比較", need: "viewer" },
  { href: "/reconcile", label: "元請との突合", short: "突合", need: "viewer" },
  { href: "/profit", label: "利益", short: "利益", need: "viewer" },
  { href: "/export", label: "会計ソフトへ", short: "会計", need: "staff" },
  { href: "/settings", label: "設定", short: "設定", need: "viewer" },
  { href: "/help", label: "ヘルプ", short: "ヘルプ", need: "viewer" },
];

/** いま開いている画面の項目か（ホームは「/」だけ。ほかはその下の画面も含む。例：/settings/users は「設定」） */
export function isCurrentNav(pathname: string, href: string): boolean {
  if (href === "/") return pathname === "/";
  return pathname === href || pathname.startsWith(`${href}/`);
}
