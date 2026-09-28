import Link from "next/link";
import { Card, Money, buttonClass } from "@/components/ui";
import { Badge, EmptyState, Notice, PageHeader } from "~/components/page";
import { GateStatus } from "~/components/parallel/gate-status";
import { GoLiveButton, UndoGoLiveButton } from "~/components/parallel/go-live";
import { ParallelEditor } from "~/components/parallel/parallel-editor";
import { ResultList } from "~/components/parallel/result-list";
import { getDb } from "~/db/client";
import { requirePageUser, roleAtLeast } from "~/server/auth";
import { GOLIVE_STREAK_TARGET, loadParallelReport } from "~/server/features/parallel";
import { monthFromParam, monthLabelJa, monthParam } from "~/server/month";

export const metadata = { title: "Excel と比べる" };

/**
 * 並行運用の比べ合わせ：しめ日ラボの振込額と、今の Excel の振込額をドライバーごとに並べる。
 * 差があれば、消費税・控除・調整・源泉徴収・数量・単価・端数のどれで説明できるかを探して、理由の見当を出す。
 */
export default async function ParallelPage({ searchParams }: { searchParams: Promise<{ m?: string }> }) {
  const user = await requirePageUser("viewer");
  const month = monthFromParam((await searchParams).m);
  const m = monthParam(month);
  const db = await getDb();
  // 画面・印刷用の報告・PDF は同じ中身（loadParallelReport）から作る
  const { view: v, golive, history, gate } = await loadParallelReport(db, user.tenantId, month);
  const canEdit = roleAtLeast(user.role, "staff");
  const isOwner = user.role === "owner";
  const staleCount = v.rows.filter((r) => r.stale).length;
  const draftCount = v.rows.filter((r) => r.source === "draft").length;
  const notEntered = v.rows.filter((r) => r.excelTotal === null).length;

  return (
    <div className="mx-auto max-w-4xl">
      <PageHeader
        title="Excel と比べる"
        month={month}
        basePath="/parallel"
        description="今の Excel で出した振込額を入れると、しめ日ラボの振込額と 1 人ずつ比べます。差があれば、理由の見当を出します。"
        actions={
          v.summary.compared > 0 ? (
            <>
              <a href={`/api/parallel/pdf?m=${m}`} className={buttonClass("primary")}>
                並行運用レポート（PDF）
              </a>
              <Link href={`/parallel/report?m=${m}`} className={buttonClass("secondary")}>
                印刷用の報告
              </Link>
            </>
          ) : undefined
        }
      />

      {golive ? (
        <Notice tone="ok">{monthLabelJa(golive)}分から、しめ日ラボで締めています。Excel と比べる画面は、これからも使えます。</Notice>
      ) : (
        <Notice tone="info">
          2〜3 か月、しめ日ラボと Excel の両方で締めて、差が 0 になったら Excel をやめてください。差が出たときは、どちらに合わせるかを決めてから直します（会社の取引条件が基準です）。
        </Notice>
      )}

      {v.rows.length === 0 && !canEdit ? (
        <div className="mt-6">
          <EmptyState title={`${monthLabelJa(month)}分は、まだ比べるものがありません`}>
            この月の稼働が入ると、しめ日ラボの振込額が出ます。Excel の額は事務・オーナーの方が入れます。
          </EmptyState>
        </div>
      ) : (
        <>
          <Card className="mt-6">
            <p className="text-sm font-bold text-muted-foreground">{monthLabelJa(month)}分</p>
            <p className="mt-1 text-2xl font-bold">{v.summary.sentence}</p>
            {v.rows.length > 0 && notEntered > 0 && (
              <p className="mt-1 text-sm text-muted-foreground">
                {v.rows.length}人のうち、Excel の額をまだ入れていない人が {notEntered}人います{canEdit ? "（下の表に入れるか、貼り付けてください）" : ""}。
              </p>
            )}
            {v.summary.compared > 0 && (
              <p className="mt-1 text-sm">
                {v.summary.different > 0 ? `差がある人が ${v.summary.different}人います。下の「理由の見当」を見て、Excel の計算と比べてください。` : "比べた人は、全員 Excel と同じです。"}
              </p>
            )}
            {v.summary.different > 0 && (
              <p className="mt-1 text-sm">
                差の合計（しめ日ラボ − Excel）<Money value={v.summary.diffTotal} className="font-bold" />：払い不足の可能性（Excel の方が少ない）{" "}
                <Money value={v.summary.oursHigher} />／払いすぎの可能性（Excel の方が多い） <Money value={v.summary.excelHigher} />
                {v.summary.unexplained > 0 ? `。理由のメモがまだ無い人 ${v.summary.unexplained}人` : "。差のある人には、全員理由のメモがあります"}
              </p>
            )}
            {v.rows.length === 0 && (
              <p className="mt-2 text-sm">
                この月の稼働がまだありません。先に <Link href={`/import?m=${m}`}>今の Excel を取り込む</Link> と、しめ日ラボの振込額が出ます。
              </p>
            )}
            {draftCount > 0 && (
              <p className="mt-2 text-sm text-muted-foreground">
                明細をまだ保存していない {draftCount}人は、今の稼働から出した見込みの額と比べています（<Link href={`/statements?m=${m}`}>明細を作る</Link>）。
              </p>
            )}
            {staleCount > 0 && (
              <p className="mt-2 text-sm text-warning">
                明細を作ったあとに稼働・設定が変わった人が {staleCount}人います。比べているのは保存した明細の額です。明細を作り直すと額が変わります。
              </p>
            )}
            {v.closed && <p className="mt-2 text-sm text-muted-foreground">この月は締めてあります。締めたときの明細の額と比べています（Excel の額は、締めたあとでも入れられます）。</p>}
          </Card>

          <div className="mt-6">
            {canEdit ? (
              <ParallelEditor
                // 月ごとに作り直す（保存していない下書きは月ごとに別）
                key={month}
                month={month}
                otherDrivers={v.otherDrivers}
                rows={v.rows.map((r) => ({
                  driverId: r.driverId,
                  name: r.name,
                  code: r.code,
                  ours: r.ours,
                  source: r.source,
                  stale: r.stale,
                  draftTotal: r.draftTotal,
                  excelTotal: r.excelTotal,
                  note: r.note,
                  parts: r.parts,
                }))}
              />
            ) : (
              <>
                <p className="mb-3 text-sm text-muted-foreground">Excel の額を入れるのは、事務・オーナーの方です。</p>
                <ResultList rows={v.rows} />
              </>
            )}
          </div>
        </>
      )}

      <section aria-labelledby="golive-heading" className="mt-8 space-y-3">
        <h2 id="golive-heading" className="text-lg font-bold">
          Excel をやめる目安
        </h2>
        <Card>
          <ul className="space-y-1 text-sm">
            {history.months.map((h) => (
              <li key={h.month} className="flex flex-wrap items-center gap-2">
                <span className="min-w-24">{monthLabelJa(h.month)}分</span>
                {h.state === "ok" ? (
                  <Badge tone="green">一致・説明済み（{h.compared}人）</Badge>
                ) : h.state === "diff" ? (
                  <Badge tone="yellow">
                    {h.compared}人中 {h.matched}人が一致
                  </Badge>
                ) : (
                  <Badge>比べていません</Badge>
                )}
                <Link href={`/parallel?m=${monthParam(h.month)}`} className="inline-flex min-h-11 items-center text-xs">
                  開く
                </Link>
              </li>
            ))}
          </ul>
          <p className="mt-2 text-sm">
            この月から続けて一致（または差の理由を説明済み）の月：<span className="font-bold">{history.streak} か月</span>
            {history.streak >= GOLIVE_STREAK_TARGET ? "。目安の 2〜3 か月に届いています。" : "。2〜3 か月続いたら、Excel をやめる目安です。"}
          </p>
          <div className="mt-3 space-y-3">
            <GateStatus gate={gate} golive={golive} />
            {golive ? (
              isOwner ? (
                <UndoGoLiveButton />
              ) : null
            ) : isOwner ? (
              <GoLiveButton month={month} monthLabel={monthLabelJa(month)} gate={gate} />
            ) : (
              <p className="text-sm text-muted-foreground">Excel をやめるかは、オーナーの方が決めます（この画面から記録できます）。{gate.missingNotes.length > 0 && canEdit ? "差の理由のメモは、上の表から入れられます。" : ""}</p>
            )}
          </div>
        </Card>
      </section>

      <div className="mt-8 space-y-1 text-xs text-muted-foreground">
        <p>「理由の見当」は、差の額が明細のどの部品（消費税・控除・調整・源泉徴収・端数）と同じ額か、ある行の数量・単価の違いで説明できるかを探したものです。当てはまっても、ほかの理由のことがあります。</p>
        <p>「払い不足・払いすぎの可能性」は、しめ日ラボの計算（登録した単価・控除・端数の設定）を基準にしたときの見え方です。</p>
        <p>どちらの計算に合わせるかは、取引条件をもとに会社で決めてください。消費税の扱いは、顧問の税理士さんに確かめると安心です。</p>
      </div>
    </div>
  );
}
