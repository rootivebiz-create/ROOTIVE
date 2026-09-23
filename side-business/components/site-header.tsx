import Link from "next/link";
import { PlateLogo } from "@/components/plate-logo";
import { SITE } from "@/site.config";

/** スマホでは「記事」を隠す（フッターから辿れる）。「相談する」は目立たせる */
const NAV = [
  { href: "/demo", label: "デモ", className: "inline-flex" },
  { href: "/tools", label: "無料ツール", className: "inline-flex" },
  { href: "/articles", label: "記事", className: "hidden sm:inline-flex" },
] as const;

export function SiteHeader() {
  return (
    <header className="no-print sticky top-0 z-30 border-b border-border bg-background/90 backdrop-blur">
      <a
        href="#main"
        className="sr-only rounded-lg bg-card px-4 py-2 font-bold text-foreground focus:not-sr-only focus:absolute focus:left-2 focus:top-2 focus:z-40"
      >
        本文へ移動
      </a>
      <div className="mx-auto flex h-14 max-w-5xl items-center gap-2 px-4 sm:gap-3">
        <Link href="/" className="flex shrink-0 items-center gap-2 font-bold text-foreground no-underline">
          <PlateLogo />
          {/* とても狭い画面（360px 未満）では屋号の文字を隠し、ロゴだけにする */}
          <span className="whitespace-nowrap text-[15px] tracking-tight max-[359px]:sr-only">{SITE.name}</span>
        </Link>
        <nav aria-label="メイン" className="ml-auto flex min-w-0 items-center gap-0.5 text-[13px] sm:gap-1 sm:text-sm">
          {NAV.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              className={`min-h-11 items-center whitespace-nowrap rounded-md px-1.5 text-foreground no-underline hover:bg-muted sm:px-2 ${item.className}`}
            >
              {item.label}
            </Link>
          ))}
          <Link
            href="/contact"
            className="ml-1 inline-flex min-h-11 items-center whitespace-nowrap rounded-md bg-accent px-2.5 font-bold text-accent-foreground no-underline hover:opacity-90"
          >
            相談する
          </Link>
        </nav>
      </div>
    </header>
  );
}
