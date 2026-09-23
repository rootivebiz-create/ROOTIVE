import type { ReactNode } from "react";
import { toZenginKana } from "@/lib/payroll/zengin";

/** 公的な資料へのリンク（別のタブで開く） */
export function SourceLink({ href, children }: { href: string; children: ReactNode }) {
  return (
    <a href={href} target="_blank" rel="noopener noreferrer" className="underline">
      {children}
      <span className="sr-only">（別のタブで開きます）</span>
    </a>
  );
}

/** 振込データに入る書き方の見本。使えない文字は赤で出す */
export function KanaPreview({ value, label = "振込データ" }: { value: string; label?: string }) {
  const v = value.trim();
  if (!v) return null;
  const { value: half, invalid } = toZenginKana(v);
  return (
    <p className="text-xs text-muted-foreground">
      {label}では「<span className="num font-bold text-foreground">{half || "（空）"}</span>」
      {invalid.length > 0 && (
        <span className="ml-1 font-bold text-danger">使えない文字：「{[...new Set(invalid)].join("")}」</span>
      )}
    </p>
  );
}
