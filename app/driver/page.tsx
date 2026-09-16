import Link from "next/link";
import { ChevronRight, Clock, Lock } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { requireDriver } from "@/lib/auth/session";
import { dateToMonth, formatMonthJa } from "@/lib/month";
import { formatDateOnlyJa } from "@/lib/format";
import { PageHeader } from "@/components/ui/page-header";
import { Card } from "@/components/ui/card";
import { Empty } from "@/components/ui/empty";
import { Money } from "@/components/ui/money";

export const metadata = { title: "支払明細一覧" };

export default async function DriverHomePage() {
  const { supabase, profile } = await requireDriver();
  const { data, error } = await supabase.rpc("driver_portal_months");
  if (error) throw error;
  const rows = (data ?? [])
    .filter((r) => r.month)
    // お支払額は税込（payout_incl）。締め前の月は null
    .map((r) => ({ month: dateToMonth(r.month), status: r.status, payoutIncl: r.payout_incl == null ? null : Number(r.payout_incl), closedAt: r.closed_at ?? null }));

  return (
    <div>
      <PageHeader title="支払明細一覧" description={`${profile.display_name || ""} 様の月別のお支払額です。`} />
      {rows.length === 0 ? (
        <Empty title="表示できる明細はまだありません" description="月締めが完了すると、その月の支払明細がここに表示されます。" />
      ) : (
        <ul className="space-y-2">
          {rows.map((r) => (
            <li key={r.month}>
              <Link href={`/driver/statements/${r.month}`} className="block">
                <Card className="flex items-center justify-between gap-3 p-4 active:bg-muted">
                  <div className="min-w-0">
                    <p className="flex items-center gap-1.5 font-medium">
                      {r.status === "closed" ? <Lock className="h-4 w-4 text-muted-foreground" aria-hidden /> : <Clock className="h-4 w-4 text-muted-foreground" aria-hidden />}
                      {formatMonthJa(r.month)}
                    </p>
                    <p className="text-xs text-muted-foreground">{r.status === "closed" ? `締め日：${formatDateOnlyJa(r.closedAt)}` : "集計中（月締め後に確定します）"}</p>
                  </div>
                  <div className="flex items-center gap-1">
                    <div className="text-right">
                      <p className="text-[11px] text-muted-foreground">お支払額</p>
                      {r.status === "closed" ? <Money value={r.payoutIncl} className="text-lg font-semibold" /> : <Badge variant="outline">集計中</Badge>}
                    </div>
                    <ChevronRight className="h-5 w-5 text-muted-foreground" />
                  </div>
                </Card>
              </Link>
            </li>
          ))}
        </ul>
      )}
      <p className="mt-3 text-xs text-muted-foreground">※ 「集計中」の月は月締め後に金額が確定します。</p>
    </div>
  );
}
