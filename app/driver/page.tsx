import Link from "next/link";
import { ChevronRight, Clock, Lock } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { requireDriver } from "@/lib/auth/session";
import { formatMonthJa } from "@/lib/month";
import { formatDateOnlyJa } from "@/lib/format";
import { PageHeader } from "@/components/ui/page-header";
import { Card } from "@/components/ui/card";
import { Empty } from "@/components/ui/empty";
import { Money } from "@/components/ui/money";
import { parsePortalCurrent, summarizeYears, toPortalMonthRows } from "@/components/driver/helpers";
import { PortalCurrentCard } from "@/components/driver/portal-current";
import { PortalYearsCard } from "@/components/driver/portal-years";

export const metadata = { title: "支払明細一覧" };

export default async function DriverHomePage() {
  const { supabase, profile } = await requireDriver();

  const [monthsRes, currentRes] = await Promise.all([
    supabase.rpc("driver_portal_months"),
    // 未締め月の速報（会社設定が off・対象が無ければ null）。RPC が無い環境でも一覧は表示する
    supabase.rpc("driver_portal_current"),
  ]);
  if (monthsRes.error) throw monthsRes.error;

  // お支払額は税込（payout_incl）。締め前の月は null
  const rows = toPortalMonthRows(monthsRes.data);
  const years = summarizeYears(rows);
  const current = currentRes.error ? null : parsePortalCurrent(currentRes.data);

  return (
    <div className="space-y-4">
      <PageHeader title="支払明細一覧" description={`${profile.display_name || ""} 様の月別のお支払額です。`} className="mb-0" />

      {current && <PortalCurrentCard current={current} />}

      <PortalYearsCard years={years} />

      <section>
        <h2 className="mb-2 text-base font-semibold">支払明細</h2>
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
      </section>
    </div>
  );
}
