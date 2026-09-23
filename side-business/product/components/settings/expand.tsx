"use client";

import { useState, type ReactNode } from "react";

/**
 * 開いて直す（スマホでも同じ場所で）。開いているかは画面の中で覚える
 * （保存して一覧が読み直されても、勝手に閉じない）。
 */
export function Expand({ summary, children, open }: { summary: ReactNode; children: ReactNode; open?: boolean }) {
  const [isOpen, setOpen] = useState(!!open);
  return (
    <details className="group rounded-lg border border-border" open={isOpen} onToggle={(e) => setOpen(e.currentTarget.open)}>
      <summary className="flex min-h-11 cursor-pointer list-none items-center justify-between gap-2 px-3 text-sm font-bold">
        <span>{summary}</span>
        <span aria-hidden className="text-muted-foreground transition group-open:rotate-180">
          ▾
        </span>
      </summary>
      <div className="space-y-3 border-t border-border p-3">{children}</div>
    </details>
  );
}
