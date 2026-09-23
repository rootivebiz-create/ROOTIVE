"use client";

import { Banknote, CalendarRange, ClipboardCheck, ClipboardList, Coins, FileText, Landmark, Mic, Receipt, Truck, type LucideIcon } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { MonthLink } from "@/components/layout/month-link";

interface QuickAction {
  href: string;
  label: string;
  hint: string;
  icon: LucideIcon;
}

/** 事務でよく使う入口（大きく押しやすく。稼動月 ?m は引き継ぐ） */
export const OFFICE_QUICK_ACTIONS: QuickAction[] = [
  { href: "/entries", label: "稼働を入れる", hint: "ドライバー × 案件 × 数量", icon: ClipboardList },
  { href: "/entries?voice=1", label: "声で入れる", hint: "話すか文字で一度に", icon: Mic },
  { href: "/daily", label: "日報・点呼", hint: "代わりに入力も", icon: ClipboardCheck },
  { href: "/expenses", label: "経費・レシート", hint: "撮って読み取り", icon: Coins },
  { href: "/invoices", label: "請求書", hint: "作成・発行・入金", icon: Receipt },
  { href: "/payouts", label: "支払明細", hint: "PDF・LINE 文面", icon: FileText },
  { href: "/payouts/transfer", label: "振込データ", hint: "全銀の総合振込", icon: Landmark },
  { href: "/bank", label: "入金の取り込み", hint: "銀行 CSV と消込", icon: Banknote },
  { href: "/dispatch", label: "配車", hint: "週の配車表", icon: CalendarRange },
  { href: "/fleet", label: "車両と書類", hint: "免許・車検・保険", icon: Truck },
];

export function QuickActions() {
  return (
    <Card id="quick">
      <CardHeader>
        <CardTitle>よく使う操作</CardTitle>
      </CardHeader>
      <CardContent>
        <ul className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-5">
          {OFFICE_QUICK_ACTIONS.map((a) => (
            <li key={a.href}>
              <MonthLink
                href={a.href}
                className="flex h-full min-h-[4.5rem] flex-col justify-center gap-1 rounded-lg border bg-card p-3 transition-colors hover:bg-muted active:bg-muted"
              >
                <span className="flex items-center gap-2 text-sm font-semibold">
                  <a.icon className="h-4 w-4 shrink-0 text-primary" />
                  {a.label}
                </span>
                <span className="text-xs text-muted-foreground">{a.hint}</span>
              </MonthLink>
            </li>
          ))}
        </ul>
      </CardContent>
    </Card>
  );
}
