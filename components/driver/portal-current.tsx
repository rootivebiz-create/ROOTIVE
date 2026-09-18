import { Hourglass, Info } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Money } from "@/components/ui/money";
import { formatDateTimeJa } from "@/lib/format";
import { formatDateJa, formatMonthJa } from "@/lib/month";
import type { PortalCurrent } from "./helpers";

/**
 * 今月の速報（未締め月の暫定額）。
 * 金額は RPC driver_portal_current()（集計ビュー）の値をそのまま表示する。
 * 締め前のため確定値ではないことを必ず添える。
 */
export function PortalCurrentCard({ current }: { current: PortalCurrent }) {
  const taxBase = current.pay - current.royalty - current.mgmtFee;
  return (
    <Card className="border-primary/40">
      <CardHeader>
        <CardTitle className="flex flex-wrap items-center gap-2">
          <Hourglass className="h-5 w-5 text-muted-foreground" aria-hidden />
          {formatMonthJa(current.month)}
          <Badge variant="outline">集計中</Badge>
        </CardTitle>
        <CardDescription>
          稼働 <span className="num">{current.entryCount}</span> 件の時点の暫定額です。
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <section className="rounded-lg bg-accent p-4 text-accent-foreground">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span className="text-base font-semibold">お支払予定額（税込）</span>
            <Money value={current.payoutIncl} className="text-2xl font-bold md:text-3xl" />
          </div>
          {current.payoutDate && (
            <p className="mt-1 text-sm">
              振込予定日：<span className="num">{formatDateJa(current.payoutDate)}</span>
            </p>
          )}
        </section>

        <dl className="space-y-1 text-sm">
          <div className="flex items-center justify-between gap-3">
            <dt className="text-muted-foreground">稼働小計</dt>
            <dd>
              <Money value={current.pay} />
            </dd>
          </div>
          <div className="flex items-center justify-between gap-3">
            <dt className="text-muted-foreground">ロイヤリティ</dt>
            <dd>
              <Money value={-current.royalty} />
            </dd>
          </div>
          <div className="flex items-center justify-between gap-3">
            <dt className="text-muted-foreground">管理費</dt>
            <dd>
              <Money value={-current.mgmtFee} />
            </dd>
          </div>
          <div className="flex items-center justify-between gap-3 border-t pt-1 font-medium">
            <dt>小計（税抜）</dt>
            <dd>
              <Money value={taxBase} />
            </dd>
          </div>
          <div className="flex items-center justify-between gap-3">
            <dt className="text-muted-foreground">調整（税込）</dt>
            <dd>
              <Money value={current.adjPay} />
            </dd>
          </div>
          <div className="flex items-center justify-between gap-3">
            <dt className="text-muted-foreground">消費税</dt>
            <dd>
              <Money value={current.tax} />
            </dd>
          </div>
        </dl>

        <p className="flex items-start gap-1.5 rounded-md bg-muted p-3 text-xs text-muted-foreground">
          <Info className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
          <span>
            締め前のため変わることがあります。金額は月締めの完了時に確定します。
            <br />
            最終更新：<span className="num">{formatDateTimeJa(current.updatedAt)}</span>
          </span>
        </p>
      </CardContent>
    </Card>
  );
}
