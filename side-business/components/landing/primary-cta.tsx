/**
 * いちばんしてほしいこと（30分の無料相談）のボタン。どの区切りでも同じ行き先・同じ言葉にする。
 *   予約のページ（NEXT_PUBLIC_BOOKING_URL）があれば、それ（別のタブ）。無ければ /contact のフォーム。
 */
import Link from "next/link";
import type { ReactNode } from "react";
import { cx } from "@/lib/cx";
import { CONTACT } from "@/site.config";
import { ArrowIcon, NewTabNote, ctaClass } from "./section";

export type PrimaryAction = { href: string; label: string; external: boolean };

/** 相談のボタンの行き先と言葉 */
export function primaryAction(bookingUrl: string | null = CONTACT.bookingUrl): PrimaryAction {
  return bookingUrl
    ? { href: bookingUrl, label: "30分の無料相談を予約する", external: true }
    : { href: "/contact", label: "30分の無料相談を申し込む", external: false };
}

export function PrimaryCta({
  bookingUrl = CONTACT.bookingUrl,
  label,
  className,
}: {
  bookingUrl?: string | null;
  /** 言葉を変えたいとき（行き先は変えない） */
  label?: string;
  className?: string;
}) {
  const a = primaryAction(bookingUrl);
  const cls = ctaClass("accent", cx("w-full px-5 text-base sm:w-auto", className));
  if (a.external) {
    return (
      <a href={a.href} target="_blank" rel="noopener noreferrer" className={cls}>
        {label ?? a.label}
        <NewTabNote />
      </a>
    );
  }
  return (
    <Link href={a.href} className={cls}>
      {label ?? a.label}
    </Link>
  );
}

/** 区切りの終わりに置く「次にすること」（相談のボタン ＋ 軽い寄り道のリンク 1 つ） */
export function NextStep({
  children,
  alt,
}: {
  /** ボタンの上のひとこと */
  children?: ReactNode;
  /** 相談の前に試せること（デモ・計算ツールなど） */
  alt?: { href: string; label: string };
}) {
  return (
    <div className="no-print mt-6 rounded-card border border-border border-l-4 border-l-accent bg-card p-4 sm:flex sm:items-center sm:gap-4">
      {children && <p className="text-[15px] font-bold leading-relaxed sm:flex-1">{children}</p>}
      <div className={cx("flex flex-col gap-2 sm:flex-row sm:items-center sm:gap-4", children ? "mt-3 sm:mt-0" : undefined)}>
        <PrimaryCta />
        {alt && (
          <Link href={alt.href} className="inline-flex min-h-11 items-center justify-center gap-1 text-sm font-bold">
            {alt.label}
            <ArrowIcon />
          </Link>
        )}
      </div>
    </div>
  );
}
