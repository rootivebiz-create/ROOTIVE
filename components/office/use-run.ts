"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import type { ActionResult } from "@/lib/actions/result";

/**
 * 事務の画面のボタン用：Server Action を呼び、結果をトーストで出して画面を読み直す。
 * どのボタンも「押したら結果が出て、一覧が最新になる」を同じ動きにそろえる。
 */
export function useRun() {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const run = <T,>(fn: () => Promise<ActionResult<T>>, fallback = "保存しました", onDone?: (data: T) => void) =>
    startTransition(async () => {
      const res = await fn();
      if (res.ok) {
        toast.success(res.message ?? fallback);
        onDone?.(res.data);
        router.refresh();
      } else {
        toast.error(res.error);
      }
    });
  return { pending, run };
}
