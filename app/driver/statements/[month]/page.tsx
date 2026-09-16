import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, Hourglass } from "lucide-react";
import { requireDriver } from "@/lib/auth/session";
import { isMonthKey, monthToDate, formatMonthJa } from "@/lib/month";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { PageHeader } from "@/components/ui/page-header";
import { parsePortalStatement, PortalStatementView } from "@/components/driver/portal-statement";

export const metadata = { title: "支払明細" };

export default async function DriverStatementPage({ params }: { params: Promise<{ month: string }> }) {
  const { supabase, company, driverId } = await requireDriver();
  const { month } = await params;
  if (!isMonthKey(month)) notFound();

  const { data, error } = await supabase.rpc("driver_portal_statement", { p_month: monthToDate(month) });
  if (error) throw error;
  const st = parsePortalStatement(data);
  if (!st) notFound();

  return (
    <div>
      <div className="mb-2">
        <Link href="/driver" className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
          <ArrowLeft className="h-4 w-4" />
          明細一覧へ
        </Link>
      </div>
      <PageHeader title={`${formatMonthJa(month)} 支払明細`} />
      {st.status === "open" ? (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Hourglass className="h-5 w-5 text-muted-foreground" />
              集計中
            </CardTitle>
            <CardDescription>{formatMonthJa(month)} はまだ締め処理が完了していません。</CardDescription>
          </CardHeader>
          <CardContent>
            <p className="text-sm text-muted-foreground">月締めが完了すると明細とお支払額が表示されます。しばらくお待ちください。</p>
          </CardContent>
        </Card>
      ) : (
        <PortalStatementView
          st={st}
          month={month}
          driverId={driverId}
          fallback={{ payout_month_offset: company.payout_month_offset, payout_day: company.payout_day, statement_note: company.statement_note, companyName: company.name }}
        />
      )}
    </div>
  );
}
