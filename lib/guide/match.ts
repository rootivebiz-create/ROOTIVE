/**
 * いま開いている画面のガイドを探す（純関数）。
 * パスの前方一致で、いちばん長く当たるものを選ぶ（"/payouts/transfer" は "/payouts" より優先）。
 * ロールで見られない画面のガイドは返さない。
 */
import type { Role } from "@/lib/db/types";
import { isVisibleForRole } from "@/lib/nav/visibility";
import type { FaqItem, OverviewSection, PageGuide } from "./types";

/** "/payouts?m=2026-08#x" → "/payouts" */
export function normalizePath(path: string): string {
  const p = (path || "/").split(/[?#]/)[0] || "/";
  return p.length > 1 ? p.replace(/\/+$/, "") : p;
}

function matches(path: string, href: string): boolean {
  return path === href || path.startsWith(`${href}/`);
}

/** 見られる画面のガイドだけ（ドライバーはポータルのガイドだけ） */
export function guidesForRole(guides: readonly PageGuide[], role?: Role): PageGuide[] {
  if (role === "driver") return guides.filter((g) => g.driver);
  return guides.filter((g) => !g.driver && isVisibleForRole(g, role));
}

export function guideForPath(guides: readonly PageGuide[], path: string, role?: Role): PageGuide | null {
  const p = normalizePath(path);
  let best: PageGuide | null = null;
  for (const g of guidesForRole(guides, role)) {
    if (!matches(p, g.href)) continue;
    if (!best || g.href.length > best.href.length) best = g;
  }
  return best;
}

export function sectionsForRole(sections: readonly OverviewSection[], role?: Role): OverviewSection[] {
  return sections.filter((s) => !s.roles || (role != null && s.roles.includes(role)));
}

export function faqForRole(items: readonly FaqItem[], role?: Role): FaqItem[] {
  return items.filter((f) => !f.roles || (role != null && f.roles.includes(role)));
}

/** ロールごとの注意（無ければ空） */
export function roleNoteFor(guide: PageGuide, role?: Role): string {
  return (role && guide.roleNotes?.[role]) || "";
}
