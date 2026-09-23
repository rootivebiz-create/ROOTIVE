import Link from "next/link";
import { Card, buttonClass } from "@/components/ui";
import { en } from "@/lib/engine/types";
import { EmptyState, Notice, PageHeader } from "~/components/page";
import { BurdenPanel } from "~/components/profit/burden-panel";
import { KpiCards } from "~/components/profit/kpi-cards";
import { ClientTable, DriverTable, ProjectTable } from "~/components/profit/tables";
import { TrendChart } from "~/components/profit/trend-chart";
import { getDb } from "~/db/client";
import { requirePageUser, roleAtLeast } from "~/server/auth";
import { loadProfitPage, parseSort, sortRows, SORTS, type SortKey } from "~/server/features/profit";
import { monthFromParam, monthLabelJa, monthParam } from "~/server/month";

export const metadata = { title: "利益" };

function SortLinks({ m, sort }: { m: string; sort: SortKey }) {
  return (
    <nav aria-label="表の並べ替え" className="flex flex-wrap gap-2">
      {SORTS.map((s) => (
        <Link
          key={s.key}
          href={`/profit?m=${m}&sort=${s.key}#tables`}
          aria-current={s.key === sort ? "true" : undefined}
          className={`inline-flex min-h-11 items-center rounded-full border px-4 text-sm no-underline ${
            s.key === sort ? "border-foreground bg-foreground font-bold text-background" : "border-border bg-card text-foreground hover:bg-muted"
          }`}
        >
          {s.label}
        </Link>
      ))}
    </nav>
  );
}

/** 利益：どの案件・元請・ドライバーでもうかっているか・損をしているか。推移と、インボイスの経過措置の負担も */
export default async function ProfitPage({ searchParams }: { searchParams: Promise<{ m?: string; sort?: string }> }) {
  const user = await requirePageUser("viewer");
  const sp = await searchParams;
  const month = monthFromParam(sp.m);
  const m = monthParam(month);
  const sort = parseSort(sp.sort);
  const db = await getDb();
  const page = await loadProfitPage(db, user.tenantId, month);
  const { current } = page;
  const t = current.totals;
  const hasData = current.drafts.length > 0;
  const canImport = roleAtLeast(user.role, "staff");
  const lossProjects = current.projects.filter((p) => p.profit < 0).length;

  return (
    <div className="space-y-8">
      <PageHeader
        title="利益"
        month={month}
        basePath="/profit"
        description="案件・元請・ドライバーごとに、どこでもうかっているか・損をしているかを見ます。金額はすべて税抜です。"
        actions={
          hasData ? (
            <a href={`/api/profit/pdf?m=${m}`} className={buttonClass("primary")}>
              社長の1枚（PDF）
            </a>
          ) : undefined
        }
      />

      {current.source === "snapshot" ? (
        <Notice tone="info">締めた月です。締めたときに保存した明細の数字で出しています（あとで単価や設定を変えても、この月の数字は変わりません）。</Notice>
      ) : current.snapshotMissing ? (
        <Notice tone="info">締めた月ですが、明細の写しが保存されていません。今の稼働と設定から計算して出しています。</Notice>
      ) : hasData ? (
        <Notice tone="info">まだ締めていない月です。今の稼働と設定から計算しています。稼働や控除が変われば、数字も変わります。</Notice>
      ) : null}

      {!hasData ? (
        <EmptyState title={`${monthLabelJa(month)}の稼働がまだありません`}>
          {canImport ? (
            <>
              <p>稼働（Excel）を取り込むと、案件・元請・ドライバーごとの利益がここに出ます。</p>
              <Link href={`/import?m=${m}`} className={buttonClass("primary", "mt-3")}>
                稼働を取り込む
              </Link>
            </>
          ) : (
            <p>事務の方が稼働を取り込むと、ここに利益が出ます。前後の月は、上の「‹ ›」で見られます。</p>
          )}
        </EmptyState>
      ) : (
        <>
          <KpiCards totals={t} changes={page.changes} />
          <Card className="text-sm">
            <p className="font-bold">会社の利益の中身</p>
            <dl className="mt-2 grid gap-1 sm:grid-cols-2">
              <div className="flex justify-between gap-3 border-b border-border py-1">
                <dt>案件の粗利（売上 − 委託料）</dt>
                <dd className="num">{en(t.gross)}</dd>
              </div>
              <div className="flex justify-between gap-3 border-b border-border py-1">
                <dt>＋ 控除（ロイヤリティ・管理費など）</dt>
                <dd className="num">{en(t.deductions)}</dd>
              </div>
              <div className="flex justify-between gap-3 border-b border-border py-1">
                <dt>− 経過措置の負担</dt>
                <dd className="num">{en(-t.burden)}</dd>
              </div>
              <div className="flex justify-between gap-3 border-b-2 border-foreground py-1 font-bold">
                <dt>＝ 会社の利益</dt>
                <dd className={`num ${t.profit < 0 ? "text-danger" : ""}`}>{en(t.profit)}</dd>
              </div>
            </dl>
            <p className="mt-2 text-xs text-muted-foreground">
              消費税と、立替の精算などの調整は利益に入れていません。売上は受注の単価 × 数量から出したもので、元請からの実際の入金とは違うことがあります（違いは「元請との突合」で確かめられます）。
            </p>
          </Card>
        </>
      )}

      <section aria-labelledby="trend-heading" className="space-y-3">
        <h2 id="trend-heading" className="text-lg font-bold">
          会社の利益の推移（直近 6 か月）
        </h2>
        <TrendChart points={page.trend} month={month} />
      </section>

      {hasData && (
        <section id="tables" aria-labelledby="tables-heading" className="scroll-mt-24 space-y-6">
          <div className="space-y-3">
            <h2 id="tables-heading" className="text-lg font-bold">
              どこでもうかっているか
            </h2>
            <nav aria-label="表へ移る" className="flex flex-wrap gap-x-4 text-sm">
              <a href="#projects" className="inline-flex min-h-11 items-center">
                案件ごと
              </a>
              <a href="#clients" className="inline-flex min-h-11 items-center">
                元請ごと
              </a>
              <a href="#drivers" className="inline-flex min-h-11 items-center">
                ドライバーごと
              </a>
            </nav>
            <SortLinks m={m} sort={sort} />
            {lossProjects > 0 && (
              <p role="status" className="rounded-lg border border-danger/40 bg-danger/10 p-3 text-sm text-danger">
                売上より委託料が多い案件が {lossProjects} 件あります（赤字の印の行）。受注の単価（元請との取り決め）と支払の単価の記録に、入れ間違いが無いか確かめてください。
              </p>
            )}
          </div>

          <div id="projects" className="scroll-mt-24 space-y-2">
            <h3 className="font-bold">案件ごと</h3>
            <ProjectTable rows={sortRows(current.projects, sort)} totals={t} />
          </div>

          <div id="clients" className="scroll-mt-24 space-y-2">
            <h3 className="font-bold">元請ごと</h3>
            <ClientTable rows={sortRows(current.clients, sort)} totals={t} />
          </div>

          <div id="drivers" className="scroll-mt-24 space-y-2">
            <h3 className="font-bold">ドライバーごと</h3>
            <p className="text-sm text-muted-foreground">
              会社の利益 ＝ 売上 − 委託料 ＋ 控除 − 経過措置の負担。どの案件を担当しているかで大きく変わります。
            </p>
            <DriverTable rows={sortRows(current.drivers, sort)} totals={t} />
          </div>
        </section>
      )}

      {hasData && (
        <section aria-labelledby="burden-heading">
          <BurdenPanel future={page.future} month={month} />
        </section>
      )}

      {hasData && (
        <Card className="flex flex-wrap items-center justify-between gap-3">
          <div className="min-w-0">
            <p className="font-bold">社長の1枚（PDF）</p>
            <p className="text-sm text-muted-foreground">この月の利益・前月比・案件の上位と下位・経過措置の負担・突合の差・見張り番・ドライバーの確認・振込を A4 の 1 枚にまとめます。</p>
          </div>
          <a href={`/api/profit/pdf?m=${m}`} className={buttonClass("secondary")}>
            PDF をダウンロード
          </a>
        </Card>
      )}
    </div>
  );
}
