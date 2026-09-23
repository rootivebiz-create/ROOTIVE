import Link from "next/link";
import { Card, Money, buttonClass } from "@/components/ui";
import { pct } from "@/lib/payroll/money";
import { Badge, EmptyState, Notice, PageHeader } from "~/components/page";
import { MappingForm } from "~/components/export/mapping-form";
import { AccountTotals, SlipPreview } from "~/components/export/slip-preview";
import { getDb } from "~/db/client";
import { requirePageUser } from "~/server/auth";
import { deductibleRateForExempt } from "@/lib/payroll/tax";
import { periodOf } from "~/server/calc/statement";
import { exportFileName, loadAccountingView, parseSoftware, SOFTWARE, SOFTWARE_KEYS } from "~/server/features/accounting";
import { monthFromParam, monthLabelJa, monthParam } from "~/server/month";
import { getTenant } from "~/server/repo";

export const metadata = { title: "会計ソフトへ" };

/** 会計ソフトへ：明細の数字から、会計ソフトに取り込める仕訳と、支払一覧を出す */
export default async function ExportPage({ searchParams }: { searchParams: Promise<{ m?: string; soft?: string }> }) {
  const user = await requirePageUser("staff");
  const sp = await searchParams;
  const month = monthFromParam(sp.m);
  const m = monthParam(month);
  const db = await getDb();
  const [view, tenant] = await Promise.all([loadAccountingView(db, user.tenantId, month, parseSoftware(sp.soft)), getTenant(db, user.tenantId)]);
  const { info, check } = view;
  // 締めの期間が経過措置の段の境目をまたぐ月（例：20日締めの 9/21〜10/20）。仕訳は期間の末日の割合で、会社の控え・利益は日ごとに分けた目安
  const period = periodOf(month, tenant.closingDay);
  const spansStep = deductibleRateForExempt(period.from) !== deductibleRateForExempt(period.to);
  const spanNote = spansStep ? "仕訳の税区分は締めの期間の末日の割合です（会社の控え・利益の画面は日ごとに分けた目安）。" : "";
  const hasData = check.drivers > 0;
  const showTax = info.taxMode === "inclusive";

  return (
    <div className="space-y-8">
      <PageHeader
        title="会計ソフトへ"
        month={month}
        basePath="/export"
        description="明細の数字から、会計ソフトに取り込める仕訳（ドライバー 1 人ごとに 1 枚の伝票）と、支払一覧を作ります。打ち直しは要りません。"
      />

      <p role="note" className="rounded-lg border border-warning/40 bg-warning/10 p-4 text-sm font-bold text-foreground">
        会計ソフトへの取り込みの前に、勘定科目と税区分を顧問の税理士さんと確かめてください。はじめての月は、数件だけで取り込みを試してください。
      </p>

      {hasData &&
        (view.source === "snapshot" ? (
          <Notice tone="info">締めた月です。締めたときに保存した明細の数字から作ります。</Notice>
        ) : view.snapshotMissing ? (
          <Notice tone="info">締めた月ですが、明細の写しがありません。今の稼働と設定から計算した数字で作ります。</Notice>
        ) : (
          <Notice tone="info">
            この月はまだ締めていません。あとで稼働や控除が変わると、仕訳も変わります。締めてから出すことをおすすめします。{" "}
            <Link href={`/close?m=${m}`}>締めの画面へ</Link>
          </Notice>
        ))}

      <section aria-labelledby="soft-heading" className="space-y-3">
        <h2 id="soft-heading" className="text-lg font-bold">
          会計ソフトを選ぶ
        </h2>
        <nav aria-label="会計ソフト" className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          {SOFTWARE_KEYS.map((k) => {
            const active = k === view.software;
            return (
              <Link
                key={k}
                href={`/export?m=${m}&soft=${k}`}
                aria-current={active ? "page" : undefined}
                className={`flex min-h-11 flex-col items-center justify-center rounded-lg border px-2 py-2 text-center text-sm no-underline ${
                  active ? "border-foreground bg-foreground font-bold text-background" : "border-border bg-card text-foreground hover:bg-muted"
                }`}
              >
                {SOFTWARE[k].short}
                {view.savedSoftware === k && <span className={`text-xs font-normal ${active ? "" : "text-muted-foreground"}`}>いつもの</span>}
              </Link>
            );
          })}
        </nav>
        <ul className="list-disc space-y-1 pl-5 text-sm text-muted-foreground">
          {info.about.map((a) => (
            <li key={a}>{a}</li>
          ))}
        </ul>
      </section>

      {!hasData ? (
        <EmptyState title={`${monthLabelJa(month)}の明細がまだありません`}>
          <p>稼働を取り込むと、この月の仕訳と支払一覧を出せます。</p>
          <Link href={`/import?m=${m}`} className={buttonClass("primary", "mt-3")}>
            稼働を取り込む
          </Link>
        </EmptyState>
      ) : (
        <section aria-labelledby="journal-heading" className="space-y-4">
          <h2 id="journal-heading" className="text-lg font-bold">
            {monthLabelJa(month)}分の仕訳（{info.short}）
          </h2>

          {view.error ? (
            <p role="alert" className="rounded-lg border border-danger/40 bg-danger/10 p-3 text-sm text-danger">
              {view.error}。仕訳は作っていません。明細の画面で明細を作り直してから、もう一度開いてください。
            </p>
          ) : (
            <dl className="grid grid-cols-1 gap-3 min-[360px]:grid-cols-2 sm:grid-cols-4">
              <Card>
                <dt className="text-xs text-muted-foreground">伝票</dt>
                <dd className="num text-xl font-bold">{check.slips}枚</dd>
              </Card>
              <Card>
                <dt className="text-xs text-muted-foreground">借方の合計 ＝ 貸方の合計</dt>
                <dd className="text-lg font-bold sm:text-xl">
                  <Money value={check.debit} />
                </dd>
              </Card>
              <Card className="min-[360px]:col-span-2">
                <dt className="text-xs text-muted-foreground">未払金の残り（振込する額）</dt>
                <dd className="flex flex-wrap items-center gap-2 text-lg font-bold sm:text-xl">
                  <Money value={check.payableNet} />
                  {check.ok ? <Badge tone="green">明細の振込額の合計と一致</Badge> : <Badge tone="red">明細の振込額と違います</Badge>}
                </dd>
                <dd className="mt-1 text-xs text-muted-foreground">
                  明細の振込額の合計 <Money value={check.transferTotal} />。1 人ずつ、未払金の残りが明細の振込額と同じか確かめてから出しています。
                </dd>
              </Card>
            </dl>
          )}

          {view.statementGap.length > 0 && (
            <p role="alert" className="rounded-lg border border-warning/40 bg-warning/10 p-3 text-sm text-foreground">
              保存した明細（ドライバーに送った明細）と、今の稼働・設定から出した数字が違う方がいます：
              <span className="mx-1 font-bold">{view.statementGap.join("・")}</span>
              仕訳は今の数字で作るため、送った明細と合わなくなります。
              <Link href={`/statements?m=${m}`} className="font-bold">
                明細の画面
              </Link>
              で明細を作り直してから出してください。
            </p>
          )}
          {view.unmappable.length > 0 && (
            <p role="alert" className="rounded-lg border border-danger/40 bg-danger/10 p-3 text-sm text-danger">
              次の文字は、このファイルの文字コード（Shift_JIS）で表せないため「?」になります：
              <span className="mx-1 font-bold">{view.unmappable.join(" ")}</span>
              ドライバーや控除の名前で使っていれば、設定の画面で近い字（例：「𠮷」→「吉」）に直すか、汎用 CSV（UTF-8）で出してください。
            </p>
          )}
          {view.blankTaxDrivers.length > 0 && (
            <Notice tone="info">
              インボイスの登録が無い方（{view.blankTaxDrivers.join("さん・")}さん）の委託料は、税額の欄を空けて出します。経過措置で控除できる割合がかかるため、明細の「消費税相当額」をそのまま税額にはしていません。取り込んだあと、会計ソフトで税額が期待どおりになっているかを確かめ、扱いは税理士さんと確かめてください。
            </Notice>
          )}
          {view.neverSaved && (
            <Notice tone="info">勘定科目と税区分は、まだ既定の値（要確認）です。下の「勘定科目と税区分」で確かめて保存してから出すと安心です。</Notice>
          )}

          {!view.error && (
            <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center">
              <a href={`/api/export/${view.software}?m=${m}`} className={buttonClass("primary")}>
                {info.short}用の仕訳をダウンロード
              </a>
              <span className="break-all text-xs text-muted-foreground">
                {exportFileName(view.software, month)}（{info.encoding === "sjis" ? "Shift_JIS" : "UTF-8"}）
              </span>
            </div>
          )}

          {view.slips.length > 0 && (
            <>
              <details className="rounded-lg border border-border bg-card p-3" open>
                <summary className="min-h-11 cursor-pointer py-2 font-bold">中身を見る（{view.slips[0].driverName}さんの伝票）</summary>
                <div className="mt-2">
                  <SlipPreview slip={view.slips[0]} showTax={showTax} />
                </div>
              </details>
              {view.slips.length > 1 && (
                <details className="rounded-lg border border-border bg-card p-3">
                  <summary className="min-h-11 cursor-pointer py-2 font-bold">ほかの {view.slips.length - 1} 人の伝票</summary>
                  <div className="mt-2 space-y-6">
                    {view.slips.slice(1).map((slip) => (
                      <div key={slip.driverId}>
                        <p className="font-bold">{slip.driverName}さん</p>
                        <SlipPreview slip={slip} showTax={showTax} />
                      </div>
                    ))}
                  </div>
                </details>
              )}
              <details className="rounded-lg border border-border bg-card p-3">
                <summary className="min-h-11 cursor-pointer py-2 font-bold">勘定科目ごとの合計</summary>
                <div className="mt-2">
                  <AccountTotals totals={view.totals} />
                </div>
              </details>
            </>
          )}
        </section>
      )}

      <section aria-labelledby="mapping-heading" className="space-y-3">
        <h2 id="mapping-heading" className="text-lg font-bold">
          勘定科目と税区分
        </h2>
        <p className="text-sm text-muted-foreground">
          会社ごとに 1 回決めれば、翌月からはそのまま使います。
          {view.deductibleRate < 1 && `${monthLabelJa(month)}は、登録の無い方への支払の消費税のうち ${pct(view.deductibleRate)} を控除できる期間の税区分を使います。`}
          {spanNote}
        </p>
        <Card>
          <MappingForm
            key={view.software}
            software={view.software}
            softwareLabel={info.short}
            accountFields={view.accountFields}
            taxFields={view.taxFields}
            payableSubByDriver={view.payableSubByDriver}
          />
        </Card>
      </section>

      <section aria-labelledby="payments-heading" className="space-y-3">
        <h2 id="payments-heading" className="text-lg font-bold">
          支払一覧（CSV）
        </h2>
        <Card className="space-y-3">
          <p className="text-sm">
            ドライバー 1 人 1 行で、委託料・消費税・控除・調整・源泉徴収・振込額・振込予定日を並べた CSV（UTF-8）です。会計ソフト以外の集計や、税理士さんへの共有に使えます。
          </p>
          {hasData ? (
            <a href={`/api/export/payments?m=${m}`} className={buttonClass("secondary")}>
              支払一覧をダウンロード
            </a>
          ) : (
            <p className="text-sm text-muted-foreground">この月の明細ができると出せます。</p>
          )}
        </Card>
      </section>

      <section aria-labelledby="how-heading" className="space-y-2 text-sm text-muted-foreground">
        <h2 id="how-heading" className="text-base font-bold text-foreground">
          どう仕訳しているか
        </h2>
        <ul className="list-disc space-y-1 pl-5">
          <li>取引日はその月の末日、摘要は「ドライバー名 ◯年◯月分 委託料」などです。</li>
          <li>
            委託料：借方 外注費 ／ 貸方 未払金。登録の無い方は、その月の経過措置の割合の税区分にし、消費税相当額を含めた税込の額で出します（税額の欄は空けます）。
            {spanNote}
          </li>
          <li>控除（ロイヤリティ・管理費など）：借方 未払金 ／ 貸方 売上高（消費税のかからない控除は別の科目）。</li>
          <li>調整：支払を増やすものは 借方 立替金 ／ 貸方 未払金、減らすものは 借方 未払金 ／ 貸方 雑収入（どれも変えられます）。</li>
          <li>源泉徴収：借方 未払金 ／ 貸方 預り金。</li>
          <li>1 人ずつ、借方と貸方の合計が同じで、未払金の残りが明細の振込額と同じになることを確かめてから出します。合わないときは出しません。</li>
          <li>振込手数料・実際に振り込んだときの仕訳（未払金 ／ 普通預金）は入れていません。通帳や銀行の明細から入れてください。</li>
        </ul>
      </section>
    </div>
  );
}
