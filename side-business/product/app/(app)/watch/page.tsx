import Link from "next/link";
import { Card, buttonClass } from "@/components/ui";
import { jpDate, jpMonth } from "@/lib/format";
import { EmptyState, Notice, PageHeader } from "~/components/page";
import { BulkAckForm } from "~/components/watch/ack-forms";
import { IssueCard, SEVERITY_LABEL } from "~/components/watch/issue-card";
import { getDb } from "~/db/client";
import { requirePageUser, roleAtLeast } from "~/server/auth";
import { ackKey, watchMonth, type WatchMonth } from "~/server/features/watch";
import { ackAllowed, ackNoteMin, changedSinceAck, monthAckDetails, previousAcks, type AckDetail, type PreviousAck } from "~/server/features/watch/acks";
import { RULES } from "~/server/features/watch/rules";
import { SOURCES, WATCH_RULES_AS_OF } from "~/server/features/watch/sources";
import { bulkAckGroups, countIssues, groupBySeverity } from "~/server/features/watch/summary";
import type { WatchSeverity } from "~/server/features/watch-types";
import { monthFromParam, monthLabelJa, monthParam } from "~/server/month";

export const metadata = { title: "見張り番" };

const FOOTER = "見張り番は、記録から分かることをお知らせするものです。法令に合っているかの判断は、弁護士・税理士などにご確認ください。";

const SECTION: Record<WatchSeverity, { heading: string; lead: string; closedLead?: string }> = {
  red: {
    heading: "赤：締める前に直すか、確かめる",
    lead: "残っている間は締められません。直すか、内容を確かめて「確認済み」にしてください。",
    closedLead: "締めたあとの記録（振り込んだ日など）や、締めたときの明細から見えることです。内容を確かめて、次の月に生かしてください。",
  },
  yellow: { heading: "黄：確認をおすすめします", lead: "締めは止めません。払う前に一度見ておくと安心です。" },
  info: { heading: "お知らせ", lead: "知っておくと役に立つことです。" },
};

/** 見張り番：締める前に、記録から分かることを赤・黄・お知らせで並べる（根拠と出典・直す画面・確認済みの印つき） */
export default async function WatchPage({ searchParams }: { searchParams: Promise<{ m?: string }> }) {
  const user = await requirePageUser("viewer");
  const month = monthFromParam((await searchParams).m);
  const m = monthParam(month);
  const label = monthLabelJa(month);
  const db = await getDb();
  const canEdit = roleAtLeast(user.role, "staff");

  let result: WatchMonth | null = null;
  let acks = new Map<string, AckDetail>();
  let previous = new Map<string, PreviousAck>();
  let changed = new Set<string>();
  try {
    [result, acks, previous] = await Promise.all([watchMonth(db, user.tenantId, month), monthAckDetails(db, user.tenantId, month), previousAcks(db, user.tenantId, month)]);
    changed = await changedSinceAck(db, user.tenantId, month, result.issues);
  } catch (error) {
    console.error("watch page failed", error instanceof Error ? error.message : error);
  }

  const header = (
    <PageHeader
      title="見張り番"
      month={month}
      basePath="/watch"
      description="締める前に、記録から分かることをお知らせします（フリーランス法・インボイス・おかしな数字）。赤い指摘が残っている間は締められません。"
    />
  );

  if (!result) {
    return (
      <div className="space-y-6">
        {header}
        <Notice tone="error">見張り番を動かせませんでした。時間をおいて、この画面を開き直してください。</Notice>
        <Footer />
      </div>
    );
  }

  const { issues, closed, hasWork } = result;
  const counts = countIssues(issues);
  // 前の月に確認済みにした黄・お知らせ（灰色の 1 行にたたむもの）は、まだ見ていない指摘のあとに並べる
  const groups = groupBySeverity(issues, (i) => i.severity !== "red" && previous.has(ackKey(i.code, i.subjectId)));

  return (
    <div className="space-y-8">
      {header}

      {closed && (
        <Notice tone="info">
          {label}は締め済みです。見るだけで、確認済みの印は変えられません。ただし、締めたあとに入れた振込の記録から出た指摘（支払期日より後に振り込んだ など）と、ドライバーからの明細への質問は、事情をメモに残して確認済みにできます。
        </Notice>
      )}
      {!canEdit && <Notice tone="info">確認済みにするのは、事務・オーナーの方です。この画面では、指摘と確認済みのメモを見られます。</Notice>}

      <Summary counts={counts} closed={closed} m={m} canEdit={canEdit} changed={changed.size} />

      {!hasWork && !closed && (
        <EmptyState title={`${label}の稼働がまだありません`}>
          <p>Excel を取り込むと、ドライバーごとの取引条件・控除・口座などを確かめます。いまは会社の設定から分かることだけを出しています。</p>
          <Link href={canEdit ? `/import?m=${m}` : `/work?m=${m}`} className={buttonClass("secondary", "mt-3")}>
            {canEdit ? "Excel を取り込む" : "稼働と調整を見る"}
          </Link>
        </EmptyState>
      )}

      {issues.length === 0 ? (
        <EmptyState title="この月の記録から、お知らせすることは見つかりませんでした">
          見張り番は、登録してある記録（取引条件の日付・控除の合意・支払日・口座など）だけを見ています。記録に無いことまでは分かりません。
        </EmptyState>
      ) : (
        (["red", "yellow", "info"] as const).map((sev) =>
          groups[sev].length ? (
            <section key={sev} aria-labelledby={`watch-${sev}`} className="space-y-3">
              <div>
                <h2 id={`watch-${sev}`} className={`text-lg font-bold ${sev === "red" ? "text-danger" : ""}`}>
                  {closed && sev === "red" ? "赤：記録から見えること" : SECTION[sev].heading}（{groups[sev].length} 件）
                </h2>
                <p className="text-sm text-muted-foreground">
                  {closed ? (SECTION[sev].closedLead ?? SECTION[sev].lead) : SECTION[sev].lead}
                  {groups[sev].length > 1 && "同じ重さの中は、影響額の大きい順です。"}
                  {sev !== "red" && groups[sev].some((i) => i.acked || previous.has(ackKey(i.code, i.subjectId))) && "確認済みのもの（前の月に確認済みにしたものを含む）は、灰色の 1 行にたたんでいます。"}
                </p>
              </div>
              {canEdit &&
                bulkAckGroups(groups[sev])
                  .filter((g) => ackAllowed(g.code, closed))
                  .map((g) => (
                    <BulkAckForm
                      key={`${g.code}:${g.title}`}
                      month={month}
                      code={g.code}
                      title={g.title}
                      subjects={g.issues.map((i) => ({ id: i.subjectId, label: i.subjectLabel }))}
                      minLength={ackNoteMin(g.severity)}
                      red={g.severity === "red"}
                    />
                  ))}
              <ul className="space-y-3">
                {groups[sev].map((i) => {
                  const key = ackKey(i.code, i.subjectId);
                  return (
                    <IssueCard
                      key={key}
                      issue={i}
                      month={month}
                      role={user.role}
                      closed={closed}
                      canAck={canEdit && ackAllowed(i.code, closed)}
                      ackMinLength={ackNoteMin(i.severity)}
                      ack={acks.get(key) ?? null}
                      changedSinceAck={changed.has(key)}
                      previous={previous.get(key) ?? null}
                    />
                  );
                })}
              </ul>
            </section>
          ) : null,
        )
      )}

      <RulesHelp />
      <Footer />
    </div>
  );
}

function Summary({ counts, closed, m, canEdit, changed }: { counts: ReturnType<typeof countIssues>; closed: boolean; m: string; canEdit: boolean; changed: number }) {
  const tiles = [
    { key: "red", label: SEVERITY_LABEL.red, value: counts.redOpen, sub: counts.redAcked ? `確認済み ${counts.redAcked}` : null, cls: counts.redOpen ? "border-danger/40 bg-danger/10 text-danger" : "border-border" },
    { key: "yellow", label: SEVERITY_LABEL.yellow, value: counts.yellowOpen, sub: counts.yellowAcked ? `確認済み ${counts.yellowAcked}` : null, cls: counts.yellowOpen ? "border-warning/40 bg-warning/10 text-warning" : "border-border" },
    { key: "info", label: SEVERITY_LABEL.info, value: counts.info, sub: null, cls: "border-border" },
  ];
  return (
    <section aria-label="指摘の件数" className="space-y-3">
      <Card className={counts.redOpen ? "border-danger/60" : "border-success/40"}>
        {closed ? (
          <p className={`font-bold ${counts.redOpen ? "text-danger" : "text-success"}`}>
            {counts.redOpen ? `まだ確認していない赤い指摘が ${counts.redOpen} 件あります` : "まだ確認していない赤い指摘はありません"}
          </p>
        ) : counts.redOpen ? (
          <p className="font-bold text-danger">締めを止める指摘が {counts.redOpen} 件あります</p>
        ) : (
          <p className="font-bold text-success">締めを止める指摘はありません</p>
        )}
        <p className="mt-1 text-sm text-muted-foreground">
          {closed
            ? "この月は締めてあります。"
            : counts.redOpen
              ? "直す画面で直すか、内容を確かめて「確認済み」にすると、締められるようになります。"
              : "黄色とお知らせは、締めを止めません。"}
        </p>
        {changed > 0 && (
          <p className="mt-2 rounded-lg border border-warning/40 bg-warning/10 p-2 text-sm text-warning">
            確認済みにしたあとで中身（数字・日付・人）が変わった赤い指摘が {changed} 件あります。もう一度確かめてください。
          </p>
        )}
        <ul className="mt-3 grid grid-cols-3 gap-2">
          {tiles.map((t) => (
            <li key={t.key} className={`rounded-lg border p-2 text-center ${t.cls}`}>
              <p className="text-xs font-bold">{t.label}</p>
              <p className="num text-2xl font-bold">{t.value}</p>
              <p className="min-h-4 text-xs text-muted-foreground">{t.sub ?? ""}</p>
            </li>
          ))}
        </ul>
        {!closed && canEdit && (
          <Link href={`/close?m=${m}`} className={buttonClass(counts.redOpen ? "secondary" : "primary", "mt-3 w-full sm:w-auto")}>
            締めの画面へ
          </Link>
        )}
      </Card>
    </section>
  );
}

function RulesHelp() {
  return (
    <details className="rounded-card border border-border bg-card">
      <summary className="flex min-h-11 cursor-pointer items-center px-4 font-bold">見張り番が確かめていること（{RULES.length} 項目）</summary>
      <div className="space-y-3 border-t border-border p-4 text-sm">
        <p className="text-muted-foreground">
          {WATCH_RULES_AS_OF}時点の法令・公的な資料をもとにしています。記録にあること（日付・金額・名前・設定）だけを見て、「〜のおそれがあります」「確認をおすすめします」までをお知らせします。
          影響額は、その指摘に関わるその月の金額（支払額・差し引いた額・下がった分など。前の月の振込の遅れは前の月の額、経過措置の次の段は見込み）です。出せないものは「—」にしています。同じお金が複数の指摘に数えられることがあるので、足し合わせないでください。
        </p>
        <ul className="space-y-2">
          {RULES.map((r) => (
            <li key={r.doc.code} className="rounded-lg border border-border p-3">
              <p className="font-bold">
                {r.doc.label}
                <span className="ml-2 text-xs font-normal text-muted-foreground">{r.doc.severities.map((x) => SEVERITY_LABEL[x]).join("・")}</span>
              </p>
              <p className="mt-1">{r.doc.what}</p>
              <p className="mt-1 text-xs text-muted-foreground">
                {jpMonth(r.doc.asOf)}時点の情報
                {r.doc.effectiveFrom && `・${jpDate(r.doc.effectiveFrom)}以降の月で確かめます`}
              </p>
              {r.doc.basis && (
                <p className="mt-1 text-xs text-muted-foreground">
                  根拠：{r.doc.basis}
                  {r.doc.sourceUrl && (
                    <a href={r.doc.sourceUrl} target="_blank" rel="noopener noreferrer" className="ml-2">
                      出典<span className="sr-only">（新しいタブで開きます）</span> ↗
                    </a>
                  )}
                </p>
              )}
            </li>
          ))}
        </ul>
        <p className="text-muted-foreground">
          公正取引委員会は、フリーランス法にもとづく勧告を公表しています。配送の分野での勧告も出ています。
          <a href={SOURCES.flRecommendations} target="_blank" rel="noopener noreferrer" className="ml-1">
            勧告の一覧<span className="sr-only">（新しいタブで開きます）</span> ↗
          </a>
        </p>
      </div>
    </details>
  );
}

function Footer() {
  return <p className="border-t border-border pt-4 text-xs text-muted-foreground">{FOOTER}</p>;
}
