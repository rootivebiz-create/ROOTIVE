import Link from "next/link";
import { Card, buttonClass } from "@/components/ui";
import { EmptyState, Notice, PageHeader } from "~/components/page";
import { ParallelEditor } from "~/components/parallel/parallel-editor";
import { ResultList } from "~/components/parallel/result-list";
import { getDb } from "~/db/client";
import { requirePageUser, roleAtLeast } from "~/server/auth";
import { loadParallel } from "~/server/features/parallel";
import { monthFromParam, monthLabelJa, monthParam } from "~/server/month";

export const metadata = { title: "Excel と比べる" };

/**
 * 並行運用の比べ合わせ：しめ日ラボの振込額と、今の Excel の振込額をドライバーごとに並べる。
 * 差があれば、消費税・控除・調整・源泉徴収・端数のどれと同じ額かを探して、理由の見当を出す。
 */
export default async function ParallelPage({ searchParams }: { searchParams: Promise<{ m?: string }> }) {
  const user = await requirePageUser("viewer");
  const month = monthFromParam((await searchParams).m);
  const m = monthParam(month);
  const db = await getDb();
  const v = await loadParallel(db, user.tenantId, month);
  const canEdit = roleAtLeast(user.role, "staff");
  const staleCount = v.rows.filter((r) => r.stale).length;
  const draftCount = v.rows.filter((r) => r.source === "draft").length;

  return (
    <div className="mx-auto max-w-4xl">
      <PageHeader
        title="Excel と比べる"
        month={month}
        basePath="/parallel"
        description="今の Excel で出した振込額を入れると、しめ日ラボの振込額と 1 人ずつ比べます。差があれば、理由の見当を出します。"
        actions={
          v.summary.compared > 0 ? (
            <Link href={`/parallel/report?m=${m}`} className={buttonClass("secondary")}>
              印刷用の報告
            </Link>
          ) : undefined
        }
      />

      <Notice tone="info">
        2〜3 か月、しめ日ラボと Excel の両方で締めて、差が 0 になったら Excel をやめてください。差が出たときは、どちらに合わせるかを決めてから直します（会社の取引条件が基準です）。
      </Notice>

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
            {v.summary.compared > 0 && (
              <p className="mt-1 text-sm">
                {v.summary.different > 0 ? `差がある人が ${v.summary.different}人います。下の「理由の見当」を見て、Excel の計算と比べてください。` : "比べた人は、全員 Excel と同じです。"}
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

      <div className="mt-8 space-y-1 text-xs text-muted-foreground">
        <p>「理由の見当」は、差の額が明細のどの部品（消費税・控除・調整・源泉徴収・端数）と同じ額かを探したものです。同じ額でも、ほかの理由のことがあります。</p>
        <p>どちらの計算に合わせるかは、取引条件をもとに会社で決めてください。消費税の扱いは、顧問の税理士さんに確かめると安心です。</p>
      </div>
    </div>
  );
}
