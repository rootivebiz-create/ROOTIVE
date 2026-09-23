"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { ChevronLeft, ChevronRight, Download } from "lucide-react";
import { PageHeader } from "@/components/ui/page-header";
import { Button, buttonVariants } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { BoardTab } from "./board-tab";
import { DemandTab } from "./demand-tab";
import { OffsTab } from "./offs-tab";
import { buildDispatchBoard, dateRange, shortDateJa, type DemandDay, type DemandPattern, type DispatchDriver, type DispatchItem, type Assignment, type DayOff } from "@/lib/dispatch/board";
import { addDays } from "@/lib/daily/helpers";
import { exportUrls } from "@/lib/exports/urls";
import type { DayOffStatus } from "@/lib/db/types";

export interface DispatchViewProps {
  weekStart: string;
  today: string;
  editable: boolean;
  /** 予定の粗利を出すか（事務員には出さない） */
  showProfit?: boolean;
  items: DispatchItem[];
  drivers: DispatchDriver[];
  patterns: DemandPattern[];
  demandDays: DemandDay[];
  assignments: Assignment[];
  dayOffs: DayOff[];
  recentQty: Record<string, number>;
  /** 必要人数タブ用（これから先の特定日） */
  demandDayRows: { projectItemId: string; onDate: string; need: number; note: string }[];
  /** 休み希望タブ用 */
  offRows: { id: string; driverId: string; driverName: string; onDate: string; status: DayOffStatus; reason: string }[];
  tab: string;
}

const TABS = ["board", "demand", "offs"] as const;

/** 配車の画面（週の配車表・必要人数・休み希望） */
export function DispatchView(props: DispatchViewProps) {
  const router = useRouter();
  const params = useSearchParams();
  const { weekStart, today, editable, items, drivers } = props;

  const dates = dateRange(weekStart, 7);
  const board = buildDispatchBoard({
    dates,
    items,
    drivers,
    patterns: props.patterns,
    demandDays: props.demandDays,
    assignments: props.assignments,
    dayOffs: props.dayOffs,
  });

  const go = (from: string, tab?: string) => {
    const sp = new URLSearchParams(params.toString());
    sp.set("from", from);
    if (tab) sp.set("tab", tab);
    router.push(`/dispatch?${sp.toString()}`);
  };

  const tab = TABS.includes(props.tab as (typeof TABS)[number]) ? props.tab : "board";

  return (
    <div>
      <PageHeader
        title="配車"
        description={`${shortDateJa(weekStart)} 〜 ${shortDateJa(addDays(weekStart, 6))}`}
        actions={
          <div className="flex items-center gap-1">
            <Button variant="outline" size="icon" onClick={() => go(addDays(weekStart, -7))} aria-label="前の週">
              <ChevronLeft />
            </Button>
            <Button variant="outline" onClick={() => go(thisWeekStart(today))}>
              今週
            </Button>
            <Button variant="outline" size="icon" onClick={() => go(addDays(weekStart, 7))} aria-label="次の週">
              <ChevronRight />
            </Button>
            <a
              href={exportUrls.dispatchCsv(weekStart, addDays(weekStart, 6))}
              download
              aria-label="この週の配車を CSV で出す"
              className={buttonVariants({ variant: "outline", size: "icon" })}
            >
              <Download />
            </a>
          </div>
        }
      />

      <Tabs value={tab} onValueChange={(v) => go(weekStart, v)}>
        <TabsList>
          <TabsTrigger value="board">配車表</TabsTrigger>
          <TabsTrigger value="demand">必要人数</TabsTrigger>
          <TabsTrigger value="offs">休み希望</TabsTrigger>
        </TabsList>

        <TabsContent value="board">
          <BoardTab
            board={board}
            items={items}
            drivers={drivers}
            weekStart={weekStart}
            editable={editable}
            recentQty={props.recentQty}
            today={today}
            showProfit={props.showProfit ?? true}
          />
        </TabsContent>
        <TabsContent value="demand">
          <DemandTab items={items} patterns={props.patterns} days={props.demandDayRows} editable={editable} />
        </TabsContent>
        <TabsContent value="offs">
          <OffsTab offs={props.offRows} drivers={drivers} editable={editable} />
        </TabsContent>
      </Tabs>
    </div>
  );
}

/** 今週の月曜（ボタン用。lib/dispatch/board の weekStart と同じ規則） */
function thisWeekStart(today: string): string {
  const w = new Date(`${today}T00:00:00Z`).getUTCDay();
  return addDays(today, w === 0 ? -6 : 1 - w);
}
