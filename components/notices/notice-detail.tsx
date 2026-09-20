"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Pencil, TriangleAlert } from "lucide-react";
import { toast } from "sonner";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Money } from "@/components/ui/money";
import { setNoticeStatusAction } from "@/lib/actions/notices";
import { formatDateJa, formatMonthJa } from "@/lib/month";
import { noticeDiffSummaryText, noticeTotalMismatchText, type NoticeDiffSummary } from "@/lib/notices/diff";
import { toNoticeEditValues, type NoticeClientOption, type NoticeDiffItem, type NoticeItemOption, type NoticeListItem } from "@/lib/notices/view";
import { NOTICE_STATUS_LABELS, type NoticeStatus } from "@/lib/db/types";
import { NOTICE_STATUS_VALUES } from "@/lib/schemas/notices";
import { cn } from "@/lib/utils";
import { NoticeStatusBadge } from "./notice-badges";
import { NoticeDialog } from "./notice-dialog";
import { NoticeDiffTable } from "./notice-diff-table";
import { NoticeImportPanel } from "./notice-import-panel";

export interface NoticeDetailProps {
  notice: NoticeListItem;
  rows: NoticeDiffItem[];
  summary: NoticeDiffSummary;
  clients: NoticeClientOption[];
  itemOptions: NoticeItemOption[];
  canEdit: boolean;
}

/** 概要の 1 項目 */
function Item({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="mt-0.5 text-sm">{children}</dd>
    </div>
  );
}

export function NoticeDetail({ notice, rows, summary, clients, itemOptions, canEdit }: NoticeDetailProps) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [editing, setEditing] = useState(false);

  const hasDiff = Math.abs(notice.totalDiff) >= 1;
  const mismatch = noticeTotalMismatchText({
    total_amount: notice.totalAmount,
    our_bill: notice.ourBill,
    total_diff: notice.totalDiff,
    item_total: notice.itemTotal,
    item_count: notice.itemCount,
    unmatched_count: notice.unmatchedCount,
  });

  const changeStatus = (status: NoticeStatus) => {
    startTransition(async () => {
      const res = await setNoticeStatusAction({ id: notice.id, status });
      if (!res.ok) {
        toast.error(res.error);
        return;
      }
      toast.success(res.message ?? "状態を変更しました");
      router.refresh();
    });
  };

  return (
    <div className="space-y-4">
      <Card>
        <CardContent className="p-4">
          <div className="flex flex-wrap items-end justify-between gap-3">
            <div>
              <p className="text-xs text-muted-foreground">差額（通知 − 自社の売上）</p>
              <p className={cn("text-2xl font-bold", hasDiff && (notice.totalDiff > 0 ? "text-warning" : "text-destructive"))}>
                <Money value={notice.totalDiff} />
              </p>
              <p className="mt-1 text-xs text-muted-foreground">{noticeDiffSummaryText(summary)}</p>
            </div>
            <dl className="grid flex-1 grid-cols-2 gap-x-4 gap-y-2 md:grid-cols-4">
              <Item label="通知の合計（税抜）">
                <Money value={notice.totalAmount} />
              </Item>
              <Item label="消費税">
                <Money value={notice.taxAmount} />
              </Item>
              <Item label="自社の売上（税抜）">
                <Money value={notice.ourBill} />
              </Item>
              <Item label="明細の合計">
                <Money value={notice.itemTotal} />
              </Item>
            </dl>
          </div>
          <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-2 border-t pt-3 md:grid-cols-4">
            <Item label="稼動月">{notice.month ? formatMonthJa(notice.month) : "—"}</Item>
            <Item label="取引先">{notice.clientName || "指定なし"}</Item>
            <Item label="通知番号">{notice.noticeNo || "—"}</Item>
            <Item label="受領日">{notice.receivedOn ? formatDateJa(notice.receivedOn) : "—"}</Item>
          </dl>
          {notice.memo && <p className="mt-3 whitespace-pre-wrap break-words rounded-md bg-muted p-2 text-sm">{notice.memo}</p>}
        </CardContent>
      </Card>

      {mismatch && (
        <Alert variant="warning">
          <p className="flex items-center gap-2 text-sm font-semibold">
            <TriangleAlert className="h-4 w-4" aria-hidden /> 通知書の合計と明細の合計が合っていません
          </p>
          <p className="mt-1 text-sm">{mismatch}</p>
        </Alert>
      )}

      <Card>
        <CardContent className="flex flex-wrap items-center gap-2 p-4">
          <span className="text-sm text-muted-foreground">状態</span>
          <NoticeStatusBadge status={notice.status} />
          {canEdit && (
            <>
              <span className="mx-1 hidden text-muted-foreground sm:inline">|</span>
              {NOTICE_STATUS_VALUES.map((s) => (
                <Button
                  key={s}
                  size="sm"
                  variant={s === notice.status ? "default" : "outline"}
                  onClick={() => changeStatus(s)}
                  disabled={pending || s === notice.status}
                >
                  {NOTICE_STATUS_LABELS[s]}にする
                </Button>
              ))}
              <Button size="sm" variant="ghost" className="sm:ml-auto" onClick={() => setEditing(true)} disabled={pending}>
                <Pencil /> 通知書を編集
              </Button>
            </>
          )}
        </CardContent>
      </Card>

      {canEdit && <NoticeImportPanel noticeId={notice.id} itemCount={notice.itemCount} />}

      <NoticeDiffTable noticeId={notice.id} rows={rows} itemOptions={itemOptions} canEdit={canEdit} />

      <p className="text-xs text-muted-foreground">
        自社の売上は稼働（案件内容 × 稼動月）の受注単価 × 数量です。通知のほうが少ないときは、元請の数量や単価が古いままでないか確認してください。
      </p>

      {canEdit && (
        <NoticeDialog
          open={editing}
          onOpenChange={setEditing}
          notice={toNoticeEditValues(notice)}
          clients={clients}
          month={notice.month}
          redirectAfterDelete="/invoices/notices"
        />
      )}
    </div>
  );
}
