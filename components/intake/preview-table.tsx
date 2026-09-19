"use client";

import { Badge } from "@/components/ui/badge";
import { Select } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Qty } from "@/components/ui/money";
import type { MatchedRow } from "@/lib/intake/mapping";
import { shortDate } from "./helpers";

export interface DriverOption {
  id: string;
  name: string;
  isActive: boolean;
}

export interface ItemOption {
  id: string;
  name: string;
  projectId: string;
  projectName: string;
  isActive: boolean;
}

export interface PreviewTableProps {
  rows: MatchedRow[];
  drivers: DriverOption[];
  items: ItemOption[];
  disabled: boolean;
  /** 元請の表記にドライバーを対応づける（同じ表記の行はすべて変わる） */
  onAssignDriver: (name: string, driverId: string) => void;
  /** 元請の表記に案件内容を対応づける（同じ表記の行はすべて変わる） */
  onAssignItem: (label: string, itemId: string) => void;
}

/** 取り込みのプレビュー表。対応が付いていない行は赤く出し、その場で選んで対応づけられる */
export function PreviewTable({ rows, drivers, items, disabled, onAssignDriver, onAssignItem }: PreviewTableProps) {
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead className="w-10">行</TableHead>
          <TableHead className="w-16">日付</TableHead>
          <TableHead className="min-w-[9rem]">ドライバー</TableHead>
          <TableHead className="min-w-[10rem]">案件・内容</TableHead>
          <TableHead className="w-16 text-right">数量</TableHead>
          <TableHead className="min-w-[8rem]">状態</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {rows.map((row) => (
          <TableRow key={`${row.line}-${row.driverName}-${row.itemLabel}`} className={row.ok ? undefined : "bg-destructive/5"}>
            <TableCell className="text-xs text-muted-foreground">{row.line}</TableCell>
            <TableCell className="whitespace-nowrap text-sm">
              {row.date ? shortDate(row.date) : <span className="text-destructive">日付なし</span>}
            </TableCell>
            <TableCell>
              <p className="truncate text-sm" title={row.driverName}>
                {row.driverName || <span className="text-destructive">（空）</span>}
              </p>
              {row.driverName && !row.driverId && (
                <Select
                  aria-label={`${row.driverName} に対応するドライバー`}
                  className="mt-1 h-9 text-sm"
                  value=""
                  disabled={disabled}
                  onChange={(e) => onAssignDriver(row.driverName, e.target.value)}
                >
                  <option value="">ドライバーを選ぶ</option>
                  {drivers.map((d) => (
                    <option key={d.id} value={d.id}>
                      {d.name}
                      {d.isActive ? "" : "（停止中）"}
                    </option>
                  ))}
                </Select>
              )}
            </TableCell>
            <TableCell>
              <p className="truncate text-sm" title={row.itemLabel}>
                {row.itemLabel || <span className="text-destructive">（空）</span>}
              </p>
              {row.itemLabel && !row.itemId && (
                <Select
                  aria-label={`${row.itemLabel} に対応する案件内容`}
                  className="mt-1 h-9 text-sm"
                  value=""
                  disabled={disabled}
                  onChange={(e) => onAssignItem(row.itemLabel, e.target.value)}
                >
                  <option value="">案件内容を選ぶ</option>
                  {items.map((i) => (
                    <option key={i.id} value={i.id}>
                      {i.projectName} / {i.name}
                      {i.isActive ? "" : "（停止中）"}
                    </option>
                  ))}
                </Select>
              )}
            </TableCell>
            <TableCell className="text-right">
              <Qty value={row.qty} />
            </TableCell>
            <TableCell>
              {row.ok ? (
                <Badge variant="secondary">取り込む</Badge>
              ) : (
                <span className="text-xs text-destructive">{row.error}</span>
              )}
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}
