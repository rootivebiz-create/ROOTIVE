"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Select } from "@/components/ui/select";

/**
 * 年セレクタ（?y= を切り替える。?m= などほかのパラメータは引き継ぐ）。
 * optionLabel で選択肢の表示を変えられる（税務は「2026年（第3期の決算）」）
 */
export function FinanceYearSelector({
  year,
  years,
  label = "対象年",
  optionLabel = (y) => `${y}年`,
}: {
  year: number;
  years: number[];
  label?: string;
  optionLabel?: (year: number) => string;
}) {
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
        className="w-auto min-w-28 max-w-[16rem]"
        onChange={(e) => {
          const sp = new URLSearchParams(params.toString());
          sp.set("y", e.target.value);
          router.push(`${pathname}?${sp.toString()}`);
        }}
      >
        {options.map((y) => (
          <option key={y} value={y}>
            {optionLabel(y)}
          </option>
        ))}
      </Select>
    </label>
  );
}
