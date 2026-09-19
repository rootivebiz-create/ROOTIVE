/**
 * 出力メニュー：同じ内容を CSV / Excel など複数の形式で落とせる小さなボタン群
 * - スマホ（375px）でも折り返して崩れないよう flex-wrap で並べる
 * - 画面側は <ExportMenu items={[{ label: "CSV", href: ... }, { label: "Excel", href: ... }]} /> のように使う
 */
import * as React from "react";
import { Download } from "lucide-react";
import { cn } from "@/lib/utils";
import { buttonVariants } from "@/components/ui/button";

export interface ExportMenuItem {
  /** ボタンの表示（"CSV" / "Excel" など） */
  label: string;
  href: string;
  /** スクリーンリーダー向けの説明（省略時は「<見出し>を<label>で出力」） */
  ariaLabel?: string;
}

export interface ExportMenuProps {
  items: ExportMenuItem[];
  /** 先頭に出す小さな見出し（例：「稼働明細」）。省略すると「出力」 */
  label?: string;
  /** ボタンの大きさ（既定は sm） */
  size?: "sm" | "default";
  className?: string;
}

/** ダウンロード用のリンクボタン（新規タブにせず download 属性を付ける） */
function ExportLink({ item, label, size }: { item: ExportMenuItem; label: string; size: "sm" | "default" }) {
  return (
    <a
      href={item.href}
      download
      aria-label={item.ariaLabel ?? `${label}を ${item.label} で出力`}
      className={cn(buttonVariants({ variant: "outline", size }), "gap-1")}
    >
      <Download aria-hidden="true" />
      {item.label}
    </a>
  );
}

export function ExportMenu({ items, label = "出力", size = "sm", className }: ExportMenuProps) {
  if (items.length === 0) return null;
  return (
    <div className={cn("flex flex-wrap items-center gap-2", className)}>
      <span className="text-xs text-muted-foreground">{label}</span>
      {items.map((item) => (
        <ExportLink key={item.href} item={item} label={label} size={size} />
      ))}
    </div>
  );
}

/** CSV と Excel の 2 つだけを並べる、いちばんよく使う形 */
export function CsvXlsxExportMenu({ csvHref, xlsxHref, label, size, className }: { csvHref: string; xlsxHref: string } & Omit<ExportMenuProps, "items">) {
  return (
    <ExportMenu
      items={[
        { label: "CSV", href: csvHref },
        { label: "Excel", href: xlsxHref },
      ]}
      label={label}
      size={size}
      className={className}
    />
  );
}

export default ExportMenu;
