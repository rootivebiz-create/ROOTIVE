"use client";

import { useMemo, useState, useTransition } from "react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { toast } from "sonner";
import { Check, ChevronRight, ExternalLink, Stamp, X } from "lucide-react";
import { PageHeader } from "@/components/ui/page-header";
import { Alert } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button, buttonVariants } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Empty } from "@/components/ui/empty";
import { Label } from "@/components/ui/label";
import { Money } from "@/components/ui/money";
import { Textarea } from "@/components/ui/textarea";
import { decideApprovalAction } from "@/lib/actions/approvals";
import { APPROVAL_STATUS_LABELS, APPROVAL_URGENCY_LABELS, type ApprovalRow, type ApprovalStatus, type DelegationRow } from "@/lib/db/types";
import { formatDateTimeJa } from "@/lib/format";
import { cn } from "@/lib/utils";
import { APPROVAL_STATUS_BADGE, URGENCY_BADGE, dateText, delegationBannerText, delegationKindsText, kindLabel } from "./helpers";

/** 一覧のタブ（?status=） */
const TABS: { key: ApprovalStatus; label: string }[] = [
  { key: "pending", label: "決裁待ち" },
  { key: "approved", label: "承認" },
  { key: "rejected", label: "却下" },
  { key: "withdrawn", label: "取り下げ" },
];

export interface ApprovalsViewProps {
  /** すべての状態の申請（並べ替えは loadApprovals の sortApprovals が済ませている） */
  approvals: ApprovalRow[];
  /** 表示中のタブ */
  status: ApprovalStatus;
  /** いま有効な決裁の委任 */
  delegations: DelegationRow[];
}

export function ApprovalsView({ approvals, status, delegations }: ApprovalsViewProps) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const [pending, startTransition] = useTransition();
  const [busyId, setBusyId] = useState<string | null>(null);
  const [rejecting, setRejecting] = useState<ApprovalRow | null>(null);

  const counts = useMemo(() => {
    const out: Record<string, number> = {};
    for (const a of approvals) out[a.status ?? "pending"] = (out[a.status ?? "pending"] ?? 0) + 1;
    return out;
  }, [approvals]);

  const rows = useMemo(() => approvals.filter((a) => (a.status ?? "pending") === status), [approvals, status]);

  /** タブのリンク（?m などほかのパラメータは引き継ぐ） */
  const tabHref = (key: ApprovalStatus) => {
    const sp = new URLSearchParams(params.toString());
    sp.set("status", key);
    return `${pathname}?${sp.toString()}`;
  };

  const approve = (a: ApprovalRow) => {
    if (!a.id) return;
    setBusyId(a.id);
    startTransition(async () => {
      const res = await decideApprovalAction({ id: a.id as string, approve: true, note: "", as_decision: false });
      setBusyId(null);
      if (!res.ok) {
        toast.error(res.error);
        return;
      }
      toast.success(res.message ?? "承認しました");
      router.refresh();
    });
  };

  return (
    <div>
      <PageHeader
        title="決裁"
        description="管理者からの申請です。承認すると申請した人が続きを進めます。却下するときは理由を書いてください。"
      />

      {delegations.length > 0 && (
        <Alert variant="warning" className="mb-3">
          <p className="flex items-center gap-2 font-semibold">
            <Stamp className="h-4 w-4" />
            決裁を委任しています
          </p>
          <ul className="mt-1 space-y-0.5">
            {delegations.map((d) => (
              <li key={d.id}>
                {delegationBannerText(d)}（{delegationKindsText(d.kinds)}）
              </li>
            ))}
          </ul>
          <Link href="/executive/rules?tab=delegations" className="mt-1 inline-flex items-center gap-1 text-sm font-medium underline-offset-2 hover:underline">
            委任を見直す
            <ChevronRight className="h-4 w-4" />
          </Link>
        </Alert>
      )}

      {/* タブ（?status=）。スマホでは横スクロール */}
      <div className="mb-4 -mx-1 overflow-x-auto px-1 pb-1">
        <div className="inline-flex gap-1 rounded-md bg-muted p-1">
          {TABS.map((t) => (
            <Link
              key={t.key}
              href={tabHref(t.key)}
              aria-current={status === t.key ? "page" : undefined}
              className={cn(
                "inline-flex items-center gap-1 whitespace-nowrap rounded-sm px-3 py-1.5 text-sm font-medium text-muted-foreground transition-colors",
                status === t.key && "bg-card text-foreground shadow",
              )}
            >
              {t.label}
              {(counts[t.key] ?? 0) > 0 && <span className="num text-xs">({counts[t.key]})</span>}
            </Link>
          ))}
        </div>
      </div>

      {rows.length === 0 ? (
        status === "pending" ? (
          <Empty title="決裁待ちの申請はありません" description="管理者が高額の経費・単価の変更・締めた月の解除などを申請すると、ここに並びます。">
            <Check className="h-6 w-6 text-success" />
          </Empty>
        ) : (
          <Empty title={`${TABS.find((t) => t.key === status)?.label ?? ""}の申請はありません`} description="タブを切り替えるとほかの状態を確認できます。" />
        )
      ) : (
        <ul className="space-y-2">
          {rows.map((a) => {
            const busy = pending && busyId === a.id;
            const decidable = a.status === "pending" && a.can_decide !== false;
            return (
              <li key={a.id}>
                <Card className={cn(a.urgency === "overdue" && "border-destructive/40")}>
                  <CardContent className="space-y-2 p-3 md:p-4">
                    <div className="flex flex-wrap items-center gap-1.5">
                      <Badge variant={URGENCY_BADGE[a.urgency ?? "done"] ?? "secondary"}>{APPROVAL_URGENCY_LABELS[a.urgency ?? "done"] ?? "—"}</Badge>
                      <Badge variant="outline">{kindLabel(a.kind)}</Badge>
                      {a.status !== "pending" && <Badge variant={APPROVAL_STATUS_BADGE[a.status ?? "pending"]}>{APPROVAL_STATUS_LABELS[a.status ?? "pending"]}</Badge>}
                    </div>

                    <Link href={`/executive/approvals/${a.id}`} className="block break-words font-medium leading-snug hover:underline">
                      {a.title}
                    </Link>

                    {a.amount != null && (
                      <p className="text-lg font-semibold">
                        <Money value={a.amount} />
                      </p>
                    )}

                    <dl className="grid grid-cols-2 gap-x-3 gap-y-1 text-sm">
                      <dt className="text-muted-foreground">申請した人</dt>
                      <dd className="break-words text-right">{a.requested_by_name || "—"}</dd>
                      <dt className="text-muted-foreground">申請日時</dt>
                      <dd className="num text-right">{formatDateTimeJa(a.requested_at)}</dd>
                      <dt className="text-muted-foreground">滞留</dt>
                      <dd className="num text-right">{a.waiting_days ?? 0} 日</dd>
                      <dt className="text-muted-foreground">期限</dt>
                      <dd className={cn("num text-right", a.is_overdue && "text-destructive")}>{dateText(a.due_on)}</dd>
                    </dl>

                    {a.status !== "pending" && a.decided_by_name && (
                      <p className="text-xs text-muted-foreground">
                        {a.decided_by_name} が {formatDateTimeJa(a.decided_at)} に決裁{a.on_behalf_of ? "（代表の代わりに決裁）" : ""}
                        {a.decision_note ? ` / ${a.decision_note}` : ""}
                      </p>
                    )}

                    <div className="flex flex-wrap items-center gap-2 pt-1">
                      {decidable && (
                        <>
                          <Button className="flex-1 md:flex-none" onClick={() => approve(a)} disabled={pending} aria-busy={busy}>
                            <Check /> 承認
                          </Button>
                          <Button variant="outline" className="flex-1 md:flex-none" onClick={() => setRejecting(a)} disabled={pending}>
                            <X /> 却下
                          </Button>
                        </>
                      )}
                      <Link href={`/executive/approvals/${a.id}`} className={cn(buttonVariants({ variant: "ghost", size: "sm" }), "ml-auto")}>
                        くわしく見る
                        <ChevronRight className="h-4 w-4" />
                      </Link>
                      {a.href && (
                        <Link href={a.href} className={cn(buttonVariants({ variant: "ghost", size: "sm" }))}>
                          対象を見る
                          <ExternalLink className="h-4 w-4" />
                        </Link>
                      )}
                    </div>
                  </CardContent>
                </Card>
              </li>
            );
          })}
        </ul>
      )}

      <RejectDialog approval={rejecting} onOpenChange={(v) => !v && setRejecting(null)} />
    </div>
  );
}

/** 却下の理由（必須）を書くダイアログ。スマホでは下から全幅シート */
function RejectDialog({ approval, onOpenChange }: { approval: ApprovalRow | null; onOpenChange: (open: boolean) => void }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [note, setNote] = useState("");

  const submit = () => {
    if (!approval?.id) return;
    if (note.trim() === "") {
      toast.error("却下するときは理由を入れてください");
      return;
    }
    startTransition(async () => {
      const res = await decideApprovalAction({ id: approval.id as string, approve: false, note, as_decision: false });
      if (!res.ok) {
        toast.error(res.error);
        return;
      }
      toast.success(res.message ?? "却下しました");
      setNote("");
      router.refresh();
      onOpenChange(false);
    });
  };

  return (
    <Dialog
      open={approval != null}
      onOpenChange={(v) => {
        if (!v) setNote("");
        onOpenChange(v);
      }}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>却下する</DialogTitle>
          <DialogDescription>{approval?.title ?? ""}</DialogDescription>
        </DialogHeader>
        <div className="space-y-1.5">
          <Label htmlFor="reject-note">却下の理由（必須）</Label>
          <Textarea
            id="reject-note"
            value={note}
            onChange={(e) => setNote(e.target.value)}
            rows={3}
            placeholder="例: 今期は見送ります。来月の資金繰りを見てからもう一度お願いします。"
            disabled={pending}
            aria-invalid={note.trim() === ""}
          />
          <p className="text-xs text-muted-foreground">申請した人にそのまま伝わります。</p>
        </div>
        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={pending}>
            キャンセル
          </Button>
          <Button type="button" variant="destructive" onClick={submit} disabled={pending}>
            {pending ? "送信中…" : "却下する"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
