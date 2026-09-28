import Link from "next/link";
import { asc, eq } from "drizzle-orm";
import { Button, Card, Field, Input, Money, NumberInput, Select, buttonClass } from "@/components/ui";
import { Badge, EmptyState, PageHeader } from "~/components/page";
import { getDb } from "~/db/client";
import * as s from "~/db/schema";
import { requirePageUser } from "~/server/auth";
import { parseRecordsQuery, recordsQueryString, RECORDS_LIMIT, searchStatementRecords } from "~/server/features/statements/records";
import { monthFromParam, monthParam, shiftMonth } from "~/server/month";

export const metadata = { title: "明細の検索" };

/**
 * 明細の検索（見るだけの人も）：月をまたいで、期間・振込額の範囲・ドライバーで探し、どの版も開ける。
 * 条件は URL に残るので、同じ検索をあとで開き直せる。索引は CSV で出せる
 */
export default async function RecordsPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const user = await requirePageUser("viewer");
  const sp = await searchParams;
  const parsed = parseRecordsQuery(sp);
  // 期間を指定しないときは、先月までの 12 か月
  const lastMonth = monthFromParam(undefined);
  const q = parsed.from || parsed.to ? parsed : { ...parsed, from: shiftMonth(lastMonth, -11), to: lastMonth };
  const db = await getDb();
  const [drivers, result] = await Promise.all([
    db
      .select({ id: s.drivers.id, name: s.drivers.name, code: s.drivers.code })
      .from(s.drivers)
      .where(eq(s.drivers.tenantId, user.tenantId))
      .orderBy(asc(s.drivers.code), asc(s.drivers.name)),
    searchStatementRecords(db, user.tenantId, q),
  ]);
  const qs = recordsQueryString(q);

  return (
    <div className="space-y-6">
      <PageHeader
        title="明細の検索"
        description="月をまたいで、期間・振込額・ドライバーで明細を探します。作り直した前の版も開けます（版の写しは消えずに残っています）。"
      />

      <Card>
        <form method="get" action="/records" className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <Field label="ドライバー">
            <Select name="driver" defaultValue={q.driverId ?? ""}>
              <option value="">全員</option>
              {drivers.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.code ? `${d.code} ` : ""}
                  {d.name}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="期間（はじめの月）">
            <Input type="month" name="from" defaultValue={q.from ? monthParam(q.from) : ""} />
          </Field>
          <Field label="期間（おわりの月）">
            <Input type="month" name="to" defaultValue={q.to ? monthParam(q.to) : ""} />
          </Field>
          <Field label="振込額（円）いくらから" hint="最新の版の振込額で探します">
            <NumberInput name="min" defaultValue={q.min !== null ? String(q.min) : ""} placeholder="例：100000" />
          </Field>
          <Field label="振込額（円）いくらまで">
            <NumberInput name="max" defaultValue={q.max !== null ? String(q.max) : ""} placeholder="例：500000" />
          </Field>
          <div className="flex flex-wrap items-end gap-2">
            <Button type="submit">探す</Button>
            <Link href="/records" className={buttonClass("secondary")}>
              条件を消す
            </Link>
          </div>
        </form>
      </Card>

      <section aria-labelledby="result-heading" className="space-y-3">
        <div className="flex flex-wrap items-center gap-3">
          <h2 id="result-heading" className="text-lg font-bold">
            見つかった明細 {result.total}件
          </h2>
          {result.total > 0 && (
            <span className="text-sm text-muted-foreground">
              振込額（最新の版）の合計 <Money value={result.sum} className="font-bold" />
            </span>
          )}
          {result.total > 0 && (
            <a href={`/api/records/csv${qs ? `?${qs}` : ""}`} className={buttonClass("secondary", "ml-auto")}>
              索引を CSV で出す
            </a>
          )}
        </div>
        {result.truncated && (
          <p className="rounded-lg border border-warning/40 bg-warning/10 p-3 text-sm">
            多いので、はじめの {RECORDS_LIMIT} 件だけを出しています。期間を狭めるか、ドライバーを選んでください（CSV には全部入ります）。
          </p>
        )}
        {result.total === 0 ? (
          <EmptyState title="この条件に合う明細はありません">期間を広げるか、振込額の範囲を外してみてください。</EmptyState>
        ) : (
          <ul className="space-y-3">
            {result.rows.map((r) => (
              <li key={r.statementId} className="rounded-card border border-border bg-card p-3">
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <p className="min-w-0 font-bold [overflow-wrap:anywhere]">
                    {r.monthLabel}・{r.driverCode ? `${r.driverCode} ` : ""}
                    {r.driverName}
                  </p>
                  <p className="text-sm">
                    版 {r.latest.version}・<Money value={r.latest.total} className="font-bold" />
                  </p>
                </div>
                <div className="mt-1 flex flex-wrap gap-2 text-xs">
                  {r.closed ? <Badge tone="green">締めた月</Badge> : <Badge>まだ締めていない月</Badge>}
                  {!r.exists && <Badge tone="yellow">作り直しで消えた明細（版の写しだけ）</Badge>}
                </div>
                <div className="mt-2 flex flex-wrap gap-2">
                  {r.exists && (
                    <Link href={`/statements/${r.statementId}`} className={buttonClass("secondary")}>
                      いまの明細を開く
                    </Link>
                  )}
                  {r.exists &&
                    r.versions.length > 1 &&
                    r.versions.map((v) => (
                      <Link key={v.version} href={`/statements/${r.statementId}/versions/${v.version}`} className={buttonClass("ghost")}>
                        版 {v.version}（{v.createdAtText}）
                      </Link>
                    ))}
                </div>
                {!r.exists && (
                  <p className="mt-2 text-xs text-muted-foreground">
                    この明細は作り直しで消えましたが、版の写し（振込額・ハッシュ）は残っています。中身は「データの書き出し」の明細の全版に入っています。
                  </p>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
