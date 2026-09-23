import Link from "next/link";
import { requirePageRole } from "@/lib/auth/session";
import { addDays, todayJST } from "@/lib/daily/helpers";
import { isMonthKey } from "@/lib/month";
import { buildClosingSteps, buildInbox, closingProgress, todayReporters } from "@/lib/office/desk";
import { loadOfficeDesk } from "@/lib/office/queries";
import { startPageOf } from "@/lib/schemas/office";
import { PageHeader } from "@/components/ui/page-header";
import { ClosingCard } from "@/components/office/closing-card";
import { InboxCard } from "@/components/office/inbox-card";
import { QuickActions } from "@/components/office/quick-actions";
import { ReportersCard } from "@/components/office/reporters-card";
import { StartPageButton } from "@/components/office/start-page-button";

export const metadata = { title: "事務" };

/**
 * 事務（/office・owner / admin）
 *
 * 散らばっていた事務の仕事を 1 画面にまとめる：今日やること・今日の報告・月締めの手順・よく使う操作。
 * 読み取りは RPC `office_desk` の 1 往復だけで、並べ方と判定は `lib/office/desk.ts` の純関数。
 * 月締めの対象月は ?m（省くと「締めていない一番古い過去の月、無ければ今月」を DB が選ぶ）。
 */
export default async function OfficePage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const { supabase, profile } = await requirePageRole(["owner", "admin"]);
  const sp = await searchParams;
  const raw = Array.isArray(sp.m) ? sp.m[0] : sp.m;
  const today = todayJST();

  const desk = await loadOfficeDesk(supabase, { month: isMonthKey(raw) ? raw : null, today });
  const reporters = todayReporters(desk);
  const inbox = buildInbox(desk, reporters);
  const steps = buildClosingSteps(desk.closing, desk.month, today.slice(0, 7));
  const progress = closingProgress(steps);

  const tiles = [
    { href: "#inbox", label: "今日やること", value: `${inbox.length} 件`, tone: inbox.some((i) => i.urgency === "now") ? "text-destructive" : "" },
    { href: "#reports", label: "今日の報告", value: `${reporters.reportedCount} / ${reporters.expected.length} 人`, tone: reporters.missing.length > 0 ? "text-warning" : "" },
    { href: "#closing", label: "月締め", value: progress.closed ? "締め済み" : `${progress.done} / ${progress.total}`, tone: "" },
  ];

  return (
    <div className="space-y-4">
      <PageHeader
        title="事務"
        description="今日やること・今日の報告・月締めの手順を、ここで順に片づけられます。"
        actions={<StartPageButton isStart={startPageOf(profile.start_page) === "office"} />}
      />

      <nav aria-label="事務のまとめ" className="grid grid-cols-3 gap-2">
        {tiles.map((t) => (
          <Link key={t.href} href={t.href} className="rounded-lg border bg-card p-2 text-center transition-colors hover:bg-muted sm:p-3">
            <span className="block text-xs text-muted-foreground">{t.label}</span>
            <span className={`num mt-0.5 block text-base font-bold sm:text-lg ${t.tone}`}>{t.value}</span>
          </Link>
        ))}
      </nav>

      <InboxCard
        items={inbox}
        pendingEntries={desk.pendingEntries}
        pendingTotal={desk.pendingEntriesTotal}
        dayOffs={desk.dayOffs}
        remindTargets={reporters.remindTargets}
        tomorrow={desk.tomorrow?.onDate ?? (today ? addDays(today, 1) : null)}
      />
      <ReportersCard reporters={reporters} />
      <ClosingCard month={desk.month} steps={steps} progress={progress} closedAt={desk.closing.closedAt} />
      <QuickActions />
    </div>
  );
}
