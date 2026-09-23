import { Card, Money } from "@/components/ui";
import type { ProfitChanges } from "~/server/features/profit";
import { changeText, changeTone, pointChangeText, rateText, ratioText, signedYen } from "~/server/features/profit/format";
import type { ProfitTotals } from "~/server/features/profit/summary";

const ARROW = { up: "▲", down: "▼", flat: "―", none: "" } as const;

function ChangeLine({ text, tone }: { text: string; tone: keyof typeof ARROW }) {
  return (
    <p className="mt-1 text-xs text-muted-foreground">
      {ARROW[tone] && <span aria-hidden className="mr-0.5">{ARROW[tone]}</span>}
      {text}
    </p>
  );
}

/** 利益の画面の上の数字（売上・委託料・会社の利益・利益率・前月比） */
export function KpiCards({ totals, changes }: { totals: ProfitTotals; changes: ProfitChanges }) {
  const profitTone = changeTone(changes.profit);
  return (
    <dl className="grid grid-cols-1 gap-3 min-[360px]:grid-cols-2 lg:grid-cols-5">
      <Card>
        <dt className="text-xs text-muted-foreground">売上（税抜）</dt>
        <dd className="text-lg font-bold sm:text-xl">
          <Money value={totals.sales} />
        </dd>
        <dd>
          <ChangeLine text={changeText(changes.sales)} tone={changeTone(changes.sales)} />
        </dd>
      </Card>
      <Card>
        <dt className="text-xs text-muted-foreground">委託料（税抜）</dt>
        <dd className="text-lg font-bold sm:text-xl">
          <Money value={totals.pay} />
        </dd>
        <dd>
          <ChangeLine text={changeText(changes.pay)} tone={changeTone(changes.pay)} />
        </dd>
      </Card>
      <Card className={totals.profit < 0 ? "border-danger/60" : ""}>
        <dt className="text-xs text-muted-foreground">会社の利益</dt>
        <dd className="text-lg font-bold sm:text-xl">
          <Money value={totals.profit} />
          {totals.profit < 0 && <span className="ml-1 text-sm text-danger">赤字</span>}
        </dd>
        <dd className="mt-1 text-xs text-muted-foreground">売上 − 委託料 ＋ 控除 − 会社がかぶる消費税（免税の方への支払）</dd>
      </Card>
      <Card>
        <dt className="text-xs text-muted-foreground">利益率</dt>
        <dd className={`num text-lg font-bold sm:text-xl ${totals.profit < 0 ? "text-danger" : ""}`}>{rateText(totals.rate)}</dd>
        <dd>
          <ChangeLine text={pointChangeText(changes.rate)} tone={changeTone(changes.rate)} />
        </dd>
      </Card>
      <Card className="min-[360px]:col-span-2 lg:col-span-1">
        <dt className="text-xs text-muted-foreground">会社の利益の前月比</dt>
        <dd className={`num text-lg font-bold sm:text-xl ${profitTone === "down" ? "text-danger" : profitTone === "up" ? "text-success" : ""}`}>
          {changes.profit ? (
            <>
              <span aria-hidden className="mr-1">
                {ARROW[profitTone]}
              </span>
              {signedYen(changes.profit.diff)}
            </>
          ) : (
            "—"
          )}
        </dd>
        <dd className="mt-1 text-xs text-muted-foreground">
          {!changes.profit ? "前の月の記録がありません" : ratioText(changes.profit) ? `前月の利益から ${ratioText(changes.profit)}` : "前月の利益が 0 円のため、割合は出せません"}
        </dd>
      </Card>
    </dl>
  );
}
