import Link from "next/link";
import { buttonClass, Card, Money } from "@/components/ui";
import { ActionForm } from "~/components/import/action-form";
import { qtyText } from "~/components/import/sections";
import { Badge, EmptyState, Notice, PageHeader } from "~/components/page";
import { AdjustmentForm } from "~/components/work/adjustment-form";
import { AdjustmentPasteForm } from "~/components/work/adjustment-paste-form";
import { EntryForm } from "~/components/work/entry-form";
import { getDb } from "~/db/client";
import { requirePageUser, roleAtLeast } from "~/server/auth";
import { loadExportLayout } from "~/server/features/import/export";
import { loadWorkMonth, type EntryRow } from "~/server/features/import/work";
import { monthFromParam, monthLabelJa, monthParam } from "~/server/month";
import { statementsStatus } from "~/server/statements-core";
import {
  addAdjustmentAction,
  addEntryAction,
  bulkAdjustmentAction,
  deleteAdjustmentAction,
  deleteEntryAction,
  updateAdjustmentAction,
  updateEntryAction,
} from "./actions";

export const metadata = { title: "稼働と調整" };

const SAVED: Record<string, string> = {
  entry: "稼働を直しました。明細を作り直すと、金額に反映されます。",
  adjustment: "調整を直しました。明細を作り直すと、金額に反映されます。",
  deleted: "消しました。明細を作り直すと、金額に反映されます。",
};

function dateText(d: string | null): string {
  if (!d) return "日付なし";
  const [, m, day] = d.split("-").map(Number);
  return `${m}/${day}`;
}

/** 稼働と調整：ドライバー × 案件の数量（取り込み・手入力）と、その月だけの足し引き */
export default async function WorkPage({ searchParams }: { searchParams: Promise<{ m?: string; edit?: string; adj?: string; saved?: string }> }) {
  const user = await requirePageUser("viewer");
  const sp = await searchParams;
  const month = monthFromParam(sp.m);
  const m = monthParam(month);
  const db = await getDb();
  const [work, status, layout] = await Promise.all([
    loadWorkMonth(db, user.tenantId, month),
    statementsStatus(db, user.tenantId, month),
    loadExportLayout(db, user.tenantId, month),
  ]);
  const staff = roleAtLeast(user.role, "staff");
  const canEdit = staff && !work.closed;
  const entries = work.groups.flatMap((g) => g.lines.flatMap((l) => l.entries));
  const editing = canEdit && sp.edit ? (entries.find((e) => e.id === sp.edit) ?? null) : null;
  const editingAdj = canEdit && sp.adj ? (work.adjustments.find((a) => a.id === sp.adj) ?? null) : null;
  const drivers = work.drivers.map((d) => ({ id: d.id, name: d.name, active: d.active }));
  const changed = status.stale.length + status.missing.length + status.orphan.length;

  return (
    <div className="space-y-6">
      <PageHeader
        title="稼働と調整"
        month={month}
        basePath="/work"
        description="この月の、ドライバーごと・案件ごとの数量と、その月だけの足し引きです。明細はここから計算します。"
        actions={
          <>
            {work.entryCount > 0 && (
              <a href={`/api/import/export?m=${m}`} className={buttonClass("secondary")}>
                Excel に戻す（.xlsx）
              </a>
            )}
            {staff && (
              <Link href={`/import?m=${m}`} className={buttonClass("secondary")}>
                Excel から取り込む
              </Link>
            )}
          </>
        }
      />
      {work.entryCount > 0 && (
        <p className="-mt-4 text-xs text-muted-foreground">
          「Excel に戻す」は、
          {layout.source === "profile" ? `取り込んだ「${layout.fileName}」と同じ列の並び` : "日付・ドライバー・案件・数量・単位・備考の形"}
          で、この月の稼働を出します（いつでも今の Excel に戻れます）。
        </p>
      )}

      {sp.saved && SAVED[sp.saved] && <Notice tone="ok">{SAVED[sp.saved]}</Notice>}
      {work.closed && (
        <Notice tone="info">{monthLabelJa(month)}は締め済みです。見るだけできます。直すときは、オーナーが「締め」の画面で締めを外してください。</Notice>
      )}
      {!work.closed && status.saved > 0 && changed > 0 && (
        <div className="flex flex-wrap items-center gap-3 rounded-lg border border-warning/40 bg-warning/10 p-3 text-sm">
          <p className="min-w-0 flex-1">
            <b>明細を作り直してください。</b>明細を作ったあとで、{changed} 人ぶんの稼働・調整が変わっています。
          </p>
          <Link href={`/statements?m=${m}`} className={buttonClass("primary")}>
            明細へ
          </Link>
        </div>
      )}
      {!work.closed && status.saved === 0 && status.expected > 0 && (
        <div className="flex flex-wrap items-center gap-3 rounded-lg border border-border bg-card p-3 text-sm">
          <p className="min-w-0 flex-1">この月の明細はまだ作っていません。稼働と調整がそろったら、明細を作ります。</p>
          <Link href={`/statements?m=${m}`} className={buttonClass("secondary")}>
            明細へ
          </Link>
        </div>
      )}
      {status.upToDate && <p className="text-sm text-success">✓ 明細は、今の稼働・調整と同じ内容です。</p>}

      {/* 稼働 */}
      <section className="space-y-3">
        <div className="flex flex-wrap items-baseline gap-x-3">
          <h2 className="text-lg font-bold">稼働</h2>
          <p className="text-sm text-muted-foreground">
            {work.groups.length}人・{work.entryCount}行（取り込み {work.importedCount}・手入力 {work.manualCount}）
          </p>
        </div>
        {work.byProject.length > 0 && (
          <ul className="flex flex-wrap gap-2 text-sm">
            {work.byProject.map((p) => (
              <li key={p.projectId} className="rounded-full border border-border bg-card px-3 py-1">
                {p.name} <b className="num">{qtyText(p.qty)}</b>
                {p.unit}
              </li>
            ))}
          </ul>
        )}

        {editing && (
          <Card className="border-foreground">
            <h3 id="edit" className="mb-2 font-bold">
              稼働を直す
            </h3>
            {editing.importBatchId && (
              <p className="mb-3 rounded-lg border border-border bg-muted p-3 text-xs">
                この行は「{editing.source}
                」から取り込みました。ここで直しても、同じ形のファイルを取り込み直すと入れ替わります。取り込みを取り消すと、この行も消えます。
              </p>
            )}
            <EntryForm
              key={editing.id}
              action={updateEntryAction}
              month={month}
              drivers={drivers}
              projects={work.projects}
              initial={{
                id: editing.id,
                driverId: editing.driverId,
                projectId: editing.projectId,
                qty: editing.qty,
                workDate: editing.workDate,
                note: editing.note,
              }}
              submitLabel="直す"
            />
            <div className="mt-3 flex flex-wrap gap-2 border-t border-border pt-3">
              <ActionForm
                action={deleteEntryAction}
                submit="この行を消す"
                variant="ghost"
                confirm="この稼働の行を消します。"
                confirmSubmit="消す"
                pendingText="消しています…"
              >
                <input type="hidden" name="id" value={editing.id} />
              </ActionForm>
              <Link href={`/work?m=${m}`} className={buttonClass("ghost")}>
                やめる
              </Link>
            </div>
          </Card>
        )}
        {sp.edit && !editing && canEdit && <Notice tone="error">直そうとした稼働が見つかりません（もう消えたかもしれません）。</Notice>}

        {canEdit && (
          <details className="rounded-card border border-border bg-card p-4">
            <summary className="min-h-11 cursor-pointer py-2 font-bold">＋ 稼働を手で足す</summary>
            <p className="mb-3 text-sm text-muted-foreground">Excel に無い分（臨時のスポットなど）を 1 行ずつ足せます。取り込んだ分とは別の行になります。</p>
            <EntryForm action={addEntryAction} month={month} drivers={drivers} projects={work.projects} submitLabel="足す" />
          </details>
        )}

        {work.groups.length === 0 ? (
          <EmptyState title="この月の稼働はまだありません">
            {staff ? (
              <>
                今お使いの Excel を<Link href={`/import?m=${m}`}>取り込み</Link>で置くと、ここに入ります。Excel
                に無い分は、上の「稼働を手で足す」から入れられます。
              </>
            ) : (
              "事務・オーナーが Excel を取り込むか、手で入れると、ここに出ます。"
            )}
          </EmptyState>
        ) : (
          <ul className="space-y-3">
            {work.groups.map((g) => (
              <li key={g.driverId} className="rounded-card border border-border bg-card p-4">
                <div className="flex flex-wrap items-center gap-2">
                  <p className="font-bold">{g.name}</p>
                  {g.code && <span className="text-xs text-muted-foreground">{g.code}</span>}
                  {!g.active && <Badge tone="yellow">稼働していない人</Badge>}
                </div>
                <ul className="mt-2 divide-y divide-border/60">
                  {g.lines.map((l) => (
                    <li key={l.projectId} className="py-2">
                      <div className="flex flex-wrap items-baseline justify-between gap-x-3">
                        <span className="min-w-0">{l.projectName}</span>
                        <span className="num whitespace-nowrap font-bold">
                          {qtyText(l.qty)}
                          <span className="ml-0.5 text-xs font-normal">{l.unit}</span>
                        </span>
                      </div>
                      <div className="mt-1 flex flex-wrap gap-1">
                        {l.sources.map((s) =>
                          s.batchId ? (
                            <Link
                              key={s.batchId}
                              href={`/import/${s.batchId}`}
                              className="inline-flex min-h-11 max-w-full items-center rounded-full border border-border bg-muted px-3 text-xs text-muted-foreground no-underline"
                            >
                              <span className="truncate">取り込み：{s.label}</span>
                            </Link>
                          ) : (
                            <Badge key="manual" tone="yellow">
                              手入力
                            </Badge>
                          ),
                        )}
                      </div>
                      {(l.entries.length > 1 || canEdit) && <EntryList entries={l.entries} unit={l.unit} month={m} canEdit={canEdit} />}
                    </li>
                  ))}
                </ul>
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* 調整 */}
      <section id="adjustments" className="space-y-3">
        <div>
          <h2 className="text-lg font-bold">調整（その月だけの足し引き）</h2>
          <p className="text-sm text-muted-foreground">
            立替の精算・事故の負担など、毎月のきまった控除（ロイヤリティ・管理費など）以外のものです。＋は支払を増やし、−は減らします。
          </p>
        </div>

        {editingAdj && (
          <Card className="border-foreground">
            <h3 className="mb-2 font-bold">調整を直す</h3>
            <AdjustmentForm
              key={editingAdj.id}
              action={updateAdjustmentAction}
              month={month}
              drivers={drivers}
              initial={{
                id: editingAdj.id,
                driverId: editingAdj.driverId,
                label: editingAdj.label,
                amount: editingAdj.amount,
                taxable: editingAdj.taxable,
                agreedInWriting: editingAdj.agreedInWriting,
                basis: editingAdj.basis,
              }}
              submitLabel="直す"
            />
            <div className="mt-3 flex flex-wrap gap-2 border-t border-border pt-3">
              <ActionForm
                action={deleteAdjustmentAction}
                submit="この調整を消す"
                variant="ghost"
                confirm="この調整を消します。"
                confirmSubmit="消す"
                pendingText="消しています…"
              >
                <input type="hidden" name="id" value={editingAdj.id} />
              </ActionForm>
              <Link href={`/work?m=${m}#adjustments`} className={buttonClass("ghost")}>
                やめる
              </Link>
            </div>
          </Card>
        )}

        {work.adjustments.length === 0 ? (
          <p className="rounded-card border border-dashed border-border bg-card p-4 text-sm text-muted-foreground">この月の調整はありません。</p>
        ) : (
          <ul className="divide-y divide-border rounded-card border border-border bg-card">
            {work.adjustments.map((a) => (
              <li key={a.id} className="flex flex-wrap items-start gap-x-3 gap-y-1 p-3">
                <div className="min-w-0 flex-1">
                  <p className="font-bold">
                    {a.driverName}・{a.label}
                  </p>
                  <div className="mt-1 flex flex-wrap gap-1">
                    <Badge>{a.taxable ? "消費税の対象" : "消費税の対象外"}</Badge>
                    {a.agreedInWriting ? <Badge tone="green">書面の合意あり</Badge> : a.amount < 0 ? <Badge tone="red">書面の合意の記録なし</Badge> : null}
                    {a.basis && <span className="text-xs text-muted-foreground">根拠：{a.basis}</span>}
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <Money value={a.amount} className="font-bold" />
                  {canEdit && (
                    <Link href={`/work?m=${m}&adj=${a.id}#adjustments`} className={buttonClass("ghost", "px-3")}>
                      直す
                    </Link>
                  )}
                </div>
              </li>
            ))}
          </ul>
        )}

        {canEdit && (
          <details className="rounded-card border border-border bg-card p-4">
            <summary className="min-h-11 cursor-pointer py-2 font-bold">＋ 調整を足す</summary>
            <AdjustmentForm action={addAdjustmentAction} month={month} drivers={drivers} submitLabel="足す" />
          </details>
        )}
        {canEdit && (
          <details className="rounded-card border border-border bg-card p-4">
            <summary className="min-h-11 cursor-pointer py-2 font-bold">＋ まとめて入れる（Excel から貼り付け）</summary>
            <p className="mb-3 text-sm text-muted-foreground">
              燃料・高速代・立替・事故の負担など、人ごとに額が変わるものを、Excel の「名前・内容・金額」の列ごとコピーして入れられます。
              稼働の Excel にその列があるなら、取り込みの画面で「その月の調整として入れる」にすると、来月からは置くだけで入ります。
            </p>
            <AdjustmentPasteForm action={bulkAdjustmentAction} month={month} />
          </details>
        )}
      </section>
    </div>
  );
}

/** 1 つの案件の行の内訳（日付・数量・出どころ）。直すときは「直す」から */
function EntryList({ entries, unit, month, canEdit }: { entries: EntryRow[]; unit: string; month: string; canEdit: boolean }) {
  return (
    <details className="mt-1 text-sm">
      <summary className="min-h-11 cursor-pointer py-2 text-muted-foreground">内訳（{entries.length}行）</summary>
      <ul className="space-y-1">
        {entries.map((e) => (
          <li key={e.id} className="flex flex-wrap items-center gap-x-3 gap-y-1">
            <span className="w-16 text-muted-foreground">{dateText(e.workDate)}</span>
            <span className="num w-20 text-right">
              {qtyText(e.qty)}
              <span className="ml-0.5 text-xs">{unit}</span>
            </span>
            <span className="min-w-0 flex-1 truncate text-xs text-muted-foreground">
              {e.source}
              {e.note && `・${e.note}`}
            </span>
            {canEdit && (
              <Link href={`/work?m=${month}&edit=${e.id}#edit`} className={buttonClass("ghost", "px-3")}>
                直す
              </Link>
            )}
          </li>
        ))}
      </ul>
    </details>
  );
}
