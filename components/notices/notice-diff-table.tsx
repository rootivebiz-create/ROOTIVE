"use client";

import { Fragment, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { ListChecks, Plus, Wand2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Empty } from "@/components/ui/empty";
import { Money, Qty } from "@/components/ui/money";
import { Select } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { matchNoticeItemsAction, saveNoticeItemAction } from "@/lib/actions/notices";
import { noticeDiffTone } from "@/lib/notices/diff";
import { groupItemOptions, type NoticeDiffItem, type NoticeItemOption } from "@/lib/notices/view";
import { cn } from "@/lib/utils";
import { NoticeDiffBadge } from "./notice-badges";
import { NoticeItemDialog } from "./notice-item-dialog";

export interface NoticeDiffTableProps {
  noticeId: string;
  rows: NoticeDiffItem[];
  itemOptions: NoticeItemOption[];
  canEdit: boolean;
}

/** 案件内容を選ぶプルダウン（選んだらその場で保存する） */
function ItemSelect({
  row,
  options,
  disabled,
  onChange,
}: {
  row: NoticeDiffItem;
  options: NoticeItemOption[];
  disabled: boolean;
  onChange: (row: NoticeDiffItem, projectItemId: string) => void;
}) {
  const groups = groupItemOptions(options);
  return (
    <Select
      value={row.projectItemId}
      onChange={(e) => onChange(row, e.target.value)}
      disabled={disabled}
      aria-label={`${row.rawName} の案件内容`}
      className="h-9 min-w-[10rem] text-sm"
    >
      <option value="">（未紐づけ）</option>
      {groups.map((g) => (
        <optgroup key={g.projectId} label={g.projectName}>
          {g.items.map((o) => (
            <option key={o.id} value={o.id}>
              {o.name}
              {o.isActive ? "" : "（停止中）"}
            </option>
          ))}
        </optgroup>
      ))}
    </Select>
  );
}

export function NoticeDiffTable({ noticeId, rows, itemOptions, canEdit }: NoticeDiffTableProps) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [editing, setEditing] = useState<NoticeDiffItem | null>(null);
  const [adding, setAdding] = useState(false);

  const link = (row: NoticeDiffItem, projectItemId: string) => {
    startTransition(async () => {
      const res = await saveNoticeItemAction({
        id: row.id,
        notice_id: noticeId,
        project_item_id: projectItemId,
        raw_name: row.rawName,
        qty: String(row.noticeQty),
        unit_price: String(row.noticeUnitPrice),
        amount: String(row.noticeAmount),
        memo: row.memo,
      });
      if (!res.ok) {
        toast.error(res.error);
        return;
      }
      toast.success(projectItemId ? "案件内容を紐づけました" : "紐づけを外しました");
      router.refresh();
    });
  };

  const autoMatch = () => {
    startTransition(async () => {
      const res = await matchNoticeItemsAction(noticeId);
      if (!res.ok) {
        toast.error(res.error);
        return;
      }
      if (res.data.matched > 0) toast.success(`${res.data.matched} 行に案件内容を紐づけました。`);
      else toast.info("名前が一致する案件内容は見つかりませんでした。プルダウンから選んでください。");
      router.refresh();
    });
  };

  const unmatched = rows.filter((r) => r.diffStatus === "unmatched").length;

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm text-muted-foreground">
          明細 <span className="num font-semibold text-foreground">{rows.length}</span> 件
          {unmatched > 0 && <span className="text-destructive">／案件内容が未紐づけ {unmatched} 件</span>}
        </p>
        {canEdit && (
          <div className="flex flex-wrap gap-2">
            <Button size="sm" variant="outline" onClick={autoMatch} disabled={pending || rows.length === 0}>
              <Wand2 /> 名前で自動紐づけ
            </Button>
            <Button size="sm" variant="outline" onClick={() => setAdding(true)} disabled={pending}>
              <Plus /> 明細を追加
            </Button>
          </div>
        )}
      </div>

      {rows.length === 0 ? (
        <Empty title="明細がまだありません" description="支払明細書の CSV を選ぶか、表を貼り付けて取り込んでください。1 行ずつ手で足すこともできます。">
          <ListChecks className="h-6 w-6 text-muted-foreground" aria-hidden />
        </Empty>
      ) : (
        <>
          {/* スマホ：カード表示 */}
          <ul className="space-y-2 md:hidden">
            {rows.map((row) => {
              const tone = noticeDiffTone(row.diffStatus);
              return (
                <li key={row.id} className={cn("rounded-lg border bg-card p-3 shadow-sm", tone.attention && "border-destructive/40")}>
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="break-words font-medium">{row.rawName}</p>
                      <p className="break-words text-xs text-muted-foreground">
                        {row.itemName ? `${row.projectName} / ${row.itemName}` : "案件内容は未紐づけ"}
                      </p>
                    </div>
                    <NoticeDiffBadge status={row.diffStatus} />
                  </div>
                  <dl className="mt-2 grid grid-cols-2 gap-x-3 gap-y-1 text-sm">
                    <dt className="text-muted-foreground">通知（数量 × 単価）</dt>
                    <dd className="text-right">
                      <Qty value={row.noticeQty} /> × <Money value={row.noticeUnitPrice} />
                    </dd>
                    <dt className="text-muted-foreground">通知の金額</dt>
                    <dd className="text-right">
                      <Money value={row.noticeAmount} />
                    </dd>
                    <dt className="text-muted-foreground">自社（数量 × 単価）</dt>
                    <dd className="text-right">
                      <Qty value={row.ourQty} /> × {row.ourUnitPrice == null ? "—" : <Money value={row.ourUnitPrice} />}
                    </dd>
                    <dt className="text-muted-foreground">自社の金額</dt>
                    <dd className="text-right">
                      <Money value={row.ourAmount} />
                    </dd>
                    <dt className="text-muted-foreground">差</dt>
                    <dd className="text-right">
                      <Money value={row.amountDiff} className={cn(tone.attention && "font-semibold")} />
                    </dd>
                  </dl>
                  <p className="mt-2 text-xs text-muted-foreground">{row.explanation}</p>
                  {canEdit && (
                    <div className="mt-2 space-y-2">
                      <ItemSelect row={row} options={itemOptions} disabled={pending} onChange={link} />
                      <Button size="sm" variant="ghost" onClick={() => setEditing(row)} disabled={pending}>
                        明細を編集
                      </Button>
                    </div>
                  )}
                </li>
              );
            })}
          </ul>

          {/* PC：一覧表 */}
          <div className="hidden md:block">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>内容</TableHead>
                  <TableHead className="text-right">通知の数量</TableHead>
                  <TableHead className="text-right">通知の単価</TableHead>
                  <TableHead className="text-right">通知の金額</TableHead>
                  <TableHead className="text-right">自社の数量</TableHead>
                  <TableHead className="text-right">自社の単価</TableHead>
                  <TableHead className="text-right">自社の金額</TableHead>
                  <TableHead className="text-right">差</TableHead>
                  <TableHead>判定</TableHead>
                  {canEdit && <TableHead className="text-right">操作</TableHead>}
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((row) => {
                  const tone = noticeDiffTone(row.diffStatus);
                  return (
                    <Fragment key={row.id}>
                      <TableRow className={cn(tone.attention && "bg-destructive/5", "border-b-0")}>
                        <TableCell className="max-w-[16rem] break-words">
                          <span className="font-medium">{row.rawName}</span>
                          <span className="block text-xs text-muted-foreground">
                            {row.itemName ? `→ ${row.projectName} / ${row.itemName}` : "→ 未紐づけ"}
                          </span>
                        </TableCell>
                        <TableCell className="text-right">
                          <Qty value={row.noticeQty} />
                        </TableCell>
                        <TableCell className="text-right">
                          <Money value={row.noticeUnitPrice} />
                        </TableCell>
                        <TableCell className="text-right">
                          <Money value={row.noticeAmount} />
                        </TableCell>
                        <TableCell className="text-right">
                          <Qty value={row.ourQty} />
                        </TableCell>
                        <TableCell className="num text-right">{row.ourUnitPrice == null ? "—" : <Money value={row.ourUnitPrice} />}</TableCell>
                        <TableCell className="text-right">
                          <Money value={row.ourAmount} />
                        </TableCell>
                        <TableCell className="text-right">
                          <Money value={row.amountDiff} className={cn(tone.attention && "font-semibold")} />
                        </TableCell>
                        <TableCell className="whitespace-nowrap">
                          <NoticeDiffBadge status={row.diffStatus} />
                        </TableCell>
                        {canEdit && (
                          <TableCell className="whitespace-nowrap text-right">
                            <span className="inline-flex items-center gap-1">
                              <ItemSelect row={row} options={itemOptions} disabled={pending} onChange={link} />
                              <Button size="sm" variant="ghost" onClick={() => setEditing(row)} disabled={pending}>
                                編集
                              </Button>
                            </span>
                          </TableCell>
                        )}
                      </TableRow>
                      <TableRow className={cn(tone.attention && "bg-destructive/5")}>
                        <TableCell colSpan={canEdit ? 10 : 9} className="pt-0 text-xs text-muted-foreground">
                          {row.explanation}
                        </TableCell>
                      </TableRow>
                    </Fragment>
                  );
                })}
              </TableBody>
            </Table>
          </div>
        </>
      )}

      {canEdit && (
        <>
          <NoticeItemDialog open={editing != null} onOpenChange={(open) => !open && setEditing(null)} noticeId={noticeId} item={editing} itemOptions={itemOptions} />
          <NoticeItemDialog open={adding} onOpenChange={setAdding} noticeId={noticeId} item={null} itemOptions={itemOptions} />
        </>
      )}
    </div>
  );
}
