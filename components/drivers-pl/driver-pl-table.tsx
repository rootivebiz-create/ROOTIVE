"use client";

import { Check, ChevronRight } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Empty } from "@/components/ui/empty";
import { Money, Pct, Qty } from "@/components/ui/money";
import { Table, TableBody, TableCell, TableFooter, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { cn } from "@/lib/utils";
import type { DriverPlRow, DriverPlTotals } from "./helpers";

function OwnerBadge({ row }: { row: DriverPlRow }) {
  if (!row.isOwner) return null;
  return (
    <Badge variant="secondary" title="支払単価 0 の稼働だけのため、利益率は 100% になります">
      役員
    </Badge>
  );
}

/** 1 稼働あたりの利益（数量 > 0 の行が無ければ「—」） */
function PerEntry({ value }: { value: number | null }) {
  if (value == null) return <span className="num text-muted-foreground">—</span>;
  return <Money value={value} />;
}

export interface DriverPlTableProps {
  rows: DriverPlRow[];
  totals: DriverPlTotals;
  selectedId: string;
  onSelect: (driverId: string) => void;
  emptyDescription: string;
}

/** ドライバー別の採算（会社利益の多い順）。スマホはカード、PC は表。行を選ぶと下の詳細が切り替わる */
export function DriverPlTable({ rows, totals, selectedId, onSelect, emptyDescription }: DriverPlTableProps) {
  if (rows.length === 0) {
    return (
      <div className="px-4 pb-4">
        <Empty title="表示できるドライバーがいません" description={emptyDescription} />
      </div>
    );
  }

  return (
    <>
      {/* スマホ：カード */}
      <ul className="space-y-2 px-4 md:hidden">
        {rows.map((r) => {
          const selected = r.driverId === selectedId;
          return (
            <li key={r.driverId}>
              <button
                type="button"
                aria-pressed={selected}
                onClick={() => onSelect(r.driverId)}
                className={cn(
                  "block w-full rounded-lg border bg-card p-3 text-left hover:bg-muted",
                  selected && "border-primary ring-1 ring-primary",
                  !r.isActive && "opacity-60",
                )}
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="flex min-w-0 items-center gap-1.5">
                    {selected && <Check className="h-4 w-4 shrink-0 text-primary" aria-hidden />}
                    <span className="min-w-0 truncate font-medium">{r.driverName}</span>
                    <OwnerBadge row={r} />
                    {!r.isActive && <span className="shrink-0 text-xs text-muted-foreground">（停止中）</span>}
                  </span>
                  <span className="shrink-0 text-xs text-muted-foreground">
                    {r.entryCount} 件 / <Qty value={r.qtyTotal} className="text-xs" />
                  </span>
                </div>
                <dl className="mt-2 grid grid-cols-2 gap-x-3 gap-y-1 text-sm">
                  <dt className="text-muted-foreground">売上</dt>
                  <dd className="text-right">
                    <Money value={r.bill} />
                  </dd>
                  <dt className="text-muted-foreground">支払（税抜）</dt>
                  <dd className="text-right">
                    <Money value={r.pay} />
                  </dd>
                  <dt className="text-muted-foreground">会社利益</dt>
                  <dd className="text-right">
                    <Money value={r.profit} className="font-semibold" />
                  </dd>
                  <dt className="text-muted-foreground">利益率</dt>
                  <dd className="text-right">
                    <Pct value={r.profitRate} />
                  </dd>
                  <dt className="text-muted-foreground">1 稼働あたり</dt>
                  <dd className="text-right">
                    <PerEntry value={r.profitPerEntry} />
                  </dd>
                </dl>
              </button>
            </li>
          );
        })}
        <li className="rounded-lg border bg-muted/50 p-3 text-sm font-semibold">
          <div className="flex items-center justify-between">
            <span>合計（{totals.driverCount} 名）</span>
            <span className="text-xs font-normal text-muted-foreground">
              {totals.entryCount} 件 / <Qty value={totals.qtyTotal} className="text-xs" />
            </span>
          </div>
          <dl className="mt-2 grid grid-cols-2 gap-x-3 gap-y-1">
            <dt className="font-normal text-muted-foreground">売上</dt>
            <dd className="text-right">
              <Money value={totals.bill} />
            </dd>
            <dt className="font-normal text-muted-foreground">会社利益</dt>
            <dd className="text-right">
              <Money value={totals.profit} />
            </dd>
            <dt className="font-normal text-muted-foreground">利益率</dt>
            <dd className="text-right">
              <Pct value={totals.profitRate} />
            </dd>
          </dl>
        </li>
      </ul>

      {/* PC：表 */}
      <div className="hidden md:block">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="sticky left-0 bg-card">ドライバー</TableHead>
              <TableHead className="text-right">稼働件数</TableHead>
              <TableHead className="text-right">稼働量</TableHead>
              <TableHead className="text-right">売上</TableHead>
              <TableHead className="text-right">支払（税抜）</TableHead>
              <TableHead className="text-right">単価差額利益</TableHead>
              <TableHead className="text-right">ロイヤリティ</TableHead>
              <TableHead className="text-right">管理費</TableHead>
              <TableHead className="text-right">会社利益</TableHead>
              <TableHead className="text-right">利益率</TableHead>
              <TableHead className="text-right">1 稼働あたりの利益</TableHead>
              <TableHead className="w-8" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((r) => {
              const selected = r.driverId === selectedId;
              return (
                <TableRow
                  key={r.driverId}
                  className={cn("cursor-pointer", selected && "bg-muted", !r.isActive && "opacity-60")}
                  tabIndex={0}
                  aria-label={`${r.driverName} の内訳を表示`}
                  aria-pressed={selected}
                  role="button"
                  onClick={() => onSelect(r.driverId)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" || e.key === " ") {
                      e.preventDefault();
                      onSelect(r.driverId);
                    }
                  }}
                >
                  <TableCell className={cn("sticky left-0 whitespace-nowrap bg-card font-medium", selected && "bg-muted")}>
                    <span className="flex items-center gap-1.5">
                      {r.driverName}
                      <OwnerBadge row={r} />
                      {!r.isActive && <span className="text-xs text-muted-foreground">（停止中）</span>}
                    </span>
                  </TableCell>
                  <TableCell className="num">{r.entryCount}</TableCell>
                  <TableCell className="text-right">
                    <Qty value={r.qtyTotal} />
                  </TableCell>
                  <TableCell className="text-right">
                    <Money value={r.bill} />
                  </TableCell>
                  <TableCell className="text-right">
                    <Money value={r.pay} />
                  </TableCell>
                  <TableCell className="text-right">
                    <Money value={r.margin} />
                  </TableCell>
                  <TableCell className="text-right">
                    <Money value={r.royalty} />
                  </TableCell>
                  <TableCell className="text-right">
                    <Money value={r.mgmtFee} />
                  </TableCell>
                  <TableCell className="text-right">
                    <Money value={r.profit} className="font-semibold" />
                  </TableCell>
                  <TableCell className="text-right">
                    <Pct value={r.profitRate} />
                  </TableCell>
                  <TableCell className="text-right">
                    <PerEntry value={r.profitPerEntry} />
                  </TableCell>
                  <TableCell className="text-muted-foreground">
                    <ChevronRight className="h-4 w-4" />
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
          <TableFooter>
            <TableRow>
              <TableCell className="sticky left-0 whitespace-nowrap bg-muted/50">合計（{totals.driverCount} 名）</TableCell>
              <TableCell className="num">{totals.entryCount}</TableCell>
              <TableCell className="text-right">
                <Qty value={totals.qtyTotal} />
              </TableCell>
              <TableCell className="text-right">
                <Money value={totals.bill} />
              </TableCell>
              <TableCell className="text-right">
                <Money value={totals.pay} />
              </TableCell>
              <TableCell className="text-right">
                <Money value={totals.margin} />
              </TableCell>
              <TableCell className="text-right">
                <Money value={totals.royalty} />
              </TableCell>
              <TableCell className="text-right">
                <Money value={totals.mgmtFee} />
              </TableCell>
              <TableCell className="text-right">
                <Money value={totals.profit} />
              </TableCell>
              <TableCell className="text-right">
                <Pct value={totals.profitRate} />
              </TableCell>
              <TableCell className="text-right">
                <PerEntry value={totals.profitPerEntry} />
              </TableCell>
              <TableCell />
            </TableRow>
          </TableFooter>
        </Table>
      </div>
    </>
  );
}
