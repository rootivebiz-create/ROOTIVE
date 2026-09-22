/**
 * ダッシュボードに差し込む「これからの配車」カード（props だけで動くサーバー部品）。
 *
 * これから 1 週間の 必要 / 割り当て / 不足 と、予定の売上・粗利を出す。
 * 数字は DB のビュー（v_dispatch_outlook）から来たものを `summarizeOutlook` でまとめる。
 */
import { CalendarClock, CheckCircle2, ChevronRight, TriangleAlert } from "lucide-react";
import Link from "next/link";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Money } from "@/components/ui/money";
import { shortDateJa, summarizeOutlook, type OutlookDay } from "@/lib/dispatch/board";
import { cn } from "@/lib/utils";

export interface DispatchOutlookCardProps {
  /** v_dispatch_outlook の行（今日から 14 日ぶん） */
  days: OutlookDay[];
  /** まだ決めていない休み希望の件数 */
  pendingDayOffs: number;
  /** 何日ぶんを見るか（既定 7 日） */
  span?: number;
  className?: string;
}

function Stat({ label, value, tone }: { label: string; value: number; tone?: "destructive" | "warning" }) {
  return (
    <div className="rounded-md bg-muted/50 p-2 text-center">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className={cn("num mt-0.5 text-lg font-bold", value > 0 && tone === "destructive" && "text-destructive", value > 0 && tone === "warning" && "text-warning")}>
        {value}
      </p>
    </div>
  );
}

/** これからの配車カード */
export function DispatchOutlookCard({ days, pendingDayOffs, span = 7, className }: DispatchOutlookCardProps) {
  const outlook = summarizeOutlook(days, span);
  const { totals } = outlook;
  const nothing = totals.need === 0 && totals.assigned === 0;

  return (
    <Card className={className}>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <CalendarClock className="h-4 w-4" /> これからの配車
        </CardTitle>
        <CardDescription>これから {span} 日ぶんの予定です。</CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        {nothing ? (
          <p className="text-sm text-muted-foreground">
            まだ予定がありません。配車で「必要人数」を入れると、足りない日が分かります。
          </p>
        ) : (
          <>
            <div className="grid grid-cols-3 gap-2">
              <Stat label="必要" value={totals.need} />
              <Stat label="割り当て" value={totals.assigned} />
              <Stat label="足りない" value={totals.shortage} tone="destructive" />
            </div>

            <dl className="grid grid-cols-2 gap-2 text-sm">
              <div className="flex items-center justify-between rounded-md bg-muted/50 px-2 py-1.5">
                <dt className="text-muted-foreground">予定の売上</dt>
                <dd>
                  <Money value={totals.planBill} />
                </dd>
              </div>
              <div className="flex items-center justify-between rounded-md bg-muted/50 px-2 py-1.5">
                <dt className="text-muted-foreground">予定の粗利</dt>
                <dd>
                  <Money value={totals.planMargin} />
                </dd>
              </div>
            </dl>

            {totals.shortage > 0 ? (
              <p className="flex items-start gap-1.5 text-sm text-muted-foreground">
                <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0 text-destructive" aria-hidden />
                <span>
                  {outlook.firstShortDate && `${shortDateJa(outlook.firstShortDate)} から`}
                  人が {totals.shortage} 人足りません（{outlook.shortDays.length} 日）。
                </span>
              </p>
            ) : (
              <p className="flex items-center gap-1.5 text-sm text-success">
                <CheckCircle2 className="h-4 w-4" aria-hidden />
                必要な人はそろっています
              </p>
            )}

            {outlook.unconfirmed > 0 && (
              <p className="flex items-start gap-1.5 text-sm text-muted-foreground">
                <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0 text-warning" aria-hidden />
                <span>まだ確定していない予定が {outlook.unconfirmed} 件あります（確定するとドライバーに知らせます）。</span>
              </p>
            )}
          </>
        )}

        {pendingDayOffs > 0 && (
          <Link href="/dispatch?tab=offs" className="flex items-center justify-between rounded-md px-2 py-1.5 text-sm text-primary hover:bg-muted">
            <span>休み希望が {pendingDayOffs} 件 決まっていません</span>
            <ChevronRight className="h-4 w-4" />
          </Link>
        )}

        <Link href="/dispatch" className="flex items-center justify-between rounded-md px-2 py-1.5 text-sm text-primary hover:bg-muted">
          <span>配車を見る</span>
          <ChevronRight className="h-4 w-4" />
        </Link>
      </CardContent>
    </Card>
  );
}
