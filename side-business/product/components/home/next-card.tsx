import Link from "next/link";
import { buttonClass } from "@/components/ui";
import type { HomeView } from "~/server/features/home/steps";
import { monthLabelJa, monthParam, shiftMonth } from "~/server/month";

/** 2026-11-25 → 11月25日（水） */
function mdw(date: string): string {
  const d = new Date(`${date}T00:00:00Z`);
  const w = "日月火水木金土"[d.getUTCDay()];
  return `${d.getUTCMonth() + 1}月${d.getUTCDate()}日（${w}）`;
}

function daysBetween(from: string, to: string): number {
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000);
}

/** 支払日まで何日か（日本時間の今日から） */
function payDateText(payDate: string, today: string): string {
  const days = daysBetween(today, payDate);
  if (days > 0) return `ドライバーへの支払日は ${mdw(payDate)}、あと ${days}日です。`;
  if (days === 0) return `ドライバーへの支払日は今日（${mdw(payDate)}）です。`;
  return `ドライバーへの支払日（${mdw(payDate)}）は過ぎています。`;
}

/** いちばん大きな「次にやること」。押す先は 1 つだけにする */
export function NextCard({ view, month, payDate, today }: { view: HomeView; month: string; payDate: string; today: string }) {
  const m = monthParam(month);
  if (view.allDone) {
    const nextMonth = shiftMonth(month, 1);
    return (
      <section aria-labelledby="next-heading" className="rounded-card border-2 border-success/50 bg-success/10 p-4 sm:p-6">
        <p id="next-heading" className="text-sm font-bold text-success">
          {monthLabelJa(month)}分の締めは終わりました
        </p>
        <p className="mt-1 text-lg font-bold">おつかれさまでした。</p>
        <p className="mt-1 text-sm">明細の送付・振込データ・振り込んだ日の記録まで済んでいます。元請の支払通知が届いたら、突き合わせておくと安心です。</p>
        <div className="mt-4 grid gap-2 sm:grid-cols-3">
          <Link href={`/reconcile?m=${m}`} className={buttonClass("primary", "w-full")}>
            元請の支払通知と突き合わせる
          </Link>
          <Link href={`/profit?m=${m}`} className={buttonClass("secondary", "w-full")}>
            今月の利益を見る
          </Link>
          <Link href={`/?m=${monthParam(nextMonth)}`} className={buttonClass("secondary", "w-full")}>
            {monthLabelJa(nextMonth)}分へ
          </Link>
        </div>
      </section>
    );
  }
  const next = view.next;
  if (!next) return null;
  const step = view.steps.find((s) => s.current);
  return (
    <section aria-labelledby="next-heading" className="rounded-card border-2 border-foreground bg-card p-4 sm:p-6">
      <p id="next-heading" className="text-sm font-bold text-muted-foreground">
        次にやること{step ? `（${step.no}. ${step.title}）` : ""}
      </p>
      <Link href={next.href} className={buttonClass(next.canAct ? "primary" : "secondary", "mt-3 min-h-14 w-full text-base sm:w-auto sm:px-8")}>
        {next.label} →
      </Link>
      <p className="mt-3 text-sm">{next.description}</p>
      <p className="mt-2 text-xs text-muted-foreground">{payDateText(payDate, today)}</p>
    </section>
  );
}
