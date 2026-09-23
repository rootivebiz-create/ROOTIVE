import Link from "next/link";
import type { ReactNode } from "react";
import { Card, Money, buttonClass } from "@/components/ui";
import { yenText } from "@/lib/format";
import { Badge, EmptyState, Notice, PageHeader } from "~/components/page";
import { CloseMonthForm, ReopenMonthForm } from "~/components/close/close-forms";
import { jstDateTime } from "~/components/close/format";
import { getDb } from "~/db/client";
import { requirePageUser, roleAtLeast } from "~/server/auth";
import { loadCloseChecklist, monthAuditLog, OVERRIDE_REASON_MIN, REOPEN_REASON_MIN, type CloseChecklist } from "~/server/features/close";
import { monthFromParam, monthLabelJa, monthParam } from "~/server/month";

export const metadata = { title: "締め" };

type Tone = "green" | "yellow" | "red" | "gray";
type Item = { no: string; title: string; tone: Tone; status: string; body: ReactNode; href?: string; linkLabel?: string };

function CheckItem({ item }: { item: Item }) {
  return (
    <li>
      <Card className={item.tone === "red" ? "border-danger/60" : undefined}>
        <div className="flex flex-wrap items-center gap-2">
          <span aria-hidden className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-muted text-sm font-bold">
            {item.no}
          </span>
          <h3 className="min-w-0 flex-1 font-bold">{item.title}</h3>
          <Badge tone={item.tone}>{item.status}</Badge>
        </div>
        <div className="mt-2 text-sm">{item.body}</div>
        {item.href && (
          <Link href={item.href} className="mt-1 inline-flex min-h-11 items-center text-sm">
            {item.linkLabel} →
          </Link>
        )}
      </Card>
    </li>
  );
}

function buildItems(c: CloseChecklist, m: string, canEdit: boolean, isOwner = false): Item[] {
  const items: Item[] = [];

  // ① 稼働
  items.push(
    c.work.entries > 0 || c.work.adjustments > 0
      ? {
          no: "1",
          title: "稼働が入っている",
          tone: "green",
          status: "入っています",
          body: (
            <p>
              稼働 <span className="num">{c.work.entries}</span> 件（{c.work.drivers}人）・調整 <span className="num">{c.work.adjustments}</span> 件
            </p>
          ),
          href: `/work?m=${m}`,
          linkLabel: "稼働と調整を見る",
        }
      : {
          no: "1",
          title: "稼働が入っている",
          tone: "red",
          status: "ありません",
          body: <p>この月の稼働がまだありません。今の Excel を取り込むか、稼働を入れてください。</p>,
          href: canEdit ? `/import?m=${m}` : `/work?m=${m}`,
          linkLabel: canEdit ? "Excel を取り込む" : "稼働と調整を見る",
        },
  );

  // ② 明細
  const st = c.statements;
  if (st.skipped) {
    items.push({ no: "2", title: "明細が最新", tone: "gray", status: "締め済み", body: <p>締めたときの明細のまま変わりません（{st.saved}人）。</p>, href: `/statements?m=${m}`, linkLabel: "明細を見る" });
  } else if (st.upToDate) {
    items.push({ no: "2", title: "明細が最新", tone: "green", status: "最新です", body: <p>保存した明細（{st.saved}人）は、今の稼働・設定と同じです。</p>, href: `/statements?m=${m}`, linkLabel: "明細を見る" });
  } else {
    const parts = [st.missing && `まだ作っていない ${st.missing}人`, st.stale && `作ったあとに変わった ${st.stale}人`, st.orphan && `稼働が無くなった ${st.orphan}人`].filter(Boolean);
    items.push({
      no: "2",
      title: "明細が最新",
      tone: "yellow",
      status: st.saved === 0 ? "未作成" : "作り直しが必要",
      body: (
        <p>
          {parts.join("・")}。締めるときに、今の稼働・設定から最新にします。
          {st.saved > 0 && " すでに送った明細が変わると、ドライバーにはもう一度確認をお願いすることになります。先に明細の画面で中身を見ておくと安心です。"}
        </p>
      ),
      href: `/statements?m=${m}`,
      linkLabel: "明細を見る",
    });
  }

  // ③ 見張り番の赤
  if (c.watch.error) {
    items.push({ no: "3", title: "見張り番の赤い指摘", tone: "red", status: "確かめられません", body: <p>{c.watch.error}</p>, href: `/watch?m=${m}`, linkLabel: "見張り番を開く" });
  } else if (c.watch.blocking.length) {
    items.push({
      no: "3",
      title: "見張り番の赤い指摘",
      tone: "red",
      status: `${c.watch.blocking.length} 件`,
      body: (
        <div className="space-y-2">
          <p>
            {c.closed
              ? "締めたあとに見つかった指摘です。内容を確かめてください。"
              : "赤い指摘が残っている間は締められません。直すか、内容を確かめて「確認済み」にしてください。"}
            {!c.closed && isOwner && c.overridable && " 直せない事情があるときは、オーナーは下の「締める」で理由を書いて締めることもできます。"}
          </p>
          <ul className="space-y-2">
            {c.watch.blocking.map((i) => (
              <li key={`${i.code}:${i.subjectId}`} className="rounded-lg border border-danger/30 p-2">
                <p className="font-bold text-danger">
                  {i.title}
                  {i.subjectLabel && <span className="ml-1 font-normal text-foreground">（{i.subjectLabel}）</span>}
                </p>
                <p className="text-muted-foreground">{i.detail}</p>
                <Link href={i.fixHref ?? `/watch?m=${m}`} className="inline-flex min-h-11 items-center">
                  {i.fixHref ? "直す画面へ" : "見張り番で確かめる"} →
                </Link>
              </li>
            ))}
          </ul>
        </div>
      ),
      href: `/watch?m=${m}`,
      linkLabel: "見張り番を開く",
    });
  } else {
    items.push({
      no: "3",
      title: "見張り番の赤い指摘",
      tone: "green",
      status: "ありません",
      body: (
        <p>
          締めを止める指摘はありません。
          {(c.watch.redAcked > 0 || c.watch.yellow > 0) && ` 確認済みにした赤 ${c.watch.redAcked} 件・黄色 ${c.watch.yellow} 件は、見張り番の画面で見られます。`}
        </p>
      ),
      href: `/watch?m=${m}`,
      linkLabel: "見張り番を開く",
    });
  }

  // ④ Excel との比べ合わせ（参考）
  if (c.parallel.rows === 0) {
    items.push({
      no: "4",
      title: "Excel との比べ合わせ（参考）",
      tone: "gray",
      status: "比べていません",
      body: <p>今の Excel と並べて使っている間は、Excel で出した振込額を入れると、しめ日ラボとの差が分かります。</p>,
      href: `/parallel?m=${m}`,
      linkLabel: "Excel と比べる",
    });
  } else if (c.parallel.diffs.length === 0) {
    items.push({ no: "4", title: "Excel との比べ合わせ（参考）", tone: "green", status: "差はありません", body: <p>比べた {c.parallel.rows}人の振込額は、Excel と同じです。</p>, href: `/parallel?m=${m}`, linkLabel: "Excel と比べる" });
  } else {
    items.push({
      no: "4",
      title: "Excel との比べ合わせ（参考）",
      tone: "yellow",
      status: `差が ${c.parallel.diffs.length}人`,
      body: (
        <div className="space-y-1">
          <p>締めは止めませんが、どちらが正しいか確かめておくと安心です（しめ日ラボ − Excel）。</p>
          <ul className="space-y-1">
            {c.parallel.diffs.slice(0, 5).map((d) => (
              <li key={d.driverId} className="flex justify-between gap-3">
                <span className="min-w-0">{d.driverName}</span>
                <Money value={d.diff} />
              </li>
            ))}
          </ul>
          {c.parallel.diffs.length > 5 && <p className="text-muted-foreground">ほか {c.parallel.diffs.length - 5}人</p>}
        </div>
      ),
      href: `/parallel?m=${m}`,
      linkLabel: "差を見る",
    });
  }

  // ⑤ 振込データ（参考）
  const tr = c.transfer;
  items.push(
    tr.batches > 0
      ? {
          no: "5",
          title: "振込データ（参考）",
          tone: tr.changed > 0 || tr.notIncluded > 0 ? "yellow" : "green",
          status: tr.changed > 0 ? `作り直しが必要 ${tr.changed} 件` : tr.notIncluded > 0 ? `入っていない人 ${tr.notIncluded}人` : "作成済み",
          body: (
            <div className="space-y-1">
              <p>
                {tr.batches} 件・{tr.people}人・今の明細で合計 {yenText(tr.total)}（振り込んだ日の記録 {tr.executed} 件）
              </p>
              {tr.changed > 0 && (
                <p className="text-warning">
                  作ったあとに明細が変わった振込データが {tr.changed} 件あります。銀行にまだ出していなければ、振込データの画面で取り消して作り直してください。
                </p>
              )}
              {tr.notIncluded > 0 && <p>振込額があるのに、どの振込データにも入っていない人が {tr.notIncluded}人います（口座が未登録の人など）。</p>}
            </div>
          ),
          href: `/transfer?m=${m}`,
          linkLabel: "振込データを見る",
        }
      : {
          no: "5",
          title: "振込データ（参考）",
          tone: "gray",
          status: "まだです",
          body: <p>締めたあとでも作れます。締めてから作ると、あとで金額が変わる心配がありません。</p>,
          href: `/transfer?m=${m}`,
          linkLabel: "振込データへ",
        },
  );

  // ⑥ ドライバーの確認（参考）
  const cf = c.confirm;
  items.push(
    cf.statements === 0
      ? { no: "6", title: "ドライバーの確認（参考）", tone: "gray", status: "明細がまだです", body: <p>明細を送ると、ドライバーはスマホで「確認しました」を押せます。</p>, href: `/statements?m=${m}`, linkLabel: "明細へ" }
      : {
          no: "6",
          title: "ドライバーの確認（参考）",
          tone: cf.confirmed === cf.statements ? "green" : cf.confirmed > 0 ? "yellow" : "gray",
          status: `${cf.confirmed} / ${cf.statements}人`,
          body: (
            <p>
              今の版の明細を確認した人 {cf.confirmed}人・送った明細 {cf.sent} 通。確認は締めたあとでも受け取れます。
              {!c.closed && " 締めるときに明細が変わった人には、新しい版の確認をお願いすることになります。"}
            </p>
          ),
          href: `/statements?m=${m}`,
          linkLabel: "明細と確認の様子を見る",
        },
  );
  return items;
}

/** 締め：締める前の確かめ・締める・締めを外す（オーナーだけ）・この月の操作の記録 */
export default async function ClosePage({ searchParams }: { searchParams: Promise<{ m?: string }> }) {
  const user = await requirePageUser("viewer");
  const month = monthFromParam((await searchParams).m);
  const m = monthParam(month);
  const label = monthLabelJa(month);
  const db = await getDb();
  const [c, log] = await Promise.all([loadCloseChecklist(db, user.tenantId, month), monthAuditLog(db, user.tenantId, month, 20)]);
  const canEdit = roleAtLeast(user.role, "staff");
  const isOwner = user.role === "owner";
  const items = buildItems(c, m, canEdit, isOwner);
  const changes = { created: c.statements.missing, updated: c.statements.stale, removed: c.statements.orphan };

  return (
    <div className="space-y-8">
      <PageHeader title="締め" month={month} basePath="/close" description="締めた月の稼働・調整・明細は、だれも書き換えられなくなります。締める前に、下の 6 つを確かめてください。" />

      {c.closed ? (
        <section className="space-y-3 rounded-card border border-success/40 bg-success/10 p-4" aria-labelledby="closed-heading">
          <h2 id="closed-heading" className="text-lg font-bold text-success">
            {label}は締めました
          </h2>
          <p className="text-sm">
            締めました。この月の稼働・調整・明細は変えられません。
            {c.closedAt && `（${jstDateTime(c.closedAt)}${c.closedByName ? `・${c.closedByName}さん` : ""}）`}
          </p>
          <p className="text-sm">
            明細 {c.totals.drivers}人・振込額の合計 <Money value={c.totals.total} className="font-bold" />
            {c.minutesSpent !== null && <span className="ml-2">・締めにかかった時間 {c.minutesSpent}分</span>}
          </p>
          {c.override && (
            <div className="rounded-lg border border-danger/40 bg-card p-3 text-sm">
              <p className="font-bold text-danger">見張り番の赤い指摘が残ったまま締めました</p>
              <p>
                {jstDateTime(c.override.at)}
                {c.override.byName ? `・${c.override.byName}さん` : ""}　理由：{c.override.reason}
              </p>
              {c.override.issues.length > 0 && <p className="text-muted-foreground">そのときの指摘：{c.override.issues.join("、")}</p>}
            </div>
          )}
          {c.reopenedAt && (
            <p className="text-sm text-muted-foreground">
              この月は {jstDateTime(c.reopenedAt)} に一度締めを外し、締め直しています{c.reopenReason ? `（外した理由：${c.reopenReason}）` : ""}。
            </p>
          )}
          <div>
            <p className="text-sm font-bold">つぎにすること</p>
            <ul className="mt-2 grid gap-2 sm:grid-cols-3">
              <li>
                <Link href={`/transfer?m=${m}`} className={buttonClass("primary", "w-full")}>
                  振込データを作る
                </Link>
              </li>
              <li>
                <Link href={`/statements?m=${m}`} className={buttonClass("secondary", "w-full")}>
                  明細をドライバーへ送る
                </Link>
              </li>
              <li>
                <Link href={`/reconcile?m=${m}`} className={buttonClass("secondary", "w-full")}>
                  元請の支払通知と突き合わせる
                </Link>
              </li>
            </ul>
          </div>
        </section>
      ) : (
        c.reopenedAt && (
          <Notice tone="info">
            {jstDateTime(c.reopenedAt)} に締めを外しています{c.reopenReason ? `（理由：${c.reopenReason}）` : ""}。直し終わったら、もう一度締めてください。
          </Notice>
        )
      )}

      <section aria-labelledby="check-heading" className="space-y-3">
        <h2 id="check-heading" className="text-lg font-bold">
          締める前の確かめ
        </h2>
        <p className="text-sm text-muted-foreground">
          1 と 3 がそろうと締められます。2 の明細は、締めるときに今の稼働・設定から最新にします。4〜6 は参考で、締めを止めません。
        </p>
        <ol className="space-y-3">
          {items.map((item) => (
            <CheckItem key={item.no} item={item} />
          ))}
        </ol>
      </section>

      {!c.closed && (
        <section aria-labelledby="close-heading" className="space-y-3">
          <h2 id="close-heading" className="text-lg font-bold">
            {label}を締める
          </h2>
          {canEdit ? (
            <Card>
              <p className="mb-3 text-sm text-muted-foreground">
                締めると、明細を最新にして保存し、この月を書き換えられないようにします。今の見込みは {c.totals.drivers}人・振込額の合計{" "}
                <Money value={c.totals.total} className="font-bold" /> です。
              </p>
              <CloseMonthForm
                key={month}
                month={month}
                monthLabel={label}
                drivers={c.totals.drivers}
                total={c.totals.total}
                changes={changes}
                transferBatches={c.transfer.batches}
                blockers={c.blockers}
                isOwner={isOwner}
                overridable={c.overridable}
                redIssues={c.watch.blocking.map((i) => ({ key: `${i.code}:${i.subjectId}`, title: i.title, subjectLabel: i.subjectLabel }))}
                overrideMin={OVERRIDE_REASON_MIN}
                minutesDefault={c.minutesSpent}
              />
            </Card>
          ) : (
            <Notice tone="info">締めるのは事務・オーナーの方です。この画面では、締められる状態かどうかを見られます。</Notice>
          )}
        </section>
      )}

      {c.closed && (
        <section aria-labelledby="reopen-heading" className="space-y-3">
          <h2 id="reopen-heading" className="text-lg font-bold">
            締めを外す
          </h2>
          {isOwner ? (
            <Card>
              <ReopenMonthForm
                key={month}
                month={month}
                monthLabel={label}
                minLength={REOPEN_REASON_MIN}
                confirmed={c.confirm.confirmed}
                executedBatches={c.transfer.executed}
              />
            </Card>
          ) : (
            <Notice tone="info">締めを外せるのはオーナーの方だけです。直すところが見つかったときは、オーナーに相談してください（理由を記録してから外します）。</Notice>
          )}
        </section>
      )}

      <section aria-labelledby="log-heading" className="space-y-3">
        <h2 id="log-heading" className="text-lg font-bold">
          {label}の操作の記録
        </h2>
        <p className="text-sm text-muted-foreground">
          だれが・いつ・何をしたかを、新しい順に 20 件まで出します。この記録は消したり書き換えたりできません。
          {canEdit && "種類や人での絞り込みと CSV は「操作の記録」の画面で。"}
        </p>
        {canEdit && (
          <div className="flex flex-wrap gap-2">
            <Link href={`/audit?m=${m}`} className={buttonClass("secondary")}>
              {label}の操作の記録をすべて見る
            </Link>
            {isOwner && (
              <Link href="/data" className={buttonClass("ghost")}>
                全データの書き出し（オーナー）
              </Link>
            )}
          </div>
        )}
        {log.length === 0 ? (
          <EmptyState title="この月の操作の記録はまだありません">明細を作る・締める・振込データを作る、などの操作をすると、ここに残ります。</EmptyState>
        ) : (
          <ol className="divide-y divide-border rounded-card border border-border bg-card">
            {log.map((r) => (
              <li key={r.id} className="p-3 text-sm">
                <div className="flex flex-wrap items-baseline justify-between gap-x-3">
                  <p className="font-bold">{r.label}</p>
                  <p className="num text-xs text-muted-foreground">{jstDateTime(r.at)}</p>
                </div>
                <p className="text-muted-foreground">
                  {r.actor}
                  {r.summary && <span className="ml-2 break-all text-foreground">{r.summary}</span>}
                </p>
              </li>
            ))}
          </ol>
        )}
      </section>
    </div>
  );
}
