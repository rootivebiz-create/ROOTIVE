import Link from "next/link";
import { Card } from "@/components/ui";
import { ActionForm } from "~/components/import/action-form";
import { qtyText, StatusBadge } from "~/components/import/sections";
import { UploadForm } from "~/components/import/upload-form";
import { Badge, EmptyState, Notice, PageHeader } from "~/components/page";
import { getDb } from "~/db/client";
import { requirePageUser, roleAtLeast } from "~/server/auth";
import { listBatches, listOpenDrafts, listProfiles, type BatchRow } from "~/server/features/import/service";
import { monthFromParam, monthLabelJa, monthParam } from "~/server/month";
import { isMonthClosed } from "~/server/repo";
import { deleteProfileAction, uploadAction } from "./actions";

export const metadata = { title: "取り込み" };

const dateTime = new Intl.DateTimeFormat("ja-JP", { timeZone: "Asia/Tokyo", month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" });

function BatchItem({ b, showMonth }: { b: BatchRow; showMonth?: boolean }) {
  const byProject = b.stats?.byProject ?? [];
  return (
    <li>
      <Link href={`/import/${b.id}`} className="block rounded-lg border border-border p-3 text-foreground no-underline hover:bg-muted">
        <div className="flex flex-wrap items-center gap-2">
          <span className="min-w-0 break-all font-bold">{b.fileName}</span>
          <StatusBadge status={b.status} reason={b.discardedReason} />
          {b.sample && <Badge>見本</Badge>}
        </div>
        <p className="mt-1 text-xs text-muted-foreground">
          {showMonth && `${monthLabelJa(b.month)}分・`}
          {dateTime.format(b.createdAt)}・{b.createdByName ?? "（記録なし）"}・{b.stats ? `${b.stats.records}件・${b.stats.drivers}人` : `${b.rowCount}件`}
        </p>
        {byProject.length > 0 && (
          <p className="mt-1 text-xs">
            {byProject
              .slice(0, 6)
              .map((p) => `${p.name} ${qtyText(p.qty)}${p.unit}`)
              .join("・")}
            {byProject.length > 6 && " ほか"}
          </p>
        )}
      </Link>
    </li>
  );
}

/** 取り込み：ファイルを置く・確認中のもの・この月の履歴 */
export default async function ImportPage({ searchParams }: { searchParams: Promise<{ m?: string }> }) {
  const user = await requirePageUser("viewer");
  const month = monthFromParam((await searchParams).m);
  const db = await getDb();
  const canEdit = roleAtLeast(user.role, "staff");
  const [batches, drafts, profiles, closed] = await Promise.all([
    listBatches(db, user.tenantId, month),
    canEdit ? listOpenDrafts(db, user.tenantId) : Promise.resolve([]),
    canEdit ? listProfiles(db, user.tenantId) : Promise.resolve([]),
    isMonthClosed(db, user.tenantId, month),
  ]);
  const otherDrafts = drafts.filter((d) => d.month !== month);
  const monthDrafts = batches.filter((b) => b.status === "draft");
  const history = batches.filter((b) => b.status !== "draft");

  return (
    <div className="space-y-6">
      <PageHeader
        title="取り込み"
        month={month}
        basePath="/import"
        description="今お使いの稼働の Excel・CSV を、形を変えずにそのまま置くだけで、稼働に入ります。"
      />

      {closed && <Notice tone="info">{monthLabelJa(month)}は締め済みです。この月のファイルを置いて中身を確かめることはできますが、反映はできません。</Notice>}

      {canEdit ? (
        <Card>
          <h2 className="mb-1 text-lg font-bold">ファイルを置く</h2>
          <p className="mb-4 text-sm text-muted-foreground">
            Excel（.xlsx）と CSV が読めます。1 行が 1 件の表（ドライバー・案件・数量）でも、人ごとに案件や日付が横に並ぶ表でも、そのまま読めます。
            何月分かは、ファイルの日付や表題から読み取ります（読み取れなければ {monthLabelJa(month)}分）。
          </p>
          <UploadForm action={uploadAction} month={monthParam(month)} showSamples={process.env.DEMO_MODE === "1"} />
        </Card>
      ) : (
        <Notice tone="info">閲覧の役割では、取り込みの履歴だけ見られます。ファイルを置くのは事務・オーナーの役割です。</Notice>
      )}

      {(monthDrafts.length > 0 || otherDrafts.length > 0) && (
        <section>
          <h2 className="mb-2 text-lg font-bold">確認中（まだ稼働に入っていません）</h2>
          <ul className="space-y-2">
            {[...monthDrafts, ...otherDrafts].map((b) => (
              <BatchItem key={b.id} b={b} showMonth={b.month !== month} />
            ))}
          </ul>
        </section>
      )}

      <section>
        <h2 className="mb-2 text-lg font-bold">{monthLabelJa(month)}分の取り込みの履歴</h2>
        {history.length === 0 ? (
          <EmptyState title="この月の取り込みはまだありません">
            {canEdit
              ? "上の枠にファイルを置くと、ここに残ります。反映したあとも、締めるまでは取り消せます。"
              : "事務・オーナーがファイルを取り込むと、ここに残ります。"}
          </EmptyState>
        ) : (
          <ul className="space-y-2">
            {history.map((b) => (
              <BatchItem key={b.id} b={b} />
            ))}
          </ul>
        )}
        <p className="mt-3 text-sm">
          <Link href={`/work?m=${monthParam(month)}`}>この月の稼働と調整を見る →</Link>
        </p>
      </section>

      {canEdit && profiles.length > 0 && (
        <section>
          <h2 className="mb-1 text-lg font-bold">覚えている読み方</h2>
          <p className="mb-2 text-sm text-muted-foreground">同じ形のファイルを置くと、列の読み方を聞かずに読みます。形が変わったら、自動で推測し直します。</p>
          <ul className="divide-y divide-border rounded-card border border-border bg-card">
            {profiles.map((p) => (
              <li key={p.id} className="flex flex-wrap items-center gap-2 p-3">
                <div className="min-w-0 flex-1">
                  <p className="break-all font-bold">{p.name} の形</p>
                  <p className="text-xs text-muted-foreground">最後に使った日時：{dateTime.format(p.updatedAt)}</p>
                </div>
                <ActionForm
                  action={deleteProfileAction}
                  submit="忘れる"
                  variant="ghost"
                  confirm="この読み方を忘れます。取り込んだ稼働は消えません。"
                  confirmSubmit="忘れる"
                  pendingText="忘れています…"
                >
                  <input type="hidden" name="profileId" value={p.id} />
                </ActionForm>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
