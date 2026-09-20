import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, Stamp } from "lucide-react";
import { requirePageRole } from "@/lib/auth/session";
import { loadDecision } from "@/lib/executive/queries";
import { loadMonthKpiRange } from "@/lib/db/queries";
import { uuidSchema } from "@/lib/schemas/common";
import { DECISION_STATUS_LABELS } from "@/lib/db/types";
import { addMonths, dateToMonth, formatMonthJa, monthToDate } from "@/lib/month";
import { pct } from "@/lib/format";
import { todayJST } from "@/lib/finance/date";
import { PageHeader } from "@/components/ui/page-header";
import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Empty } from "@/components/ui/empty";
import { Money } from "@/components/ui/money";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { DecisionReviewForm } from "@/components/executive/decision-review-form";
import { DECISION_STATUS_BADGE, dateText, toOptionList } from "@/components/executive/helpers";
import { cn } from "@/lib/utils";

export const metadata = { title: "意思決定の振り返り" };

/** 決めた日の前後に並べる月数 */
const AROUND_MONTHS = 3;

/** 本文の 1 段落（空欄は「—」） */
function Section({ title, text }: { title: string; text: string }) {
  return (
    <div>
      <p className="text-xs text-muted-foreground">{title}</p>
      {text ? <p className="mt-0.5 whitespace-pre-wrap break-words text-sm leading-relaxed">{text}</p> : <p className="mt-0.5 text-sm text-muted-foreground">—</p>}
    </div>
  );
}

/**
 * 意思決定の振り返り（/executive/decisions/[id]）：代表（owner）専用
 *
 * このパスは DB のビュー v_executive_tasks が指しているので変えない。
 * 経営指標は決めた日の前後 3 か月（v_month_kpi）。数字は DB のビューをそのまま出す（手計算しない）。
 */
export default async function DecisionDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!uuidSchema.safeParse(id).success) notFound();
  const { supabase, company } = await requirePageRole(["owner"]);

  const decision = await loadDecision(supabase, company.id, id);
  if (!decision) notFound();

  const decidedMonth = dateToMonth(decision.decided_on);
  const from = monthToDate(addMonths(decidedMonth, -AROUND_MONTHS));
  const to = monthToDate(addMonths(decidedMonth, AROUND_MONTHS));
  const kpis = await loadMonthKpiRange(supabase, company.id, from, to);
  const options = toOptionList(decision.options);
  const today = todayJST();

  return (
    <div className="space-y-4">
      <PageHeader
        title={decision.title}
        description={`${dateText(decision.decided_on)}に決定${decision.created_by_name ? ` / ${decision.created_by_name}` : ""}`}
        actions={
          <>
            <Badge variant={DECISION_STATUS_BADGE[decision.status] ?? "secondary"}>{DECISION_STATUS_LABELS[decision.status]}</Badge>
            <Link href="/executive/decisions" className={cn(buttonVariants({ variant: "outline", size: "sm" }))}>
              <ArrowLeft className="h-4 w-4" />
              一覧
            </Link>
          </>
        }
      />

      <Card>
        <CardHeader>
          <CardTitle>決めた内容</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <dl className="grid grid-cols-2 gap-x-4 gap-y-3 md:grid-cols-4">
            <div>
              <dt className="text-xs text-muted-foreground">金額</dt>
              <dd className="mt-0.5 text-sm">{decision.amount == null ? "—" : <Money value={decision.amount} />}</dd>
            </div>
            <div>
              <dt className="text-xs text-muted-foreground">決めた日</dt>
              <dd className="num mt-0.5 text-sm">{dateText(decision.decided_on)}</dd>
            </div>
            <div>
              <dt className="text-xs text-muted-foreground">見直し日</dt>
              <dd className={cn("num mt-0.5 text-sm", decision.status === "open" && decision.review_on && decision.review_on <= today && "font-semibold text-warning")}>
                {dateText(decision.review_on)}
              </dd>
            </div>
            <div>
              <dt className="text-xs text-muted-foreground">振り返った日</dt>
              <dd className="num mt-0.5 text-sm">{dateText(decision.outcome_on)}</dd>
            </div>
          </dl>

          <Section title="背景・検討した選択肢" text={decision.context} />
          {options.length > 0 && (
            <div>
              <p className="text-xs text-muted-foreground">選択肢</p>
              <ul className="mt-0.5 list-disc space-y-0.5 pl-5 text-sm">
                {options.map((o, i) => (
                  <li key={`${o}-${i}`} className="break-words">
                    {o}
                  </li>
                ))}
              </ul>
            </div>
          )}
          <Section title="決めたこと" text={decision.decision} />
          <Section title="そう決めた理由" text={decision.reason} />
          <Section title="期待する効果" text={decision.expected_effect} />
          {decision.outcome && <Section title="結果と学び" text={decision.outcome} />}

          {decision.approval_id && (
            <Link href={`/executive/approvals/${decision.approval_id}`} className={cn(buttonVariants({ variant: "outline", size: "sm" }))}>
              <Stamp className="h-4 w-4" />
              もとになった決裁を見る
            </Link>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>決めた前後の数字</CardTitle>
          <CardDescription>{formatMonthJa(decidedMonth)}の前後 {AROUND_MONTHS} か月の経営指標（v_month_kpi）です。効果が出たかを数字で確かめます。</CardDescription>
        </CardHeader>
        <CardContent>
          {kpis.length === 0 ? (
            <Empty title="この期間の数字がまだありません" description="稼働と経費を入れると、売上・営業利益がここに並びます。" />
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>月</TableHead>
                  <TableHead className="text-right">売上</TableHead>
                  <TableHead className="text-right">営業利益</TableHead>
                  <TableHead className="text-right">支払比率</TableHead>
                  <TableHead className="text-right">1 人当たり利益</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {kpis.map((k) => {
                  const month = dateToMonth(k.month ?? "");
                  const isDecidedMonth = month === decidedMonth;
                  return (
                    <TableRow key={month} className={cn(isDecidedMonth && "bg-muted/60")}>
                      <TableCell className="whitespace-nowrap">
                        <span className={cn("num", isDecidedMonth && "font-semibold")}>{formatMonthJa(month)}</span>
                        {isDecidedMonth && <span className="ml-1 text-xs text-muted-foreground">決定</span>}
                      </TableCell>
                      <TableCell className="text-right">
                        <Money value={k.bill} />
                      </TableCell>
                      <TableCell className="text-right">
                        <Money value={k.operating_profit} />
                      </TableCell>
                      <TableCell className="num text-right">{pct(k.payout_rate ?? 0)}</TableCell>
                      <TableCell className="text-right">
                        <Money value={k.profit_per_driver} />
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <DecisionReviewForm decision={decision} today={today} />
    </div>
  );
}
