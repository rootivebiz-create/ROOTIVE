import Link from "next/link";
import { Card, buttonClass } from "@/components/ui";
import { FinishButton, MarkButton, ReopenButton } from "~/components/onboarding/mark-button";
import { Badge, PageHeader } from "~/components/page";
import { getDb } from "~/db/client";
import { requirePageUser } from "~/server/auth";
import { loadOnboarding, minutesText, STATE_LABEL, type OnboardingStepDef, type StepState } from "~/server/features/onboarding";
import { monthFromParam, monthParam } from "~/server/month";

export const metadata = { title: "最初の設定" };

const TONE: Record<StepState, "green" | "gray" | "yellow"> = { done: "green", auto: "green", skipped: "gray", todo: "yellow" };

/** 取り込み・比べ合わせは先月の分を開く（今の Excel で締め終わっている月で試すと、比べやすい） */
function stepHref(def: OnboardingStepDef, lastMonth: string): string {
  return def.withMonth ? `${def.path}?m=${lastMonth}` : def.path;
}

/** 最初の設定の案内：6 つの手順と、どこまで済んだか。どの手順もとばせる */
export default async function OnboardingPage() {
  const user = await requirePageUser("staff");
  const db = await getDb();
  const progress = await loadOnboarding(db, user.tenantId);
  // 先月（デモは架空のデータがある月）
  const lastMonth = monthParam(monthFromParam(undefined));
  const pct = Math.round((progress.doneCount / progress.total) * 100);

  return (
    <div className="mx-auto max-w-3xl">
      <PageHeader
        title="最初の設定"
        description="ここだけ済めば、今月から明細を作れます。どの手順も「あとでやる」でとばせて、あとから戻れます。"
      />

      <Card className="mb-6">
        <p className="font-bold">
          {progress.total} つのうち {progress.doneCount} つ済み
          {progress.minutesLeft > 0 && <span className="ml-2 text-sm font-normal text-muted-foreground">残りは{minutesText(progress.minutesLeft)}</span>}
        </p>
        <div className="mt-2 h-2 w-full overflow-hidden rounded-full bg-muted" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={pct} aria-label="最初の設定の進み具合">
          <div className="h-full rounded-full bg-foreground" style={{ width: `${pct}%` }} />
        </div>
        {progress.next ? (
          <div className="mt-4 flex flex-col gap-2 sm:flex-row sm:items-center">
            <Link href={stepHref(progress.next, lastMonth)} className={buttonClass("primary", "w-full sm:w-auto")}>
              {progress.next.no}. {progress.next.title}をはじめる（{minutesText(progress.next.minutes)}）
            </Link>
            <FinishButton />
          </div>
        ) : (
          <div className="mt-4 flex flex-col gap-2 sm:flex-row sm:items-center">
            <Link href="/onboarding/done" className={buttonClass("primary", "w-full sm:w-auto")}>
              準備ができました →
            </Link>
            {progress.finished && <ReopenButton />}
          </div>
        )}
      </Card>

      <ol className="space-y-3">
        {progress.steps.map(({ def, state, note }) => {
          const ownerNote = def.ownerOnly && user.role !== "owner";
          return (
            <li key={def.key}>
              <Card className={progress.next?.key === def.key ? "border-2 border-foreground" : undefined}>
                <div className="flex flex-wrap items-center gap-2">
                  <span
                    aria-hidden
                    className={`inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-sm font-bold ${
                      state === "done" || state === "auto" ? "bg-success/15 text-success" : "bg-muted text-muted-foreground"
                    }`}
                  >
                    {state === "done" || state === "auto" ? "✓" : def.no}
                  </span>
                  <h2 className="min-w-0 flex-1 font-bold">
                    {def.no}. {def.title}
                    <span className="ml-2 text-xs font-normal text-muted-foreground">{minutesText(def.minutes)}</span>
                  </h2>
                  <Badge tone={TONE[state]}>{STATE_LABEL[state]}</Badge>
                </div>
                <p className="mt-2 text-sm">{def.summary}</p>
                {note && <p className="mt-1 text-sm text-muted-foreground">{note}（登録済みのデータがあるので、済みにしています）</p>}
                {ownerNote && <p className="mt-1 text-sm text-muted-foreground">会社の基本を保存できるのはオーナーの方です。中身は見られます。</p>}
                <div className="mt-3 flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-start">
                  <Link href={stepHref(def, lastMonth)} className={buttonClass(state === "todo" ? "primary" : "secondary", "w-full sm:w-auto")}>
                    {state === "todo" ? "はじめる" : "開く"}
                  </Link>
                  {state === "todo" && (def.key === "import" || def.key === "parallel") && <MarkButton step={def.key} mark="done" label="済んだ" />}
                  {state === "todo" && <MarkButton step={def.key} mark="skipped" label="あとでやる" variant="ghost" />}
                  {(state === "done" || state === "skipped") && <MarkButton step={def.key} mark="todo" label="まだに戻す" variant="ghost" />}
                </div>
              </Card>
            </li>
          );
        })}
      </ol>

      <p className="mt-6 text-sm text-muted-foreground">
        あとで直すときは、メニューの「設定」から会社・ドライバー・案件・控除を変えられます。ドライバーの名簿は{" "}
        <Link href="/onboarding/drivers">名簿の読み込み</Link> からいつでも足せます。
      </p>
    </div>
  );
}
