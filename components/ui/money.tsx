import { cn } from "@/lib/utils";
import { yen, pct as pctText, qty as qtyText } from "@/lib/format";

/** 金額表示：等幅・右寄せ・マイナスは赤 */
export function Money({ value, className, showZeroAsDash = false }: { value: number | null | undefined; className?: string; showZeroAsDash?: boolean }) {
  const v = value ?? 0;
  if (showZeroAsDash && v === 0) return <span className={cn("num text-muted-foreground", className)}>—</span>;
  return <span className={cn("num", v < 0 && "neg", className)}>{yen(v)}</span>;
}

export function Pct({ value, className }: { value: number | null | undefined; className?: string }) {
  const v = value ?? 0;
  return <span className={cn("num", v < 0 && "neg", className)}>{pctText(v)}</span>;
}

export function Qty({ value, className }: { value: number | null | undefined; className?: string }) {
  return <span className={cn("num", className)}>{qtyText(value)}</span>;
}
