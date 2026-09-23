import Link from "next/link";
import { buttonClass, Card } from "@/components/ui";
import { ActionForm } from "~/components/import/action-form";
import { BankUploadForm } from "~/components/import/bank-upload-form";
import { qtyText, StatusBadge } from "~/components/import/sections";
import { UploadForm } from "~/components/import/upload-form";
import { Badge, EmptyState, Notice, PageHeader } from "~/components/page";
import { getDb } from "~/db/client";
import { requirePageUser, roleAtLeast } from "~/server/auth";
import { listBankBatches, type BankBatchRow } from "~/server/features/import/bank";
import { monthEntryCount } from "~/server/features/import/export";
import { listBatches, listOpenDrafts, listProfiles, type BatchRow } from "~/server/features/import/service";
import { monthFromParam, monthLabelJa, monthParam } from "~/server/month";
import { isMonthClosed } from "~/server/repo";
import { deleteProfileAction, uploadAction } from "./actions";
import { bankUploadAction } from "./bank/actions";

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

/** 取り込みの種類の切り替え（稼働の表・口座の一覧） */
function KindTabs({ m, kind }: { m: string; kind: "work" | "bank" }) {
  const tab = (active: boolean) =>
    `inline-flex min-h-11 flex-1 items-center justify-center rounded-lg border px-3 py-1 text-center text-sm font-bold leading-tight no-underline sm:flex-none ${
      active ? "border-primary bg-primary text-primary-foreground" : "border-border bg-card text-foreground hover:bg-muted"
    }`;
  return (
    <nav aria-label="取り込むもの" className="flex gap-2">
      <Link href={`/import?m=${m}`} className={tab(kind === "work")} aria-current={kind === "work" ? "page" : undefined}>
        稼働の表を取り込む
      </Link>
      <Link href={`/import?m=${m}&kind=bank`} className={tab(kind === "bank")} aria-current={kind === "bank" ? "page" : undefined}>
        口座の一覧を取り込む
      </Link>
    </nav>
  );
}

const BANK_STATUS: Record<string, string> = { draft: "確認中", applied: "台帳に入れた", discarded: "やめた" };

function BankItem({ b }: { b: BankBatchRow }) {
  return (
    <li>
      <Link href={`/import/bank/${b.id}`} className="block rounded-lg border border-border p-3 text-foreground no-underline hover:bg-muted">
        <div className="flex flex-wrap items-center gap-2">
          <span className="min-w-0 break-all font-bold">{b.fileName}</span>
          <Badge tone={b.status === "applied" ? "green" : b.status === "draft" ? "yellow" : "gray"}>{BANK_STATUS[b.status] ?? b.status}</Badge>
        </div>
        <p className="mt-1 text-xs text-muted-foreground">
          {dateTime.format(b.createdAt)}・{b.source === "zengin" ? "全銀の振込ファイル" : "口座一覧"}・{b.rows}件
          {b.status === "applied" && `・新しく ${b.created ?? 0} 人・変更 ${b.updated ?? 0} 人`}
        </p>
      </Link>
    </li>
  );
}

/** 口座の一覧を取り込む（口座一覧の Excel・CSV か、先月の全銀の振込ファイル） */
async function BankMode({ canEdit, tenantId, m }: { canEdit: boolean; tenantId: string; m: string }) {
  if (!canEdit) {
    return <Notice tone="info">口座の取り込みは、事務・オーナーの役割でできます（口座の中身は閲覧の役割には出しません）。</Notice>;
  }
  const batches = await listBankBatches(await getDb(), tenantId);
  return (
    <>
      <Card>
        <h2 className="mb-1 text-lg font-bold">口座の一覧を取り込む</h2>
        <p className="mb-2 text-sm text-muted-foreground">
          ドライバーの振込先を 1 人ずつ打ち込まなくてよいように、今ある一覧から台帳に入れます。次のどちらかを置いてください。
        </p>
        <ul className="mb-4 list-disc space-y-1 pl-5 text-sm">
          <li>
            <b>口座一覧の Excel・CSV</b>（見出し：氏名・銀行コード・支店コード・種目・口座番号・名義カナ。銀行名・支店名・フリガナ・番号の列があれば使います）
          </li>
          <li>
            <b>先月、銀行に出した全銀の振込ファイル</b>（総合振込の 1 行 120 文字のファイル。ネットバンキングから出したものをそのまま）
          </li>
        </ul>
        <p className="mb-4 text-sm text-muted-foreground">
          名義のカナ・名前・番号で台帳のドライバーに当て、新しく入る人・変わる人・同じ人・当たらない人を分けて見せます。見てから、チェックした人だけ台帳に入れます。
        </p>
        <BankUploadForm action={bankUploadAction} month={m} />
      </Card>
      <section>
        <h2 className="mb-2 text-lg font-bold">口座の取り込みの履歴</h2>
        {batches.length === 0 ? (
          <EmptyState title="口座の取り込みはまだありません">上の枠に口座一覧か振込ファイルを置くと、ここに残ります。</EmptyState>
        ) : (
          <ul className="space-y-2">
            {batches.map((b) => (
              <BankItem key={b.id} b={b} />
            ))}
          </ul>
        )}
      </section>
    </>
  );
}

/** 取り込み：ファイルを置く・確認中のもの・この月の履歴 */
export default async function ImportPage({ searchParams }: { searchParams: Promise<{ m?: string; kind?: string }> }) {
  const user = await requirePageUser("viewer");
  const sp = await searchParams;
  const month = monthFromParam(sp.m);
  const kind = sp.kind === "bank" ? "bank" : "work";
  const db = await getDb();
  const canEdit = roleAtLeast(user.role, "staff");
  if (kind === "bank") {
    return (
      <div className="space-y-6">
        <PageHeader title="取り込み" description="ドライバーの振込先（口座）を、今ある一覧や先月の振込ファイルから台帳に入れます（月には関係しません）。" />
        <KindTabs m={monthParam(month)} kind="bank" />
        <BankMode canEdit={canEdit} tenantId={user.tenantId} m={monthParam(month)} />
      </div>
    );
  }
  const [batches, drafts, profiles, closed, entryCount] = await Promise.all([
    listBatches(db, user.tenantId, month),
    canEdit ? listOpenDrafts(db, user.tenantId) : Promise.resolve([]),
    canEdit ? listProfiles(db, user.tenantId) : Promise.resolve([]),
    isMonthClosed(db, user.tenantId, month),
    monthEntryCount(db, user.tenantId, month),
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
        actions={
          // 稼働が無い月は出さない（押しても空の表になるだけ）。download を付けない：出せないときの説明の画面が開くように
          entryCount > 0 ? (
            <a href={`/api/import/export?m=${monthParam(month)}`} className={buttonClass("secondary")}>
              Excel に戻す（.xlsx）
            </a>
          ) : undefined
        }
      />
      <KindTabs m={monthParam(month)} kind="work" />

      {closed && <Notice tone="info">{monthLabelJa(month)}は締め済みです。この月のファイルを置いて中身を確かめることはできますが、反映はできません。</Notice>}

      {canEdit ? (
        <Card>
          <h2 className="mb-1 text-lg font-bold">ファイルを置く</h2>
          <p className="mb-4 text-sm text-muted-foreground">
            Excel（.xlsx）と CSV が読めます。1 行が 1 件の表（ドライバー・案件・数量）でも、人ごとに案件や日付が横に並ぶ表でも、そのまま読めます。
            何月分かは、ファイルの日付や表題から読み取ります（読み取れなければ {monthLabelJa(month)}分）。
          </p>
          <UploadForm action={uploadAction} month={monthParam(month)} showSamples={process.env.DEMO_MODE === "1"} demo={process.env.DEMO_MODE === "1"} />
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
          <Link href={`/work?m=${monthParam(month)}`} className="inline-block min-h-11 py-2">
            この月の稼働と調整を見る →
          </Link>
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
