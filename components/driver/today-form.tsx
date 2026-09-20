"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { CalendarDays, PartyPopper } from "lucide-react";
import { Alert } from "@/components/ui/alert";
import { OutboxNotice } from "@/components/offline/outbox-notice";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import type { DailyReportRow, DriverDayItem, WorkDayEntryRow } from "@/lib/db/types";
import { dayProgress, formatWorkDate } from "@/lib/daily/helpers";
import { OUTBOX_SYNCED_EVENT } from "@/lib/offline/sync";
import { DayEndCard } from "./day-end-card";
import { DayEntriesCard } from "./day-entries-card";
import { DayHistory, type DayHistoryItem } from "./day-history";
import { DayStartCard } from "./day-start-card";

export interface TodayFormProps {
  /** 日本時間の今日 */
  today: string;
  /** 表示している日 */
  date: string;
  /** 選べる日（新しい順） */
  dateOptions: string[];
  report: DailyReportRow | null;
  entries: WorkDayEntryRow[];
  items: DriverDayItem[];
  vehicles: { id: string; plate: string }[];
  history: DayHistoryItem[];
  /** その日を入力・変更できるか */
  editable: boolean;
  /** 変更できない理由（締め済みなど） */
  lockedReason?: string;
}

/** ドライバーの「今日の報告」（① 出発前 → ② 今日の稼働 → ③ 終了後） */
export function TodayForm({ today, date, dateOptions, report, entries, items, vehicles, history, editable, lockedReason }: TodayFormProps) {
  const router = useRouter();
  const progress = dayProgress(report, entries);

  // 未送信ぶんが送れたら、サーバーの内容で表示を作り直す
  useEffect(() => {
    const onSynced = () => router.refresh();
    window.addEventListener(OUTBOX_SYNCED_EVENT, onSynced);
    return () => window.removeEventListener(OUTBOX_SYNCED_EVENT, onSynced);
  }, [router]);

  return (
    <div className="space-y-4">
      <div className="space-y-1.5">
        <Label htmlFor="today-date" className="flex items-center gap-1.5">
          <CalendarDays className="h-4 w-4" aria-hidden />
          日付
        </Label>
        <Select id="today-date" value={date} onChange={(e) => router.push(`/driver/today?d=${e.target.value}`)}>
          {dateOptions.map((d) => (
            <option key={d} value={d}>
              {formatWorkDate(d)}
              {d === today ? "（今日）" : ""}
            </option>
          ))}
        </Select>
      </div>

      <OutboxNotice />

      {progress.done && (
        <Alert variant="success" className="flex items-center gap-2">
          <PartyPopper className="h-4 w-4 shrink-0" aria-hidden />
          今日の報告は完了です。おつかれさまでした。
        </Alert>
      )}
      {!editable && <Alert variant="warning">{lockedReason ?? "この日は変更できません。担当者にご連絡ください。"}</Alert>}

      <DayStartCard key={`start-${date}`} date={date} report={report} vehicles={vehicles} editable={editable} />
      <DayEntriesCard key={`entries-${date}`} date={date} items={items} entries={entries} editable={editable} />
      <DayEndCard key={`end-${date}`} date={date} report={report} editable={editable} />

      <DayHistory items={history} selected={date} />
    </div>
  );
}
