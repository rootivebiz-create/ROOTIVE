import Link from "next/link";
import { ChevronRight, Lock } from "lucide-react";
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
    .map((r) => ({ month: dateToMonth(r.month), payout: Number(r.payout ?? 0), closedAt: r.closed_at ?? null }));

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
                      <Lock className="h-4 w-4 text-muted-foreground" aria-hidden />
                      {formatMonthJa(r.month)}
                    </p>
                    <p className="text-xs text-muted-foreground">締め日：{formatDateOnlyJa(r.closedAt)}</p>
                  </div>
                  <div className="flex items-center gap-1">
                    <div className="text-right">
                      <p className="text-[11px] text-muted-foreground">お支払額</p>
                      <Money value={r.payout} className="text-lg font-semibold" />
                    </div>
                    <ChevronRight className="h-5 w-5 text-muted-foreground" />
                  </div>
                </Card>
              </Link>
            </li>
          ))}
        </ul>
      )}
      <p className="mt-3 text-xs text-muted-foreground">※ 未締めの月は集計中のため表示されません。</p>
    </div>
  );
}
