/**
 * 出力センター（/exports）のカードと行
 * - 1 つの行に「何に使うものか」の 1 行の説明と、その場で押せるダウンロードボタンを並べる
 * - スマホ（375px）では説明の下にボタンが折り返す
 */
import type { LucideIcon } from "lucide-react";
import { Download } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { buttonVariants } from "@/components/ui/button";
import { MonthLink } from "@/components/layout/month-link";
import { cn } from "@/lib/utils";

/** 出力の分類カード */
export function ExportCard({
  title,
  description,
  icon: Icon,
  children,
}: {
  title: string;
  description: string;
  icon: LucideIcon;
  children: React.ReactNode;
}) {
  return (
    <Card className="min-w-0">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Icon className="h-4 w-4 shrink-0 text-muted-foreground" />
          {title}
        </CardTitle>
        <CardDescription>{description}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">{children}</CardContent>
    </Card>
  );
}

/** カードの中の 1 項目（見出し＋ 1 行の説明＋ボタン） */
export function ExportRow({ label, description, children }: { label: string; description: string; children: React.ReactNode }) {
  return (
    <section className="space-y-1.5 border-t border-border pt-3 first:border-t-0 first:pt-0">
      <div className="min-w-0">
        <h3 className="text-sm font-semibold">{label}</h3>
        <p className="text-xs text-muted-foreground">{description}</p>
      </div>
      <div className="flex flex-wrap gap-2">{children}</div>
    </section>
  );
}

/** ダウンロードのボタン（<a download>） */
export function DownloadLink({ href, children, primary = false }: { href: string; children: React.ReactNode; primary?: boolean }) {
  return (
    <a href={href} download className={cn(buttonVariants({ variant: primary ? "default" : "outline", size: "sm" }))}>
      <Download className="h-4 w-4" />
      {children}
    </a>
  );
}

/** 画面へのリンク（ダウンロードではなく、出力を作る画面へ移動する。稼動月 ?m= を引き継ぐ） */
export function ExportPageLink({ href, children, icon: Icon }: { href: string; children: React.ReactNode; icon?: LucideIcon }) {
  return (
    <MonthLink href={href} className={cn(buttonVariants({ variant: "outline", size: "sm" }))}>
      {Icon ? <Icon className="h-4 w-4" /> : null}
      {children}
    </MonthLink>
  );
}
