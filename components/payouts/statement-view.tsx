import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Money, Pct } from "@/components/ui/money";
import { yen, qty as qtyText } from "@/lib/format";
import type { StatementData, StatementEntry } from "@/lib/statement";
import { ResetMgmtFeeButton } from "./statement-actions";

export function entryTitle(e: Pick<StatementEntry, "projectName" | "itemName">): string {
  return e.itemName && e.itemName !== "標準" ? `${e.projectName}（${e.itemName}）` : e.projectName;
}

function unitSuffix(unit: "day" | "piece") {
  return unit === "day" ? "日" : "個";
}

/** ドライバー向けの明細（稼働・控除・調整・お支払額）。スタッフ画面用 */
export function StatementCard({ s, editable }: { s: StatementData; editable: boolean }) {
  const activeCount = s.entries.filter((e) => e.qty > 0).length;
  const mgmtCounted = activeCount > 0;
  const feeDiffers = s.mgmtFeeSetting !== s.driverDefaultMgmtFee;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex flex-wrap items-center gap-2">
          稼働明細
          {s.isClosed && <Badge variant="secondary">締め済み</Badge>}
        </CardTitle>
        <CardDescription>
          {s.driverName} 様 ／ {s.monthLabel}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-5">
        {/* 稼働 */}
        <section>
          {s.entries.length === 0 ? (
            <p className="rounded-md border border-dashed p-3 text-center text-sm text-muted-foreground">この月の稼働はありません。</p>
          ) : (
            <ul className="divide-y">
              {s.entries.map((e) => (
                <li key={e.id} className="flex items-start justify-between gap-3 py-2">
                  <div className="min-w-0">
                    <p className="font-medium">{entryTitle(e)}</p>
                    <p className="text-sm text-muted-foreground">
                      <span className="num">
                        {qtyText(e.qty)}
                        {unitSuffix(e.unit)}
                      </span>
                      {" × "}
                      <span className="num">{yen(e.payRate)}</span>
                      {e.qty === 0 && <span className="ml-1 text-xs text-warning">（数量 0）</span>}
                    </p>
                    {e.memo && <p className="text-xs text-muted-foreground">{e.memo}</p>}
                  </div>
                  <Money value={e.pay} className="shrink-0 font-medium" />
                </li>
              ))}
            </ul>
          )}
          <div className="mt-2 flex items-center justify-between border-t pt-2 font-semibold">
            <span>ドライバー売上（小計）</span>
            <Money value={s.pay} />
          </div>
        </section>

        {/* 控除・調整 */}
        <section>
          <h4 className="mb-1 text-sm font-semibold text-muted-foreground">控除・調整</h4>
          <ul className="divide-y">
            <li className="flex items-center justify-between gap-3 py-2">
              <span>
                ロイヤリティ
                {s.royaltyRate != null ? (
                  <span className="ml-1 text-sm text-muted-foreground">
                    （<Pct value={s.royaltyRate} />）
                  </span>
                ) : s.entries.length > 1 ? (
                  <span className="ml-1 text-xs text-muted-foreground">（率は稼働行ごと）</span>
                ) : null}
              </span>
              <Money value={-s.royalty} />
            </li>
            <li className="flex items-start justify-between gap-3 py-2">
              <div className="min-w-0">
                <p>
                  管理費
                  {!mgmtCounted && s.mgmtFeeSetting !== 0 && <Badge variant="outline" className="ml-2 align-middle">未計上</Badge>}
                </p>
                <p className="text-xs text-muted-foreground">
                  設定値 <span className="num">{yen(s.mgmtFeeSetting)}</span>
                  {!mgmtCounted && s.mgmtFeeSetting !== 0 && "（数量 > 0 の稼働行が無いため計上しません）"}
                  {feeDiffers && (
                    <span className="ml-1 text-warning">
                      ドライバー標準 <span className="num">{yen(s.driverDefaultMgmtFee)}</span> と異なります
                    </span>
                  )}
                </p>
                {editable && feeDiffers && (
                  <div className="mt-1">
                    <ResetMgmtFeeButton month={s.month} driverId={s.driverId} defaultFee={s.driverDefaultMgmtFee} />
                  </div>
                )}
              </div>
              <Money value={-s.mgmtFee} className={!mgmtCounted ? "text-muted-foreground" : undefined} />
            </li>
            {s.adjustments.map((a) => (
              <li key={a.id} className="flex items-center justify-between gap-3 py-2">
                <span className="min-w-0">
                  <span className="break-words">{a.label}</span>
                  <span className="ml-2 text-xs text-muted-foreground">{a.countAsProfit ? "利益計上" : "立替・精算"}</span>
                </span>
                <Money value={a.amount} className="shrink-0" />
              </li>
            ))}
            {s.adjustments.length === 0 && <li className="py-2 text-sm text-muted-foreground">調整はありません。</li>}
          </ul>
        </section>

        {/* お支払額 */}
        <section className="rounded-lg bg-accent p-4 text-accent-foreground">
          <div className="flex items-center justify-between gap-3">
            <span className="text-base font-semibold">お支払額</span>
            <Money value={s.payout} className="text-2xl font-bold md:text-3xl" />
          </div>
          <p className="mt-1 text-sm">
            振込予定日：<span className="num">{s.payoutDateLabel}</span>
          </p>
        </section>

        {s.company.statement_note && <p className="whitespace-pre-wrap text-sm text-muted-foreground">{s.company.statement_note}</p>}
      </CardContent>
    </Card>
  );
}

/** 会社側の内訳（ドライバーには表示しない） */
export function CompanyBreakdownCard({ s }: { s: StatementData }) {
  const rows: { label: string; value: number; strong?: boolean }[] = [
    { label: "会社売上", value: s.bill },
    { label: "単価差額利益", value: s.margin },
    { label: "ロイヤリティ", value: s.royalty },
    { label: "管理費", value: s.mgmtFee },
    { label: "調整（利益計上分）", value: s.adjProfit },
    { label: "会社利益", value: s.driverProfit, strong: true },
  ];
  return (
    <Card>
      <CardHeader>
        <CardTitle>会社側の内訳</CardTitle>
        <CardDescription>ドライバーには表示されません</CardDescription>
      </CardHeader>
      <CardContent>
        <dl className="divide-y text-sm">
          {rows.map((r) => (
            <div key={r.label} className={`flex items-center justify-between py-2 ${r.strong ? "font-semibold" : ""}`}>
              <dt>{r.label}</dt>
              <dd>
                <Money value={r.value} className={r.strong ? "text-base" : undefined} />
              </dd>
            </div>
          ))}
          <div className="flex items-center justify-between py-2">
            <dt>利益率</dt>
            <dd>
              <Pct value={s.profitRate} />
            </dd>
          </div>
        </dl>
        {s.memo && (
          <div className="mt-3 rounded-md bg-muted p-3 text-sm">
            <p className="mb-1 text-xs font-medium text-muted-foreground">メモ（社内用）</p>
            <p className="whitespace-pre-wrap">{s.memo}</p>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
