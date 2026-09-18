"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { ArrowDown, ArrowUp, Pencil, Plus } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Empty } from "@/components/ui/empty";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { ClientDialog } from "@/components/settings/clients/client-dialog";
import { reorderClientsAction } from "@/lib/actions/clients";
import type { Client } from "@/lib/db/types";
import { paymentRuleLabel } from "@/lib/schemas/clients";
import { cn } from "@/lib/utils";

/** 取引先マスタの一覧（スマホ：カード／PC：表）と追加・編集ダイアログ */
export function ClientsTable({ rows, canEdit }: { rows: Client[]; canEdit: boolean }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<Client | null>(null);

  const openNew = () => {
    setEditing(null);
    setOpen(true);
  };
  const openEdit = (c: Client) => {
    if (!canEdit) return;
    setEditing(c);
    setOpen(true);
  };
  const move = (id: string, direction: "up" | "down") =>
    startTransition(async () => {
      const res = await reorderClientsAction({ id, direction });
      if (!res.ok) toast.error(res.error);
      else router.refresh();
    });

  const reorderButtons = (c: Client, i: number) =>
    canEdit ? (
      <div className="flex shrink-0 items-center gap-0.5 md:flex-col">
        <Button
          variant="ghost"
          size="icon"
          className="h-7 w-7"
          aria-label={`${c.name} を上へ`}
          disabled={pending || i === 0}
          onClick={(e) => {
            e.stopPropagation();
            move(c.id, "up");
          }}
        >
          <ArrowUp />
        </Button>
        <Button
          variant="ghost"
          size="icon"
          className="h-7 w-7"
          aria-label={`${c.name} を下へ`}
          disabled={pending || i === rows.length - 1}
          onClick={(e) => {
            e.stopPropagation();
            move(c.id, "down");
          }}
        >
          <ArrowDown />
        </Button>
      </div>
    ) : null;

  const statusBadge = (c: Client) => (c.is_active ? <Badge variant="success">有効</Badge> : <Badge variant="secondary">停止中</Badge>);

  return (
    <>
      {canEdit && (
        <div className="mb-3 flex justify-end">
          <Button onClick={openNew} disabled={pending}>
            <Plus /> 取引先を追加
          </Button>
        </div>
      )}

      {rows.length === 0 ? (
        <Empty title="取引先が登録されていません" description={canEdit ? "「取引先を追加」から登録してください。案件に取引先を設定すると、請求書を作成できます。" : undefined} />
      ) : (
        <>
          {/* スマホ：カード */}
          <div className="space-y-2 md:hidden">
            {rows.map((c, i) => (
              <Card
                key={c.id}
                className={cn("p-3", !c.is_active && "bg-muted/40 text-muted-foreground")}
                onClick={() => openEdit(c)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") openEdit(c);
                }}
                role={canEdit ? "button" : undefined}
                tabIndex={canEdit ? 0 : undefined}
              >
                <div className="flex items-start gap-2">
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-semibold">
                        {c.name} <span className="text-xs font-normal text-muted-foreground">{c.honorific}</span>
                      </span>
                      {statusBadge(c)}
                    </div>
                    <dl className="mt-2 grid grid-cols-2 gap-x-3 gap-y-1 text-sm">
                      <dt className="text-muted-foreground">入金予定日</dt>
                      <dd className="text-right">{paymentRuleLabel(c.payment_month_offset, c.payment_day)}</dd>
                      <dt className="text-muted-foreground">登録番号</dt>
                      <dd className="truncate text-right">{c.invoice_reg_no || "—"}</dd>
                      {c.tel && (
                        <>
                          <dt className="text-muted-foreground">電話</dt>
                          <dd className="text-right">{c.tel}</dd>
                        </>
                      )}
                    </dl>
                    {c.address && <p className="mt-1 truncate text-xs text-muted-foreground">{c.address}</p>}
                    {c.memo && <p className="mt-1 truncate text-xs text-muted-foreground">{c.memo}</p>}
                  </div>
                  {reorderButtons(c, i)}
                  {canEdit && <Pencil className="mt-1 h-4 w-4 shrink-0 text-muted-foreground" />}
                </div>
              </Card>
            ))}
          </div>

          {/* PC：表 */}
          <div className="hidden md:block">
            <Table>
              <TableHeader>
                <TableRow>
                  {canEdit && <TableHead className="w-10">並び</TableHead>}
                  <TableHead>取引先</TableHead>
                  <TableHead>入金予定日</TableHead>
                  <TableHead>登録番号</TableHead>
                  <TableHead>住所・電話</TableHead>
                  <TableHead>備考</TableHead>
                  <TableHead>状態</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((c, i) => (
                  <TableRow key={c.id} className={cn(canEdit && "cursor-pointer", !c.is_active && "bg-muted/40 text-muted-foreground")} onClick={() => openEdit(c)}>
                    {canEdit && <TableCell className="px-0">{reorderButtons(c, i)}</TableCell>}
                    <TableCell>
                      <span className="font-medium">{c.name}</span>
                      <span className="ml-1 text-xs text-muted-foreground">{c.honorific}</span>
                    </TableCell>
                    <TableCell className="whitespace-nowrap">{paymentRuleLabel(c.payment_month_offset, c.payment_day)}</TableCell>
                    <TableCell className="whitespace-nowrap text-xs">{c.invoice_reg_no || "—"}</TableCell>
                    <TableCell className="max-w-[14rem] truncate text-xs text-muted-foreground">
                      {c.address}
                      {c.address && c.tel ? " / " : ""}
                      {c.tel}
                    </TableCell>
                    <TableCell className="max-w-[12rem] truncate text-xs text-muted-foreground">{c.memo}</TableCell>
                    <TableCell>{statusBadge(c)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </>
      )}

      {canEdit && <ClientDialog open={open} onOpenChange={setOpen} client={editing} />}
    </>
  );
}
