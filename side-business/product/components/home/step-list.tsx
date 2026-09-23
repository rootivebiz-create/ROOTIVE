import Link from "next/link";
import { Badge } from "~/components/page";
import type { HomeStepView } from "~/server/features/home/steps";

/** 締めの 5 つの段。済んだ段は印、次にやる段は太い枠 */
export function StepList({ steps }: { steps: HomeStepView[] }) {
  return (
    <ol className="space-y-3" aria-label="締めの流れ">
      {steps.map((s) => (
        <li key={s.key}>
          <div
            className={`rounded-card border bg-card p-4 ${s.current ? "border-2 border-foreground" : s.tone === "red" ? "border-danger/60" : "border-border"}`}
            aria-current={s.current ? "step" : undefined}
          >
            <div className="flex flex-wrap items-center gap-2">
              <span
                aria-hidden
                className={`inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-sm font-bold ${
                  s.done ? "bg-success/15 text-success" : s.current ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground"
                }`}
              >
                {s.done ? "✓" : s.no}
              </span>
              <h3 className="min-w-0 flex-1 font-bold">
                <span className="sr-only">{s.no}. </span>
                {s.title}
                {s.current && <span className="ml-2 whitespace-nowrap rounded bg-accent px-1.5 py-0.5 text-xs font-bold text-accent-foreground">いまここ</span>}
              </h3>
              <Badge tone={s.tone}>{s.badge}</Badge>
            </div>
            <ul className="mt-2 space-y-1 text-sm">
              {s.lines.map((line, i) => (
                <li key={i} className={i === 0 ? "" : "text-muted-foreground"}>
                  {line}
                </li>
              ))}
            </ul>
            <Link href={s.href} className="mt-1 inline-flex min-h-11 items-center text-sm">
              {s.linkLabel} →
            </Link>
          </div>
        </li>
      ))}
    </ol>
  );
}
