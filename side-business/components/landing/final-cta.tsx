import Link from "next/link";
import { cx } from "@/lib/cx";
import { NewTabNote } from "./section";

const BASE =
  "inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-lg px-5 text-base font-bold no-underline transition sm:w-auto";
const SOLID = cx(BASE, "bg-accent text-accent-foreground hover:opacity-90");
const OUTLINE = cx(BASE, "border border-white/40 text-white hover:bg-white/10");

export function FinalCta({ bookingUrl, lineUrl }: { bookingUrl: string | null; lineUrl: string | null }) {
  // 予約のページがあれば、それをいちばん目立たせる。無ければ相談フォーム
  const primary = bookingUrl ? "booking" : "form";
  return (
    <section
      id="soudan"
      aria-labelledby="soudan-title"
      className="no-print mt-16 scroll-mt-20 rounded-card border border-border bg-plate p-6 text-white sm:mt-24 sm:p-10"
    >
      <h2 id="soudan-title" className="text-[1.35rem] font-bold leading-snug text-plate-foreground [word-break:auto-phrase] sm:text-2xl">
        まずは30分、今の締め方を聞かせてください
      </h2>
      <p className="mt-3 max-w-2xl leading-relaxed text-white/85">
        オンラインで30分。今のExcelや明細の形をうかがい、御社のやり方のまま仕組みにできるかをお伝えします。無理にすすめることはしません。
      </p>
      <div className="mt-6 flex flex-col gap-3 sm:flex-row sm:flex-wrap">
        {bookingUrl && (
          <a href={bookingUrl} target="_blank" rel="noopener noreferrer" className={SOLID}>
            オンライン相談を予約する
            <NewTabNote />
          </a>
        )}
        {lineUrl && (
          <a href={lineUrl} target="_blank" rel="noopener noreferrer" className={OUTLINE}>
            LINEで相談する
            <NewTabNote />
          </a>
        )}
        <Link href="/contact" className={primary === "form" ? SOLID : OUTLINE}>
          相談フォームから送る
        </Link>
        <Link href="/tools/invoice-cost" className={OUTLINE}>
          70%の負担を計算する（無料）
        </Link>
      </div>
    </section>
  );
}
