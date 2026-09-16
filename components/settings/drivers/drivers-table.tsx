"use client";

import { useTransition } from "react";
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
import { reorderDriversAction } from "@/lib/actions/drivers";
import { ROUNDING_LABELS, type RoundingMode } from "@/lib/calc/types";
import { pct } from "@/lib/format";
import { useMonth } from "@/lib/hooks/use-month";
import { cn } from "@/lib/utils";

export interface DriverListRow {
  id: string;
  name: string;
  kana: string;
  is_active: boolean;
  royalty_rate: number | null;
  mgmt_fee: number;
  rounding_mode: RoundingMode | null;
  memo: string;
  overrideCount: number;
  recurringCount: number;
}

/** 会社の既定値（null のときに併記する） */
export interface CompanyDefaults {
  default_royalty_rate: number;
  default_mgmt_fee: number;
  rounding_mode: RoundingMode;
}

export function royaltyLabel(rate: number | null, defaults: CompanyDefaults): string {
  return rate == null ? `会社設定（${pct(defaults.default_royalty_rate)}）` : pct(rate);
}

export function roundingLabel(mode: RoundingMode | null, defaults: CompanyDefaults): string {
  return mode == null ? `会社設定（${ROUNDING_LABELS[defaults.rounding_mode]}）` : ROUNDING_LABELS[mode];
}

export function DriversTable({ rows, defaults, canEdit }: { rows: DriverListRow[]; defaults: CompanyDefaults; canEdit: boolean }) {
  const router = useRouter();
  const { href } = useMonth();
  const [pending, startTransition] = useTransition();

  const detailHref = (id: string) => href(`/settings/drivers/${id}`);
  const open = (id: string) => router.push(detailHref(id));
  const move = (id: string, direction: "up" | "down") =>
    startTransition(async () => {
      const res = await reorderDriversAction({ id, direction });
      if (!res.ok) toast.error(res.error);
      else router.refresh();
    });

  if (rows.length === 0) {
    return <Empty title="ドライバーが登録されていません" description={canEdit ? "「ドライバーを追加」から登録してください。" : undefined} />;
  }

  const reorderButtons = (r: DriverListRow, i: number) =>
    canEdit ? (
      <div className="flex shrink-0 items-center gap-0.5 md:flex-col">
        <Button
          variant="ghost"
          size="icon"
          className="h-7 w-7"
          aria-label={`${r.name} を上へ`}
          disabled={pending || i === 0}
          onClick={(e) => {
            e.stopPropagation();
            move(r.id, "up");
          }}
        >
          <ArrowUp />
        </Button>
        <Button
          variant="ghost"
          size="icon"
          className="h-7 w-7"
          aria-label={`${r.name} を下へ`}
          disabled={pending || i === rows.length - 1}
          onClick={(e) => {
            e.stopPropagation();
            move(r.id, "down");
          }}
        >
          <ArrowDown />
        </Button>
      </div>
    ) : null;

  const statusBadge = (r: DriverListRow) => (r.is_active ? <Badge variant="success">稼働中</Badge> : <Badge variant="secondary">停止中</Badge>);

  return (
    <>
      {/* スマホ：カード */}
      <div className="space-y-2 md:hidden">
        {rows.map((r, i) => (
          <Card key={r.id} className={cn("p-3", !r.is_active && "bg-muted/40 text-muted-foreground")} onClick={() => open(r.id)} onKeyDown={(e) => { if (e.key === "Enter") open(r.id); }} role="link" tabIndex={0}>
            <div className="flex items-start gap-2">
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <Link href={detailHref(r.id)} className="font-semibold" onClick={(e) => e.stopPropagation()}>
                    {r.name}
                  </Link>
                  {r.kana && <span className="text-xs text-muted-foreground">{r.kana}</span>}
                  {statusBadge(r)}
                </div>
                <dl className="mt-2 grid grid-cols-2 gap-x-3 gap-y-1 text-sm">
                  <dt className="text-muted-foreground">ロイヤリティ率</dt>
                  <dd className="num">{royaltyLabel(r.royalty_rate, defaults)}</dd>
                  <dt className="text-muted-foreground">管理費</dt>
                  <dd className="text-right">
                    <Money value={r.mgmt_fee} />
                  </dd>
                  <dt className="text-muted-foreground">端数処理</dt>
                  <dd className="text-right">{roundingLabel(r.rounding_mode, defaults)}</dd>
                  <dt className="text-muted-foreground">個別単価</dt>
                  <dd className="text-right">{r.overrideCount > 0 ? `${r.overrideCount} 件` : "—"}</dd>
                  <dt className="text-muted-foreground">固定控除</dt>
                  <dd className="text-right">{r.recurringCount > 0 ? `${r.recurringCount} 件` : "—"}</dd>
                </dl>
                {r.memo && <p className="mt-1 truncate text-xs text-muted-foreground">{r.memo}</p>}
              </div>
              {reorderButtons(r, i)}
              <ChevronRight className="mt-1 h-5 w-5 shrink-0 text-muted-foreground" />
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
              <TableHead>名前</TableHead>
              <TableHead className="text-right">ロイヤリティ率</TableHead>
              <TableHead className="text-right">管理費</TableHead>
              <TableHead>端数処理</TableHead>
              <TableHead className="text-right">個別単価</TableHead>
              <TableHead className="text-right">固定控除</TableHead>
              <TableHead>備考</TableHead>
              <TableHead>状態</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((r, i) => (
              <TableRow key={r.id} className={cn("cursor-pointer", !r.is_active && "bg-muted/40 text-muted-foreground")} onClick={() => open(r.id)}>
                {canEdit && <TableCell className="px-0">{reorderButtons(r, i)}</TableCell>}
                <TableCell>
                  <Link href={detailHref(r.id)} className="font-medium hover:underline" onClick={(e) => e.stopPropagation()}>
                    {r.name}
                  </Link>
                  {r.kana && <span className="ml-2 text-xs text-muted-foreground">{r.kana}</span>}
                </TableCell>
                <TableCell className="num">{royaltyLabel(r.royalty_rate, defaults)}</TableCell>
                <TableCell className="text-right">
                  <Money value={r.mgmt_fee} />
                </TableCell>
                <TableCell className="whitespace-nowrap">{roundingLabel(r.rounding_mode, defaults)}</TableCell>
                <TableCell className="num">{r.overrideCount > 0 ? `${r.overrideCount} 件` : "—"}</TableCell>
                <TableCell className="num">{r.recurringCount > 0 ? `${r.recurringCount} 件` : "—"}</TableCell>
                <TableCell className="max-w-[16rem] truncate text-xs text-muted-foreground">{r.memo}</TableCell>
                <TableCell>{statusBadge(r)}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </>
  );
}
