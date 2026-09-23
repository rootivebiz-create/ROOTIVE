"use client";

import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { buttonVariants } from "@/components/ui/button";
import { Select } from "@/components/ui/select";
import { cn } from "@/lib/utils";
import type { ReportView } from "./helpers";

/**
 * 年次レポートの範囲の切り替え（0030）：期で見る／暦年で見る、前後の矢印、選択肢。
 * 期は ?fy=（決算の年）、暦年は ?y=。?m= などほかのパラメータは引き継ぐ。
 * 切り替えと矢印はリンクにする（続けて押しても取りこぼさない・先読みされる）
 */
export function RangeSelector({
  view,
  year,
  options,
  showViewToggle,
  toggleYears,
}: {
  view: ReportView;
  year: number;
  options: { value: number; label: string }[];
  /** 決算月が 12 月でなければ、期と暦年を切り替えられる */
  showViewToggle: boolean;
  /** 切り替えたときに開く年（期→暦年は期の終わりの年、暦年→期はその年に決算を迎える期） */
  toggleYears: { fiscal: number; calendar: number };
}) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();

  const hrefFor = (v: ReportView, y: number) => {
    const sp = new URLSearchParams(params.toString());
    sp.delete("y");
    sp.delete("fy");
    sp.set(v === "fiscal" ? "fy" : "y", String(y));
    return `${pathname}?${sp.toString()}`;
  };

  const list = options.some((o) => o.value === year) ? options : [...options, { value: year, label: view === "fiscal" ? `${year}年の決算の期` : `${year}年` }].sort((a, b) => b.value - a.value);
  const unit = view === "fiscal" ? "期" : "年";
  const arrow = cn(buttonVariants({ variant: "outline", size: "icon" }), "h-10 w-10");

  return (
    <div className="flex flex-wrap items-center gap-2">
      {showViewToggle && (
        <div role="radiogroup" aria-label="集計の区切り" className="grid grid-cols-2 gap-1 rounded-md border bg-muted/40 p-1 text-sm">
          {(["fiscal", "calendar"] as const).map((v) => (
            <Link
              key={v}
              href={hrefFor(v, view === v ? year : toggleYears[v])}
              role="radio"
              aria-checked={view === v}
              scroll={false}
              className={cn("rounded px-2.5 py-1 text-center", view === v ? "bg-card font-medium shadow-sm" : "text-muted-foreground hover:bg-card")}
            >
              {v === "fiscal" ? "期で見る" : "暦年で見る"}
            </Link>
          ))}
        </div>
      )}
      <div className="flex items-center gap-1">
        <Link href={hrefFor(view, year - 1)} scroll={false} className={arrow} aria-label={`前の${unit}`}>
          <ChevronLeft />
        </Link>
        <Select
          value={String(year)}
          aria-label={view === "fiscal" ? "表示する期" : "表示する年"}
          className={view === "fiscal" ? "w-auto max-w-[17rem]" : "w-28"}
          onChange={(e) => router.push(hrefFor(view, Number(e.target.value)), { scroll: false })}
        >
          {list.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </Select>
        <Link href={hrefFor(view, year + 1)} scroll={false} className={arrow} aria-label={`次の${unit}`}>
          <ChevronRight />
        </Link>
      </div>
    </div>
  );
}
