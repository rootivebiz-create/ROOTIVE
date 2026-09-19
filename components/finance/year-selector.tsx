"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Select } from "@/components/ui/select";

/** 年セレクタ（?y= を切り替える。?m= などほかのパラメータは引き継ぐ） */
export function FinanceYearSelector({ year, years, label = "対象年" }: { year: number; years: number[]; label?: string }) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const options = years.includes(year) ? years : [year, ...years].sort((a, b) => b - a);

  return (
    <label className="flex items-center gap-2 text-sm">
      <span className="shrink-0 text-muted-foreground">{label}</span>
      <Select
        value={String(year)}
        aria-label={label}
        className="w-28"
        onChange={(e) => {
          const sp = new URLSearchParams(params.toString());
          sp.set("y", e.target.value);
          router.push(`${pathname}?${sp.toString()}`);
        }}
      >
        {options.map((y) => (
          <option key={y} value={y}>
            {y}年
          </option>
        ))}
      </Select>
    </label>
  );
}
