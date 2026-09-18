"use client";

import { Fragment, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowDown, ArrowUp, ChevronRight } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Empty } from "@/components/ui/empty";
import { Money } from "@/components/ui/money";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { reorderProjectsAction } from "@/lib/actions/projects";
import { subMoney } from "@/lib/calc/money";
import { UNIT_LABELS, type Unit } from "@/lib/calc/types";
import { useMonth } from "@/lib/hooks/use-month";
import { cn } from "@/lib/utils";

export interface ProjectListItem {
  id: string;
  name: string;
  unit: Unit;
  bill_rate: number;
  pay_rate: number;
  is_active: boolean;
}

export interface ProjectListRow {
  id: string;
  name: string;
  client_name: string;
  is_active: boolean;
  memo: string;
  items: ProjectListItem[];
}

export function ProjectsTable({ rows, canEdit }: { rows: ProjectListRow[]; canEdit: boolean }) {
  const router = useRouter();
  const { href } = useMonth();
  const [pending, startTransition] = useTransition();

  const detailHref = (id: string) => href(`/settings/projects/${id}`);
  const open = (id: string) => router.push(detailHref(id));
  const move = (id: string, direction: "up" | "down") =>
    startTransition(async () => {
      const res = await reorderProjectsAction({ id, direction });
      if (!res.ok) toast.error(res.error);
      else router.refresh();
    });

  if (rows.length === 0) {
    return <Empty title="案件が登録されていません" description={canEdit ? "「案件を追加」から登録してください。" : undefined} />;
  }

  const reorderButtons = (p: ProjectListRow, i: number) =>
    canEdit ? (
      <div className="flex shrink-0 items-center gap-0.5 md:flex-col">
        <Button
          variant="ghost"
          size="icon"
          className="h-7 w-7"
          aria-label={`${p.name} を上へ`}
          disabled={pending || i === 0}
          onClick={(e) => {
            e.stopPropagation();
            move(p.id, "up");
          }}
        >
          <ArrowUp />
        </Button>
        <Button
          variant="ghost"
          size="icon"
          className="h-7 w-7"
          aria-label={`${p.name} を下へ`}
          disabled={pending || i === rows.length - 1}
          onClick={(e) => {
            e.stopPropagation();
            move(p.id, "down");
          }}
        >
          <ArrowDown />
        </Button>
      </div>
    ) : null;

  const projectBadge = (p: ProjectListRow) => (p.is_active ? <Badge variant="success">稼働中</Badge> : <Badge variant="secondary">停止中</Badge>);
  const itemBadge = (it: ProjectListItem) => (it.is_active ? <Badge variant="outline">有効</Badge> : <Badge variant="secondary">停止中</Badge>);

  return (
    <>
      {/* スマホ：カード */}
      <div className="space-y-2 md:hidden">
        {rows.map((p, i) => (
          <Card key={p.id} className={cn("p-3", !p.is_active && "bg-muted/40 text-muted-foreground")} onClick={() => open(p.id)} onKeyDown={(e) => { if (e.key === "Enter") open(p.id); }} role="link" tabIndex={0}>
            <div className="flex items-start gap-2">
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <Link href={detailHref(p.id)} className="font-semibold" onClick={(e) => e.stopPropagation()}>
                    {p.name}
                  </Link>
                  {projectBadge(p)}
                </div>
                {p.client_name && <p className="text-xs text-muted-foreground">{p.client_name}</p>}
                <ul className="mt-2 divide-y rounded-md border text-sm">
                  {p.items.length === 0 && <li className="p-2 text-xs text-muted-foreground">内容が登録されていません</li>}
                  {p.items.map((it) => {
                    const diff = subMoney(it.bill_rate, it.pay_rate);
                    return (
                      <li key={it.id} className={cn("space-y-1 p-2", !it.is_active && "text-muted-foreground")}>
                        <div className="flex flex-wrap items-center gap-1.5">
                          <span className="font-medium">{it.name}</span>
                          <Badge variant="outline">{UNIT_LABELS[it.unit]}</Badge>
                          {!it.is_active && <Badge variant="secondary">停止中</Badge>}
                        </div>
                        <dl className="grid grid-cols-3 gap-1 text-xs">
                          <div>
                            <dt className="text-muted-foreground">受注</dt>
                            <dd>
                              <Money value={it.bill_rate} />
                            </dd>
                          </div>
                          <div>
                            <dt className="text-muted-foreground">支払</dt>
                            <dd>
                              <Money value={it.pay_rate} />
                            </dd>
                          </div>
                          <div>
                            <dt className="text-muted-foreground">差額</dt>
                            <dd>
                              <Money value={diff} />
                            </dd>
                          </div>
                        </dl>
                      </li>
                    );
                  })}
                </ul>
              </div>
              {reorderButtons(p, i)}
              <ChevronRight className="mt-1 h-5 w-5 shrink-0 text-muted-foreground" />
            </div>
          </Card>
        ))}
      </div>

      {/* PC：表（案件ごとに内容行を展開） */}
      <div className="hidden md:block">
        <Table>
          <TableHeader>
            <TableRow>
              {canEdit && <TableHead className="w-10">並び</TableHead>}
              <TableHead>案件</TableHead>
              <TableHead>取引先</TableHead>
              <TableHead>内容</TableHead>
              <TableHead>区分</TableHead>
              <TableHead className="text-right">受注単価</TableHead>
              <TableHead className="text-right">支払単価</TableHead>
              <TableHead className="text-right">差額</TableHead>
              <TableHead>状態</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((p, i) => {
              const span = Math.max(p.items.length, 1);
              const projectCells = (
                <>
                  {canEdit && (
                    <TableCell className="px-0 align-top" rowSpan={span}>
                      {reorderButtons(p, i)}
                    </TableCell>
                  )}
                  <TableCell className="align-top" rowSpan={span}>
                    <Link href={detailHref(p.id)} className="font-medium hover:underline" onClick={(e) => e.stopPropagation()}>
                      {p.name}
                    </Link>
                    <div className="mt-1">{projectBadge(p)}</div>
                  </TableCell>
                  <TableCell className="align-top text-muted-foreground" rowSpan={span}>
                    {p.client_name || "—"}
                  </TableCell>
                </>
              );
              if (p.items.length === 0) {
                return (
                  <TableRow key={p.id} className={cn("cursor-pointer", !p.is_active && "bg-muted/40 text-muted-foreground")} onClick={() => open(p.id)}>
                    {projectCells}
                    <TableCell colSpan={6} className="text-xs text-muted-foreground">
                      内容が登録されていません
                    </TableCell>
                  </TableRow>
                );
              }
              return (
                <Fragment key={p.id}>
                  {p.items.map((it, j) => {
                    const diff = subMoney(it.bill_rate, it.pay_rate);
                    return (
                      <TableRow
                        key={it.id}
                        className={cn("cursor-pointer", (!p.is_active || !it.is_active) && "bg-muted/40 text-muted-foreground")}
                        onClick={() => open(p.id)}
                      >
                        {j === 0 && projectCells}
                        <TableCell>{it.name}</TableCell>
                        <TableCell>{UNIT_LABELS[it.unit]}</TableCell>
                        <TableCell className="text-right">
                          <Money value={it.bill_rate} />
                        </TableCell>
                        <TableCell className="text-right">
                          <Money value={it.pay_rate} />
                        </TableCell>
                        <TableCell className="text-right">
                          <Money value={diff} />
                        </TableCell>
                        <TableCell>{itemBadge(it)}</TableCell>
                      </TableRow>
                    );
                  })}
                </Fragment>
              );
            })}
          </TableBody>
        </Table>
      </div>
    </>
  );
}
