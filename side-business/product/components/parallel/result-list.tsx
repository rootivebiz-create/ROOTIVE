import { Money } from "@/components/ui";
import { Badge } from "~/components/page";
import { Breakdown, Explanations, signedYen } from "~/components/parallel/diff-detail";
import type { ParallelRow } from "~/server/features/parallel";

/** 比べ合わせの結果（見るだけの人・印刷の前の確かめ） */
export function ResultList({ rows }: { rows: ParallelRow[] }) {
  return (
    <ul className="space-y-3">
      {rows.map((r) => (
        <li key={r.driverId} id={`row-${r.driverId}`} className={`scroll-mt-24 rounded-card border bg-card p-3 ${r.diff ? "border-warning/60" : "border-border"}`}>
          <div className="flex flex-wrap items-center gap-2">
            <span className="min-w-0 flex-1 font-bold">
              {r.name}
              {r.code && <span className="ml-1 text-xs font-normal text-muted-foreground">{r.code}</span>}
            </span>
            {r.diff === null ? <Badge>未入力</Badge> : r.diff === 0 ? <Badge tone="green">一致</Badge> : <Badge tone="red">差 {signedYen(r.diff)}</Badge>}
          </div>
          <dl className="mt-2 grid grid-cols-3 gap-2 text-sm">
            <div>
              <dt className="text-xs text-muted-foreground">しめ日ラボ</dt>
              <dd className="font-bold">{r.ours === null ? "明細なし" : <Money value={r.ours} />}</dd>
            </div>
            <div>
              <dt className="text-xs text-muted-foreground">Excel</dt>
              <dd className="font-bold">{r.excelTotal === null ? "—" : <Money value={r.excelTotal} />}</dd>
            </div>
            <div>
              <dt className="text-xs text-muted-foreground">差</dt>
              <dd className="font-bold">{r.diff === null ? "—" : <Money value={r.diff} />}</dd>
            </div>
          </dl>
          {r.note && <p className="mt-1 text-sm text-muted-foreground">メモ：{r.note}</p>}
          {r.diff !== null && r.diff !== 0 && (
            <div className="mt-2 space-y-2 rounded-lg bg-muted/50 p-2">
              <Explanations items={r.explanations} />
              {r.parts && (
                <details>
                  <summary className="min-h-11 cursor-pointer py-2 text-sm">しめ日ラボの内訳を見る</summary>
                  <Breakdown parts={r.parts} excelTotal={r.excelTotal} />
                </details>
              )}
            </div>
          )}
        </li>
      ))}
    </ul>
  );
}
