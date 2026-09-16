"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Ban, Mail, RefreshCw } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Empty } from "@/components/ui/empty";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { cancelInvitationAction, resendInvitationAction, type InvitationResult } from "@/lib/actions/users";
import { ROLE_LABELS, type Role } from "@/lib/db/types";
import { formatDateOnlyJa, formatDateTimeJa } from "@/lib/format";
import { cn } from "@/lib/utils";
import { ConfirmDialog } from "./confirm-dialog";
import { CopyLinkButton, InviteResultDialog } from "./invite-link";

export type InvitationStatus = "pending" | "expired" | "registered";

export interface InvitationRow {
  id: string;
  email: string;
  role: Role;
  displayName: string;
  driverName: string | null;
  createdAt: string;
  expiresAt: string;
  status: InvitationStatus;
  /** 招待リンク（owner のみ token を読める） */
  link: string;
}

function StatusBadge({ status }: { status: InvitationStatus }) {
  if (status === "expired") return <Badge variant="destructive">期限切れ</Badge>;
  if (status === "registered") return <Badge variant="secondary">登録済み・未ログイン</Badge>;
  return <Badge variant="warning">未受諾</Badge>;
}

export function InvitationsTable({ rows }: { rows: InvitationRow[] }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [cancelTarget, setCancelTarget] = useState<InvitationRow | null>(null);
  const [result, setResult] = useState<InvitationResult | null>(null);
  const [resultTitle, setResultTitle] = useState("招待リンク");

  const resend = (inv: InvitationRow, sendEmail: boolean) => {
    startTransition(async () => {
      const res = await resendInvitationAction(inv.id, sendEmail);
      if (res.ok) {
        setResultTitle(sendEmail ? "招待メールを再送しました" : "招待リンクを再発行しました");
        setResult(res.data);
        router.refresh();
      } else {
        toast.error(res.error);
      }
    });
  };

  const cancel = () => {
    if (!cancelTarget) return;
    const target = cancelTarget;
    startTransition(async () => {
      const res = await cancelInvitationAction(target.id);
      if (res.ok) {
        setCancelTarget(null);
        toast.success(res.message ?? "招待を取り消しました。");
        router.refresh();
      } else {
        toast.error(res.error);
      }
    });
  };

  const actions = (inv: InvitationRow) => (
    <div className="flex flex-wrap gap-1.5">
      {inv.status !== "expired" && <CopyLinkButton link={inv.link} />}
      <Button size="sm" variant="outline" onClick={() => resend(inv, true)} disabled={pending}>
        <Mail /> メールを再送
      </Button>
      <Button size="sm" variant="outline" onClick={() => resend(inv, false)} disabled={pending} title="新しい招待リンクを発行します（古いリンクは無効になります）">
        <RefreshCw /> リンクを再発行
      </Button>
      <Button size="sm" variant="ghost" className="text-destructive" onClick={() => setCancelTarget(inv)} disabled={pending}>
        <Ban /> 取り消し
      </Button>
    </div>
  );

  return (
    <>
      {rows.length === 0 ? (
        <Empty title="未受諾の招待はありません" description="「ユーザーを招待」から招待を作成できます。" />
      ) : (
        <>
          {/* スマホ：カード */}
          <div className="space-y-2 md:hidden">
            {rows.map((inv) => (
              <Card key={inv.id} className={cn("p-3", inv.status === "expired" && "bg-muted/40")}>
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="truncate font-semibold">{inv.email}</p>
                    {inv.displayName && <p className="truncate text-xs text-muted-foreground">{inv.displayName}</p>}
                  </div>
                  <StatusBadge status={inv.status} />
                </div>
                <dl className="mt-2 grid grid-cols-2 gap-x-3 gap-y-1 text-sm">
                  <dt className="text-muted-foreground">ロール</dt>
                  <dd className="text-right">
                    {ROLE_LABELS[inv.role]}
                    {inv.role === "driver" && inv.driverName ? `（${inv.driverName}）` : ""}
                  </dd>
                  <dt className="text-muted-foreground">作成日</dt>
                  <dd className="num text-right">{formatDateOnlyJa(inv.createdAt)}</dd>
                  <dt className="text-muted-foreground">期限</dt>
                  <dd className="num text-right">{formatDateTimeJa(inv.expiresAt)}</dd>
                </dl>
                <div className="mt-3">{actions(inv)}</div>
              </Card>
            ))}
          </div>

          {/* PC：表 */}
          <div className="hidden md:block">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>メール</TableHead>
                  <TableHead>ロール</TableHead>
                  <TableHead>表示名</TableHead>
                  <TableHead>作成日</TableHead>
                  <TableHead>期限</TableHead>
                  <TableHead>状態</TableHead>
                  <TableHead>操作</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((inv) => (
                  <TableRow key={inv.id} className={cn(inv.status === "expired" && "bg-muted/40 text-muted-foreground")}>
                    <TableCell className="max-w-[16rem] truncate" title={inv.email}>
                      {inv.email}
                    </TableCell>
                    <TableCell className="whitespace-nowrap">
                      {ROLE_LABELS[inv.role]}
                      {inv.role === "driver" && inv.driverName ? <span className="ml-1 text-xs text-muted-foreground">（{inv.driverName}）</span> : null}
                    </TableCell>
                    <TableCell>{inv.displayName || "—"}</TableCell>
                    <TableCell className="num whitespace-nowrap">{formatDateOnlyJa(inv.createdAt)}</TableCell>
                    <TableCell className="num whitespace-nowrap">{formatDateTimeJa(inv.expiresAt)}</TableCell>
                    <TableCell>
                      <StatusBadge status={inv.status} />
                    </TableCell>
                    <TableCell>{actions(inv)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </>
      )}

      <ConfirmDialog
        open={cancelTarget != null}
        onOpenChange={(o) => !o && setCancelTarget(null)}
        title="招待を取り消しますか？"
        description={cancelTarget ? `${cancelTarget.email} への招待リンクは使えなくなります。必要になったら改めて招待してください。` : undefined}
        confirmLabel="取り消す"
        destructive
        pending={pending}
        onConfirm={cancel}
      />

      <InviteResultDialog result={result} onClose={() => setResult(null)} title={resultTitle} />
    </>
  );
}
