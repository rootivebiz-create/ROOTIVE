import Link from "next/link";
import { PlateLogo } from "@/components/plate-logo";
import { SITE } from "@/site.config";

const NAV = [
  { href: "/tools", label: "計算ツール" },
  { href: "/templates", label: "様式" },
  { href: "/articles", label: "記事" },
  { href: "/app", label: "アプリ" },
] as const;

export function SiteHeader() {
  return (
    <header className="no-print sticky top-0 z-30 border-b border-border bg-background/90 backdrop-blur">
      <div className="mx-auto flex h-14 max-w-5xl items-center gap-3 px-4">
        <Link href="/" className="flex items-center gap-2 font-bold text-foreground no-underline">
          <PlateLogo />
          <span className="text-[15px] tracking-tight">{SITE.name}</span>
        </Link>
        <nav aria-label="メイン" className="ml-auto flex items-center gap-1 overflow-x-auto text-sm">
          {NAV.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              className="whitespace-nowrap rounded-md px-2 py-1.5 text-foreground no-underline hover:bg-muted"
            >
              {item.label}
            </Link>
          ))}
        </nav>
      </div>
    </header>
  );
}
