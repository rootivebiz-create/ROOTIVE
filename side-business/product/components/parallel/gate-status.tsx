import { Money } from "@/components/ui";
import type { GoLiveGate } from "~/server/features/parallel/gate";

/**
 * 本番に切り替える条件の様子（だれにでも見せる）。
 * 足りないときは「だれの差に、理由のメモが無いか」を 1 人ずつ出し、その人の行へ移れるようにする。
 */
export function GateStatus({ gate, golive }: { gate: GoLiveGate; golive: string | null }) {
  if (golive) return null;
  if (gate.ready) {
    return (
      <div role="status" className="space-y-1 rounded-lg border border-success/40 bg-success/10 p-3 text-sm">
        <p className="font-bold text-success">切り替える条件がそろっています（比べた人が全員一致か、差のある人全員に理由のメモがあります）。</p>
        {gate.cautions.length > 0 && (
          <ul className="list-disc space-y-1 pl-5 text-muted-foreground">
            {gate.cautions.map((c) => (
              <li key={c}>{c}</li>
            ))}
          </ul>
        )}
      </div>
    );
  }
  return (
    <div className="space-y-2 rounded-lg border border-warning/50 bg-warning/10 p-3 text-sm">
      <p className="font-bold">切り替える前に、次のことが残っています</p>
      <ul className="list-disc space-y-1 pl-5">
        {gate.blockers.map((b) => (
          <li key={b}>{b}</li>
        ))}
      </ul>
      {gate.missingNotes.length > 0 && (
        <ul className="space-y-1" aria-label="理由のメモがまだ無い人">
          {gate.missingNotes.map((m) => (
            <li key={m.driverId} className="flex flex-wrap items-center gap-x-2 rounded-lg border border-border bg-card px-2">
              <a href={`#row-${m.driverId}`} className="inline-flex min-h-11 items-center font-bold">
                {m.name}さん
              </a>
              <span>
                差 <Money value={m.diff} />
              </span>
              {m.candidate && <span className="text-muted-foreground">原因の候補：{m.candidate}</span>}
            </li>
          ))}
        </ul>
      )}
      {gate.cautions.length > 0 && (
        <ul className="list-disc space-y-1 pl-5 text-muted-foreground">
          {gate.cautions.map((c) => (
            <li key={c}>{c}</li>
          ))}
        </ul>
      )}
    </div>
  );
}
