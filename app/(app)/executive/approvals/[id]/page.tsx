import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, ExternalLink } from "lucide-react";
import { requirePageRole } from "@/lib/auth/session";
import { loadApproval } from "@/lib/executive/queries";
import { uuidSchema } from "@/lib/schemas/common";
import { APPROVAL_STATUS_LABELS, APPROVAL_URGENCY_LABELS } from "@/lib/db/types";
import { formatDateTimeJa } from "@/lib/format";
import { PageHeader } from "@/components/ui/page-header";
import { Alert } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Money } from "@/components/ui/money";
import { ApprovalDecideForm } from "@/components/executive/approval-decide-form";
import { APPROVAL_STATUS_BADGE, URGENCY_BADGE, dateText, kindLabel } from "@/components/executive/helpers";
import { cn } from "@/lib/utils";

export const metadata = { title: "決裁の詳細" };

/** 概要の 1 項目 */
function Item({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="mt-0.5 break-words text-sm">{children}</dd>
    </div>
  );
}

/**
 * 決裁の詳細（/executive/approvals/[id]）：代表（owner）専用
 *
 * このパスは DB のビュー v_executive_tasks が指しているので変えない。
 */
export default async function ApprovalDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!uuidSchema.safeParse(id).success) notFound();
  const { supabase, company } = await requirePageRole(["owner"]);

  const approval = await loadApproval(supabase, company.id, id);
  if (!approval) notFound();

  const status = approval.status ?? "pending";
  const isPending = status === "pending";

  return (
    <div className="space-y-4">
      <PageHeader
        title={approval.title ?? "申請"}
        description={`${kindLabel(approval.kind)}の申請`}
        actions={
          <>
            <Badge variant={APPROVAL_STATUS_BADGE[status]}>{APPROVAL_STATUS_LABELS[status]}</Badge>
            {isPending && <Badge variant={URGENCY_BADGE[approval.urgency ?? "waiting"]}>{APPROVAL_URGENCY_LABELS[approval.urgency ?? "waiting"]}</Badge>}
            <Link href="/executive/approvals" className={cn(buttonVariants({ variant: "outline", size: "sm" }))}>
              <ArrowLeft className="h-4 w-4" />
              一覧
            </Link>
          </>
        }
      />

      <Card>
        <CardContent className="space-y-3 p-4 md:p-5">
          {approval.amount != null && (
            <div>
              <p className="text-xs text-muted-foreground">金額</p>
              <p className="text-2xl font-bold">
                <Money value={approval.amount} />
              </p>
            </div>
          )}
          <dl className="grid grid-cols-2 gap-x-4 gap-y-3 md:grid-cols-4">
            <Item label="申請した人">{approval.requested_by_name || "—"}</Item>
            <Item label="申請日時">
              <span className="num">{formatDateTimeJa(approval.requested_at)}</span>
            </Item>
            <Item label="滞留">
              <span className="num">{approval.waiting_days ?? 0} 日</span>
            </Item>
            <Item label="期限">
              <span className={cn("num", approval.is_overdue && "text-destructive")}>{dateText(approval.due_on)}</span>
            </Item>
          </dl>
          {approval.href && (
            <Link href={approval.href} className={cn(buttonVariants({ variant: "outline", size: "sm" }))}>
              対象を見る
              <ExternalLink className="h-4 w-4" />
            </Link>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>申請の内容</CardTitle>
        </CardHeader>
        <CardContent>
          {approval.detail ? (
            <p className="whitespace-pre-wrap break-words text-sm leading-relaxed">{approval.detail}</p>
          ) : (
            <p className="text-sm text-muted-foreground">くわしい説明は書かれていません。判断に足りなければ、申請した人に聞いてください。</p>
          )}
        </CardContent>
      </Card>

      {isPending ? (
        approval.can_decide === false ? (
          <Alert variant="warning">この申請はいまのあなたでは決裁できません（委任の期間・上限金額・種別を確認してください）。</Alert>
        ) : (
          <ApprovalDecideForm id={approval.id as string} title={approval.title ?? ""} />
        )
      ) : (
        <Card>
          <CardHeader>
            <CardTitle>決裁の記録</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <dl className="grid grid-cols-2 gap-x-4 gap-y-3 md:grid-cols-4">
              <Item label="決裁">{APPROVAL_STATUS_LABELS[status]}</Item>
              <Item label="決裁した人">
                {approval.decided_by_name || "—"}
                {approval.on_behalf_of && <span className="ml-1 text-xs text-muted-foreground">（代表の代わりに決裁）</span>}
              </Item>
              <Item label="決裁日時">
                <span className="num">{formatDateTimeJa(approval.decided_at)}</span>
              </Item>
            </dl>
            {approval.decision_note && (
              <div>
                <p className="text-xs text-muted-foreground">付記</p>
                <p className="mt-0.5 whitespace-pre-wrap break-words text-sm leading-relaxed">{approval.decision_note}</p>
              </div>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
