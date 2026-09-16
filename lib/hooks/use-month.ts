"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useCallback } from "react";
import { currentMonthJST, isMonthKey } from "@/lib/month";

/** URL の ?m=YYYY-MM に連動する稼動月 */
export function useMonth() {
  const params = useSearchParams();
  const pathname = usePathname();
  const router = useRouter();
  const raw = params.get("m");
  const month = isMonthKey(raw) ? raw : currentMonthJST();

  const href = useCallback(
    (path: string, extra?: Record<string, string>) => {
      const sp = new URLSearchParams();
      sp.set("m", month);
      if (extra) for (const [k, v] of Object.entries(extra)) sp.set(k, v);
      const [base, query] = path.split("?");
      if (query) for (const [k, v] of new URLSearchParams(query)) sp.set(k, v);
      return `${base}?${sp.toString()}`;
    },
    [month],
  );

  const setMonth = useCallback(
    (m: string) => {
      const sp = new URLSearchParams(params.toString());
      sp.set("m", m);
      router.push(`${pathname}?${sp.toString()}`);
    },
    [params, pathname, router],
  );

  return { month, setMonth, href };
}
