"use client";

import { useEffect, useMemo, useState } from "react";
import { Download, FileSpreadsheet } from "lucide-react";
import { buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { exportUrls } from "@/lib/exports/urls";
import { formatMonthJa } from "@/lib/month";
import { cn } from "@/lib/utils";
import type { SimDriver } from "@/lib/calc";
import { DriverPlTable } from "./driver-pl-table";
import { DriverTrend } from "./driver-trend";
import { EntryBreakdown } from "./entry-breakdown";
import { SimulationPanel } from "./simulation-panel";
import {
  driverEntryRows,
  driverTrend,
  hasOwnerRow,
  hiddenInactiveCount,
  resolveSelectedDriver,
  sumDriverPlRows,
  visibleDriverPlRows,
  type DriverPlRow,
} from "./helpers";
import type { DriverMonthSummary, WorkEntryCalc } from "@/lib/db/types";

export interface DriversPlViewProps {
  month: string;
  /** 当月の全ドライバー（停止中も含む。表示の絞り込みは画面側で行う） */
  rows: DriverPlRow[];
  /** 当月の稼働行（内訳・シミュレーションで使う） */
  entries: WorkEntryCalc[];
  /** 直近 12 か月のドライバー × 月（推移で使う） */
  trendSummaries: DriverMonthSummary[];
  /** 推移の 12 か月（昇順） */
  trendMonths: string[];
  /** シミュレーションの入力（ドライバー × 月） */
  simDrivers: SimDriver[];
  initialDriverId: string;
  isClosed: boolean;
}

export function DriversPlView({ month, rows, entries, trendSummaries, trendMonths, simDrivers, initialDriverId, isClosed }: DriversPlViewProps) {
  const [includeInactive, setIncludeInactive] = useState(false);
  const [selectedId, setSelectedId] = useState(initialDriverId);

  const visibleRows = useMemo(() => visibleDriverPlRows(rows, { includeInactive }), [rows, includeInactive]);
  const totals = useMemo(() => sumDriverPlRows(visibleRows), [visibleRows]);
  const hiddenCount = useMemo(() => hiddenInactiveCount(rows), [rows]);
  const showOwnerNote = useMemo(() => hasOwnerRow(visibleRows), [visibleRows]);

  // 表示中の行から選択を決める（月・絞り込みを変えて対象が消えたら先頭に戻す）
  const selected = resolveSelectedDriver(visibleRows, selectedId);
  const selectedRow = visibleRows.find((r) => r.driverId === selected) ?? null;

  // 選んだドライバーを URL（?driver=）へ残す（サーバー再描画はしない）
  useEffect(() => {
    if (typeof window === "undefined") return;
    const sp = new URLSearchParams(window.location.search);
    if (selected) sp.set("driver", selected);
    else sp.delete("driver");
    const qs = sp.toString();
    const url = `${window.location.pathname}${qs ? `?${qs}` : ""}`;
    if (url !== `${window.location.pathname}${window.location.search}`) window.history.replaceState(null, "", url);
  }, [selected]);

  const trendPoints = useMemo(() => driverTrend(trendSummaries, selected, trendMonths), [trendSummaries, selected, trendMonths]);
  const entryRows = useMemo(() => driverEntryRows(entries, selected), [entries, selected]);
  const simTargets = useMemo(() => {
    const ids = new Set(visibleRows.map((r) => r.driverId));
    return simDrivers.filter((d) => ids.has(d.driverId));
  }, [simDrivers, visibleRows]);

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader className="gap-3 sm:flex-row sm:items-start sm:justify-between sm:space-y-0">
          <div className="min-w-0">
            <CardTitle>{formatMonthJa(month)} の一覧</CardTitle>
            <CardDescription>
              会社利益の多い順。行を選ぶと、そのドライバーの推移・稼働の内訳・シミュレーションの対象が切り替わります。
              {isClosed && " この月は締め済みです（表示のみ）。"}
            </CardDescription>
          </div>
          <div className="flex shrink-0 flex-wrap items-center gap-3">
            <label className="flex items-center gap-2 text-sm">
              <Switch checked={includeInactive} onCheckedChange={setIncludeInactive} aria-label="停止中のドライバーも表示" />
              <span className="whitespace-nowrap">
                停止中も表示
                {hiddenCount > 0 && !includeInactive && <span className="ml-1 text-xs text-muted-foreground">（{hiddenCount} 名）</span>}
              </span>
            </label>
            <a href={exportUrls.driversPlCsv(month, includeInactive)} download className={cn(buttonVariants({ variant: "outline", size: "sm" }))}>
              <Download className="h-4 w-4" />
              CSV
            </a>
            <a href={exportUrls.driversPlXlsx(month, includeInactive)} download className={cn(buttonVariants({ variant: "outline", size: "sm" }))}>
              <FileSpreadsheet className="h-4 w-4" />
              Excel
            </a>
          </div>
        </CardHeader>
        <CardContent className="px-0 md:px-0">
          <DriverPlTable
            rows={visibleRows}
            totals={totals}
            selectedId={selected}
            onSelect={setSelectedId}
            emptyDescription={
              hiddenCount > 0 ? "稼働中のドライバーの稼働行がありません。「停止中も表示」で停止中のドライバーも確認できます。" : `${formatMonthJa(month)} の稼働行がありません。`
            }
          />
        </CardContent>
      </Card>

      <div className="space-y-1 text-xs text-muted-foreground">
        <p>※ 支払（税抜）＝ 支払単価 × 数量 の合計（ドライバー売上）。売上 − 支払 ＝ 単価差額利益。</p>
        <p>※ 会社利益 ＝ 単価差額利益 ＋ ロイヤリティ ＋ 管理費 ＋ 調整（利益計上分）。利益率 ＝ 会社利益 ÷ 売上。</p>
        <p>※ 1 稼働あたりの利益 ＝ 会社利益 ÷ 数量 &gt; 0 の稼働行の件数。CSV の「税込支払額」は消費税を含む実際の振込額です。</p>
      </div>

      {showOwnerNote && (
        <p className="text-xs text-muted-foreground">
          ※「役員」は支払単価 0 の稼働だけのドライバー（オーナー本人）です。支払・ロイヤリティ・管理費が発生しないため、利益率は 100%、1 稼働あたりの利益は売上と同額になります。合計や順位を見るときはご注意ください。
        </p>
      )}

      <Card>
        <CardHeader>
          <CardTitle>{selectedRow ? `${selectedRow.driverName} の 12 か月の推移` : "12 か月の推移"}</CardTitle>
          <CardDescription>
            {trendMonths.length > 0 ? `${formatMonthJa(trendMonths[0])} 〜 ${formatMonthJa(month)} の売上・会社利益・利益率（税抜）。棒の長さは 12 か月の最大値に対する割合です。` : ""}
          </CardDescription>
        </CardHeader>
        <CardContent className="px-0 md:px-0">
          {selectedRow ? (
            <DriverTrend driverName={selectedRow.driverName} points={trendPoints} />
          ) : (
            <p className="px-4 text-sm text-muted-foreground">ドライバーを選ぶと推移を表示します。</p>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>{selectedRow ? `${selectedRow.driverName} の稼働の内訳（${formatMonthJa(month)}）` : `稼働の内訳（${formatMonthJa(month)}）`}</CardTitle>
          <CardDescription>行の利益 ＝ 単価差額利益 ＋ ロイヤリティ（管理費・調整はドライバー単位のため含みません）。</CardDescription>
        </CardHeader>
        <CardContent className="px-0 md:px-0">
          <EntryBreakdown rows={entryRows} emptyDescription={selectedRow ? `${selectedRow.driverName} の ${formatMonthJa(month)} の稼働行はありません。` : "ドライバーを選んでください。"} />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>単価改定シミュレーション</CardTitle>
          <CardDescription>
            単価・ロイヤリティ率・管理費を変えたときの会社利益とドライバーの手取りを試算します（{formatMonthJa(month)} の稼働をもとに計算。保存はしません）。
          </CardDescription>
        </CardHeader>
        <CardContent>
          <SimulationPanel drivers={simTargets} selectedDriverId={selected} selectedDriverName={selectedRow?.driverName ?? ""} />
        </CardContent>
      </Card>
    </div>
  );
}
