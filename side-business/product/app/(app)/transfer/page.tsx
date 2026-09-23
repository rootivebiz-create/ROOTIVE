import Link from "next/link";
import { Card, Money, buttonClass } from "@/components/ui";
import { yenText } from "@/lib/format";
import { shortDate } from "@/lib/tools/torihiki-joken";
import { Badge, EmptyState, Notice, PageHeader } from "~/components/page";
import { daysBetween, jstDateTime } from "~/components/close/format";
import { DeleteBatchButton, ExecutedOnForm } from "~/components/transfer/batch-controls";
import { CreateTransferForm } from "~/components/transfer/create-form";
import { SettleForm, UndoSettlementButton, diffText } from "~/components/transfer/paid-diff";
import { TransferReviewSection } from "~/components/transfer/review";
import { getDb } from "~/db/client";
import { requirePageUser, roleAtLeast } from "~/server/auth";
import {
  loadPaidDifferences,
  loadTransferPlan,
  loadTransferReview,
  type BatchView,
  type BankFields,
  type ExcludedRow,
  type PaidDiffReport,
  type TransferRow,
} from "~/server/features/transfer";
import { monthFromParam, monthLabelJa, monthParam } from "~/server/month";

export const metadata = { title: "振込データ" };

const ACCOUNT_TYPE = { ordinary: "普通", checking: "当座" } as const;

function BankLine({ bank, holderHalf }: { bank: BankFields; holderHalf: string }) {
  return (
    <p className="mt-1 break-all text-xs text-muted-foreground">
      {bank.bankNameKana || "（銀行名なし）"}（{bank.bankCode}）・{bank.branchNameKana || "（支店名なし）"}（{bank.branchCode}）・{ACCOUNT_TYPE[bank.accountType]}{" "}
      <span className="num">{bank.accountNumber}</span>・{holderHalf}
    </p>
  );
}

function IncludedList({ rows }: { rows: TransferRow[] }) {
  return (
    <ul className="divide-y divide-border rounded-card border border-border bg-card">
      {rows.map((r) => (
        <li key={r.statementId} className="p-3">
          <div className="flex items-baseline justify-between gap-3">
            <p className="min-w-0 font-bold">
              {r.driverName}
              {r.driverCode && <span className="ml-2 text-xs font-normal text-muted-foreground">{r.driverCode}</span>}
            </p>
            <Money value={r.amount} className="font-bold" />
          </div>
          <BankLine bank={r.bank} holderHalf={r.holderHalf} />
          {r.inBatches.length > 0 && (
            <p className="mt-1 text-xs">
              <Badge tone={r.inBatches.some((b) => b.executedOn) ? "green" : "yellow"}>
                {r.inBatches.some((b) => b.executedOn) ? "振込済みの記録あり" : "振込データに入っています"}
              </Badge>
              <span className="ml-2 text-muted-foreground">{r.inBatches.map((b) => b.fileName).join("、")}</span>
            </p>
          )}
        </li>
      ))}
    </ul>
  );
}

function ExcludedList({ rows, m }: { rows: ExcludedRow[]; m: string }) {
  return (
    <ul className="divide-y divide-border rounded-card border border-warning/40 bg-card">
      {rows.map((r) => (
        <li key={r.statementId} className="p-3">
          <div className="flex items-baseline justify-between gap-3">
            <p className="min-w-0 font-bold">
              {r.driverName}
              {r.driverCode && <span className="ml-2 text-xs font-normal text-muted-foreground">{r.driverCode}</span>}
            </p>
            <Money value={r.amount} />
          </div>
          <p className="mt-1 text-sm">{r.message}</p>
          {r.issues.length > 0 && (
            <ul className="mt-1 list-disc pl-5 text-sm text-danger">
              {r.issues.map((i) => (
                <li key={i}>{i}</li>
              ))}
            </ul>
          )}
          <p className="mt-2">
            {r.reason === "not_positive" ? (
              <Link href={`/statements?m=${m}`} className="inline-flex min-h-11 items-center text-sm">
                明細を確かめる →
              </Link>
            ) : (
              <>
                <Link href={`/settings/drivers/${r.driverId}`} className="mr-4 inline-flex min-h-11 items-center text-sm">
                  {r.driverName}さんの設定で口座を{r.reason === "no_bank" ? "入れる" : "直す"} →
                </Link>
                <Link href={`/import?m=${m}&kind=bank`} className="inline-flex min-h-11 items-center text-sm">
                  口座の一覧・先月の振込ファイルから取り込む →
                </Link>
              </>
            )}
          </p>
        </li>
      ))}
    </ul>
  );
}

function BatchCard({
  b,
  promisedPayDate,
  canEdit,
  zenginReady,
  m,
  bankMoved = [],
}: {
  b: BatchView;
  promisedPayDate: string;
  canEdit: boolean;
  zenginReady: boolean;
  m: string;
  /** 作ったあとに口座が変わった人（いればダウンロードさせない） */
  bankMoved?: string[];
}) {
  const lateTransfer = daysBetween(promisedPayDate, b.transferDate);
  const lateExecuted = b.executedOn ? daysBetween(promisedPayDate, b.executedOn) : 0;
  return (
    <li>
      <Card className="space-y-3">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div className="min-w-0">
            <p className="break-all font-bold">{b.fileName}</p>
            <p className="text-xs text-muted-foreground">
              {jstDateTime(b.createdAt)} に{b.createdByName ? `${b.createdByName}さんが` : ""}作成
            </p>
          </div>
          {b.executedOn ? <Badge tone="green">振込済み（{shortDate(b.executedOn)}）</Badge> : <Badge>振り込んだ日は未記録</Badge>}
        </div>
        <dl className="grid grid-cols-2 gap-2 text-sm sm:grid-cols-3">
          <div>
            <dt className="text-xs text-muted-foreground">振込指定日</dt>
            <dd className="font-bold">{shortDate(b.transferDate)}</dd>
          </div>
          <div>
            <dt className="text-xs text-muted-foreground">人数</dt>
            <dd className="num font-bold">{b.count}人</dd>
          </div>
          <div className="col-span-2 sm:col-span-1">
            <dt className="text-xs text-muted-foreground">合計</dt>
            <dd>
              <Money value={b.total} className="font-bold" />
            </dd>
          </div>
        </dl>
        {lateTransfer > 0 && (
          <p className="text-sm text-danger">振込指定日が、約束した支払日（{shortDate(promisedPayDate)}）より {lateTransfer} 日あとです。</p>
        )}
        {lateExecuted > 0 && (
          <p className="text-sm text-danger">
            約束した支払日（{shortDate(promisedPayDate)}）より {lateExecuted} 日あとに振り込んだ記録です（{b.count}人とも {lateExecuted} 日遅れ）。見張り番の指摘も確かめてください。
          </p>
        )}
        {b.executedOn && lateExecuted <= 0 && (
          <p className="text-sm text-success">
            期日内：約束した支払日（{shortDate(promisedPayDate)}）までに振り込んだ記録です（{b.count}人）。
          </p>
        )}
        {bankMoved.length > 0 && !b.executedOn && (
          <p role="alert" className="rounded-lg border border-danger/40 bg-danger/10 p-3 text-sm text-danger">
            この振込データを作ったあとに、口座が変わった人がいます（{bankMoved.join("、")}）。確かめていない口座に振り込まないよう、ダウンロードを止めています。取り消して作り直してください。
          </p>
        )}
        {b.changed && !b.executedOn && (
          <p role="alert" className="rounded-lg border border-danger/40 bg-danger/10 p-3 text-sm text-danger">
            この振込データを作ったあとに明細が変わりました（いま {b.currentCount}人・{yenText(b.currentTotal)}）。このデータは使わず、取り消して作り直してください。
          </p>
        )}
        {b.changed && b.executedOn && b.paidDiffOpen > 0 && (
          <p role="alert" className="rounded-lg border border-danger/40 bg-danger/10 p-3 text-sm text-danger">
            振り込んだあとに明細が変わり、振り込んだ額と明細の額が違う人が {b.paidDiffOpen}人います。下の「振り込んだ額と明細の額の差」で、差をどう精算するかを記録してください。{" "}
            <a href="#paid-diff-heading" className="font-bold">
              差を見る ↓
            </a>
          </p>
        )}
        {b.changed && b.executedOn && b.paidDiffOpen === 0 && (
          <p className="rounded-lg border border-border bg-muted p-3 text-sm">
            振り込んだあとに明細が変わりました（いま {b.currentCount}人・{yenText(b.currentTotal)}）。振り込んだ額との差は、どの人も精算の記録があるか、差がありません。
          </p>
        )}
        {canEdit && !b.changed && bankMoved.length === 0 && (
          <div className="flex flex-wrap gap-2">
            {zenginReady ? (
              <a href={`/api/transfer/${b.id}?m=${m}`} className={buttonClass("primary")}>
                全銀の振込データ
              </a>
            ) : (
              <span className="text-sm text-muted-foreground">全銀の振込データは、振込依頼人を設定すると出せます。</span>
            )}
            <a href={`/api/transfer/${b.id}?format=csv&m=${m}`} className={buttonClass("secondary")}>
              振込の一覧（CSV）
            </a>
          </div>
        )}
        {canEdit ? (
          <ExecutedOnForm batchId={b.id} executedOn={b.executedOn} suggested={b.transferDate} />
        ) : (
          <p className="text-sm">実際に振り込んだ日：{b.executedOn ? shortDate(b.executedOn) : "未記録"}</p>
        )}
        {canEdit && !b.executedOn && <DeleteBatchButton batchId={b.id} fileName={b.fileName} />}
      </Card>
    </li>
  );
}

/** 振り込んだあとに明細が変わった人：振り込んだ額・今の明細・差と、精算の記録 */
function PaidDiffSection({ report, canEdit, m }: { report: PaidDiffReport; canEdit: boolean; m: string }) {
  const nextLabel = monthLabelJa(report.nextMonth);
  return (
    <section aria-labelledby="paid-diff-heading" className="space-y-3">
      <h2 id="paid-diff-heading" className="text-lg font-bold">
        振り込んだ額と明細の額の差
      </h2>
      <p className="text-sm text-muted-foreground">
        振り込んだあとに明細が作り直され、振り込んだ額と今の明細の額が違う人です。二重に振り込まないよう、この人たちは「まだ振込データに入っていない人だけ」の振込データには入りません。
        差をどう精算したか（{nextLabel}分の明細の調整・別に振り込んだ など）を、人ごとに記録してください。記録は操作の記録に残ります。{" "}
        <Link href="/help#faq-paid-diff" className="font-bold">
          振り込んだあとに間違いが分かったら
        </Link>
      </p>
      <dl className="grid grid-cols-2 gap-3 sm:grid-cols-3">
        <Card>
          <dt className="text-xs text-muted-foreground">精算の記録がまだの人</dt>
          <dd className={`num text-xl font-bold ${report.openCount ? "text-danger" : ""}`}>{report.openCount}人</dd>
        </Card>
        <Card>
          <dt className="text-xs text-muted-foreground">払い足りない（まだ）</dt>
          <dd className="text-xl font-bold">
            <Money value={report.underpaid} />
          </dd>
        </Card>
        <Card className="col-span-2 sm:col-span-1">
          <dt className="text-xs text-muted-foreground">払いすぎ（まだ）</dt>
          <dd className="text-xl font-bold">
            <Money value={report.overpaid} />
          </dd>
        </Card>
      </dl>
      <ul className="space-y-3">
        {report.rows.map((r) => (
          <li key={r.driverId}>
            <Card className="space-y-3">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <p className="min-w-0 font-bold">
                  {r.driverName}
                  {r.driverCode && <span className="ml-2 text-xs font-normal text-muted-foreground">{r.driverCode}</span>}
                </p>
                {r.outstanding === 0 ? <Badge tone="green">精算の記録あり</Badge> : <Badge tone="red">精算の記録がまだ</Badge>}
              </div>
              <dl className="grid grid-cols-1 gap-2 text-sm sm:grid-cols-3">
                <div>
                  <dt className="text-xs text-muted-foreground">
                    振り込んだ額（{r.paidVersions.length ? r.paidVersions.map((v) => `第${v}版`).join("・") : "版の記録なし"}・{r.paidOn.map((d) => shortDate(d)).join("・")}）
                  </dt>
                  <dd>
                    <Money value={r.paid} className="font-bold" />
                  </dd>
                </div>
                <div>
                  <dt className="text-xs text-muted-foreground">今の明細{r.statementVersion !== null ? `（第${r.statementVersion}版）` : "（明細なし）"}</dt>
                  <dd>
                    <Money value={r.statementTotal} className="font-bold" />
                  </dd>
                </div>
                <div>
                  <dt className="text-xs text-muted-foreground">差（明細 − 振り込んだ額）</dt>
                  <dd className="font-bold">{diffText(r.difference)}</dd>
                </div>
              </dl>
              {r.settlements.length > 0 && (
                <ul className="space-y-1 text-sm">
                  {r.settlements.map((x) => (
                    <li key={x.id} className={x.voided ? "text-danger" : ""}>
                      {x.method === "next_month"
                        ? x.voided
                          ? `${x.nextMonth ? monthLabelJa(x.nextMonth) : nextLabel}分の明細の調整で精算する記録でしたが、その調整が消されています（精算になっていません）。`
                          : `${x.nextMonth ? monthLabelJa(x.nextMonth) : nextLabel}分の明細の調整で精算：${x.amount < 0 ? "−" : "＋"}${yenText(Math.abs(x.amount))}`
                        : `別の方法で精算：${x.settledOn ? shortDate(x.settledOn) : ""}・${diffText(x.amount)}${x.note ? `（${x.note}）` : ""}`}
                      <span className="ml-1 text-xs text-muted-foreground">
                        {jstDateTime(x.at)}
                        {x.userName ? `・${x.userName}さん` : ""}
                      </span>
                      {x.method === "next_month" && !x.voided && x.nextMonth && (
                        <Link href={`/work?m=${x.nextMonth.slice(0, 7)}`} className="ml-2 inline-flex min-h-11 items-center">
                          調整を見る →
                        </Link>
                      )}
                      {canEdit && x.method === "outside" && <UndoSettlementButton month={report.month} settleId={x.id} />}
                    </li>
                  ))}
                </ul>
              )}
              {r.outstanding !== 0 && r.settled !== 0 && <p className="text-sm">まだ精算の記録が無い差：{diffText(r.outstanding)}</p>}
              {r.outstanding !== 0 &&
                (canEdit ? (
                  <SettleForm
                    key={`${r.driverId}:${r.outstanding}`}
                    month={report.month}
                    driverId={r.driverId}
                    driverName={r.driverName}
                    outstanding={r.outstanding}
                    nextMonthLabel={nextLabel}
                    nextMonthClosed={report.nextMonthClosed}
                  />
                ) : (
                  <p className="text-sm text-muted-foreground">精算の仕方を記録するのは、事務・オーナーの方です。</p>
                ))}
              {r.statementId && (
                <Link href={`/statements/${r.statementId}?m=${m}`} className="inline-flex min-h-11 items-center text-sm">
                  明細と版の違いを見る →
                </Link>
              )}
            </Card>
          </li>
        ))}
      </ul>
    </section>
  );
}

/** 振込データ：明細の振込額から、銀行にそのまま出せるファイルを作る。作った記録と、実際に振り込んだ日も残す */
export default async function TransferPage({ searchParams }: { searchParams: Promise<{ m?: string }> }) {
  const user = await requirePageUser("viewer");
  const month = monthFromParam((await searchParams).m);
  const m = monthParam(month);
  const db = await getDb();
  const [plan, paidDiff] = await Promise.all([loadTransferPlan(db, user.tenantId, month), loadPaidDifferences(db, user.tenantId, month)]);
  const canEdit = roleAtLeast(user.role, "staff");
  // 口座の変更などの確かめは、作れる人にだけ出す（閲覧の人には口座を見せない）
  const review = canEdit ? await loadTransferReview(db, user.tenantId, month, plan) : null;
  const bankMovedBy = new Map((review?.staleBankBatches ?? []).map((b) => [b.batchId, b.drivers]));
  const zenginReady = plan.requester !== null;
  const remaining = plan.included.filter((r) => r.inBatches.length === 0);

  return (
    <div className="space-y-8">
      <PageHeader
        title="振込データ"
        month={month}
        basePath="/transfer"
        description="保存した明細の振込額から、銀行の「総合振込」にそのまま読み込めるファイル（全銀の形式）を作ります。振込手数料は差し引きません。"
      />

      {plan.feeBearerDriver && (
        <p role="alert" className="rounded-lg border border-danger/40 bg-danger/10 p-3 text-sm text-danger">
          会社の設定で「振込手数料はドライバーの負担」になっています。この振込データは明細の振込額のまま作り、手数料は差し引きません。
          手数料の扱いについて、見張り番の指摘を確かめてください。{" "}
          <Link href={`/watch?m=${m}`} className="font-bold">
            見張り番を開く →
          </Link>
        </p>
      )}

      {!canEdit && <Notice tone="info">振込データを作れるのは事務・オーナーの方です。ここでは作った記録と、振り込んだ日を見られます。</Notice>}

      {canEdit && (
        <>
          {!plan.ready ? (
            <EmptyState title={plan.savedStatements === 0 ? "まだ振込データを作れません" : "明細が最新ではありません"}>
              <p>{plan.blockReason}</p>
              {plan.closed ? (
                <Link href={`/close?m=${m}`} className={buttonClass("secondary", "mt-3")}>
                  締めの画面へ（締めを外せるのはオーナーです）
                </Link>
              ) : (
                <Link href={`/statements?m=${m}`} className={buttonClass("primary", "mt-3")}>
                  支払明細を{plan.savedStatements === 0 ? "作る" : "作り直す"}
                </Link>
              )}
            </EmptyState>
          ) : (
            <section className="space-y-4" aria-labelledby="create-heading">
              <h2 id="create-heading" className="text-lg font-bold">
                {monthLabelJa(month)}分の振込データを作る
              </h2>
              {!plan.closed && (
                <Notice tone="info">
                  この月はまだ締めていません。振込データは作れますが、このあとで稼働や控除が変わると作り直しになります。先に締めておくと安心です。{" "}
                  <Link href={`/close?m=${m}`}>締めの画面へ</Link>
                </Notice>
              )}
              <dl className="grid grid-cols-2 gap-3 sm:grid-cols-3">
                <Card className="col-span-2 sm:col-span-1">
                  <dt className="text-xs text-muted-foreground">振込額の合計</dt>
                  <dd className="text-xl font-bold">
                    <Money value={plan.total} />
                  </dd>
                </Card>
                <Card>
                  <dt className="text-xs text-muted-foreground">振込する人</dt>
                  <dd className="num text-xl font-bold">{plan.included.length}人</dd>
                </Card>
                <Card>
                  <dt className="text-xs text-muted-foreground">入らない人</dt>
                  <dd className={`num text-xl font-bold ${plan.excluded.length ? "text-warning" : ""}`}>{plan.excluded.length}人</dd>
                </Card>
              </dl>

              <Card>
                <h3 className="font-bold">振込依頼人（会社の口座）</h3>
                {plan.requester ? (
                  <p className="mt-1 break-all text-sm text-muted-foreground">
                    依頼人コード <span className="num">{plan.requester.code}</span>・{plan.requester.nameKana}・{plan.requester.bankNameKana || plan.requester.bankCode}（
                    {plan.requester.bankCode}）{plan.requester.branchNameKana || ""}（{plan.requester.branchCode}）・{ACCOUNT_TYPE[plan.requester.accountType]}{" "}
                    <span className="num">{plan.requester.accountNumber}</span>
                  </p>
                ) : (
                  <div className="mt-2 space-y-2 text-sm">
                    <p>全銀の振込データを作るには、会社の口座と、銀行から知らされる振込依頼人コードが必要です。足りないところ：</p>
                    <ul className="list-disc pl-5 text-danger">
                      {plan.requesterProblems.map((p) => (
                        <li key={p}>{p}</li>
                      ))}
                    </ul>
                    <p className="text-muted-foreground">設定が無くても、振込の一覧（CSV）は出せます。銀行の画面で手で入れるときに使ってください。</p>
                    <Link href="/settings/company" className={buttonClass("secondary")}>
                      会社の設定で入れる
                    </Link>
                  </div>
                )}
              </Card>

              {review && <TransferReviewSection review={review} m={m} />}

              <Card>
                <CreateTransferForm
                  key={month}
                  month={month}
                  defaultDate={plan.defaultTransferDate}
                  promisedPayDate={plan.promisedPayDate}
                  earlierBatches={plan.batches.length}
                  executedBatches={plan.batches.filter((b) => b.executedOn).length}
                  all={{ count: plan.included.length, total: plan.total }}
                  remaining={{ count: remaining.length, total: remaining.reduce((a, r) => a + r.amount, 0) }}
                  zenginReady={zenginReady}
                  bankChanged={{ all: review?.bank.changed.length ?? 0, remaining: review?.changedRemaining ?? 0 }}
                  bankKeys={review?.bankKeys}
                />
              </Card>

              <div>
                <h3 className="mb-2 font-bold">振込する人（{plan.included.length}人）</h3>
                {plan.included.length ? (
                  <IncludedList rows={plan.included} />
                ) : (
                  <EmptyState title="振込する人がいません">口座と振込額を確かめてください。</EmptyState>
                )}
              </div>

              {plan.excluded.length > 0 && (
                <div>
                  <h3 className="mb-1 font-bold">振込データに入らない人（{plan.excluded.length}人）</h3>
                  <p className="mb-2 text-sm text-muted-foreground">
                    この人たちには振込データでは振り込みません。口座を直したら、「まだ振込データに入っていない人だけ」で追加のデータを作れます。
                  </p>
                  <ExcludedList rows={plan.excluded} m={m} />
                </div>
              )}
            </section>
          )}
        </>
      )}

      {paidDiff.rows.length > 0 && <PaidDiffSection report={paidDiff} canEdit={canEdit} m={m} />}

      <section aria-labelledby="history-heading" className="space-y-3">
        <h2 id="history-heading" className="text-lg font-bold">
          作った振込データ
        </h2>
        {plan.batches.length === 0 ? (
          <EmptyState title="この月の振込データはまだありません">
            {canEdit ? "上の「振込データを作る」から作ると、ここに記録が残ります。" : "事務・オーナーの方が作ると、ここに記録が出ます。"}
          </EmptyState>
        ) : (
          <>
            <p className="text-sm text-muted-foreground">
              銀行で振り込んだら「実際に振り込んだ日」を入れてください。約束した支払日（{shortDate(plan.promisedPayDate)}）に間に合ったかを、見張り番が記録から確かめます。締めたあとでも入れられます。
            </p>
            <ul className="space-y-3">
              {plan.batches.map((b) => (
                <BatchCard
                  key={b.id}
                  b={b}
                  promisedPayDate={plan.promisedPayDate}
                  canEdit={canEdit}
                  zenginReady={zenginReady}
                  m={m}
                  bankMoved={bankMovedBy.get(b.id)}
                />
              ))}
            </ul>
          </>
        )}
      </section>

      {canEdit && (
        <section className="space-y-2 text-sm text-muted-foreground">
          <h2 className="text-base font-bold text-foreground">銀行に出すときに</h2>
          <ul className="list-disc space-y-1 pl-5">
            <li>全銀の振込データは、全銀協の形式（1 行 120 桁・Shift_JIS）です。インターネットバンキングの「総合振込」の「ファイルの取り込み（アップロード）」から読み込んでください。</li>
            <li>銀行によって細かい決まりが少し違うことがあります。初めて使うときは、銀行の画面で人数と合計（この画面の数字）が同じか確かめてから振り込んでください。</li>
            <li>口座名義は半角カナに直しています（小さい「ッ」「ョ」などは大きい文字になります）。</li>
            <li>振込手数料は差し引いていません。明細の振込額のまま振り込みます。</li>
          </ul>
        </section>
      )}
    </div>
  );
}
