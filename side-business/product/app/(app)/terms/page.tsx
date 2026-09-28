import Link from "next/link";
import { buttonClass, Card } from "@/components/ui";
import { jpDate } from "@/lib/format";
import { Badge, EmptyState, Notice, PageHeader } from "~/components/page";
import { TermsBulkForm } from "~/components/terms/bulk-form";
import { TermsFilterChips } from "~/components/terms/filter-chips";
import { TermsStatusBadge } from "~/components/terms/status-badge";
import { getDb } from "~/db/client";
import { requirePageUser, roleAtLeast } from "~/server/auth";
import { DEFAULT_PLACE, filterTermsRows, listTerms, parseTermsFilter, type TermsFilter } from "~/server/features/terms";
import { TERMS_SOURCES } from "~/server/features/terms/document";
import { jpDateTimeJst, todayJst } from "~/server/features/terms/links";
import { TERMS_STATUS } from "~/server/features/terms/status";

export const metadata = { title: "取引条件の明示" };

function hrefFor(f: TermsFilter): string {
  return f ? `/terms?f=${f}` : "/terms";
}

/** 有効なドライバー 1 人ずつ：最新の明示書の版・明示した日・送付と受け取り・明示のあとの変化 */
export default async function TermsPage({ searchParams }: { searchParams: Promise<{ f?: string }> }) {
  const user = await requirePageUser("viewer");
  const sp = await searchParams;
  const filter = parseTermsFilter(sp.f);
  const canEdit = roleAtLeast(user.role, "staff");
  const db = await getDb();
  const { rows, counts } = await listTerms(db, user.tenantId);
  const shown = filterTermsRows(rows, filter);
  const missing = rows.filter((r) => r.status === "none");
  const hasRecords = rows.some((r) => r.latest);

  return (
    <div className="space-y-5">
      <PageHeader
        title="取引条件の明示"
        description="仕事を頼むときは、仕事の内容・報酬の額・支払期日などを、すぐに書面やメールで明示することになっています（フリーランス法 第3条）。ここで明示書を作ってドライバーに送り、「受け取りました」の記録を残します。"
        actions={
          hasRecords && (
            <>
              <a href="/api/terms/pdf" className={buttonClass("secondary")}>
                全員分の PDF（最新の版）
              </a>
              <a href="/api/terms/csv" className={buttonClass("secondary")}>
                記録の CSV（全部の版）
              </a>
            </>
          )
        }
      />

      {counts.total === 0 ? (
        <EmptyState title="有効なドライバーがいません">
          <p>
            ドライバーを登録すると、ここに 1 人ずつ出ます。<Link href="/settings/drivers">設定 → ドライバー</Link>から登録してください。
          </p>
        </EmptyState>
      ) : (
        <>
          <p className="text-sm">
            有効な {counts.total}人のうち、受け取り済み <strong>{counts.received}人</strong>・送付済み {counts.sent}人・未送付 {counts.unsent}人・未作成{" "}
            <strong className={counts.none ? "text-danger" : ""}>{counts.none}人</strong>
          </p>

          {counts.noneWorked > 0 && (
            <Notice tone="error">
              最近（この 3 か月）稼働しているのに、明示書の記録が無い人が {counts.noneWorked}人います。
              {canEdit ? "下の「まとめて作る」か、1 人ずつ開いて明示書を作り、送ってください。" : "事務・オーナーの方に、明示書を作って送るようお願いしてください。"}
            </Notice>
          )}
          {counts.changed > 0 && (
            <Notice tone="info">
              明示したあとで単価・控除・支払期日などが変わったか、明示書に無い案件で稼働した人が {counts.changed}人います。新しい版を作って送ってください（前の版はそのまま残ります）。
            </Notice>
          )}

          <TermsFilterChips
            items={[
              { href: hrefFor(""), label: "すべて", count: counts.total, current: filter === "" },
              { href: hrefFor("none"), label: "未作成", count: counts.none, current: filter === "none", tone: counts.none ? "red" : "gray" },
              { href: hrefFor("changed"), label: "変更あり", count: counts.changed, current: filter === "changed", tone: counts.changed ? "yellow" : "gray" },
              { href: hrefFor("unreceived"), label: "未受け取り", count: counts.unreceived, current: filter === "unreceived" },
            ]}
          />

          {canEdit && (
            <TermsBulkForm names={missing.map((m) => ({ name: m.name, workedRecently: m.workedRecently }))} today={todayJst()} defaultPlace={DEFAULT_PLACE} />
          )}

          {shown.length === 0 ? (
            <EmptyState title="当てはまる人はいません">
              <p>
                {filter === "none"
                  ? "全員に明示書があります。"
                  : filter === "changed"
                    ? "明示したあとで条件が変わった人はいません。"
                    : counts.none > 0
                      ? "明示書がある人は、全員が最新の版を受け取っています（明示書がまだ無い人は「未作成」で見られます）。"
                      : "全員が最新の版を受け取っています。"}
                <Link href="/terms" className="ml-1">
                  すべての人を見る
                </Link>
              </p>
            </EmptyState>
          ) : (
            <ul className="space-y-2">
              {shown.map((r) => (
                <li key={r.driverId}>
                  <Link href={`/terms/${r.driverId}`} className="block text-foreground no-underline">
                    <Card className="hover:border-foreground">
                      <div className="flex flex-wrap items-baseline gap-x-2">
                        {r.code && <span className="num text-sm text-muted-foreground">{r.code}</span>}
                        <span className="font-bold">{r.name}</span>
                        <TermsStatusBadge status={r.status} workedRecently={r.workedRecently} />
                        {r.changes.length > 0 && <Badge tone="yellow">条件が変わっています</Badge>}
                        {r.status === "none" && r.workedRecently && <Badge tone="red">最近の稼働あり</Badge>}
                        {r.latest?.deemedClause && <Badge>みなし確認の条項</Badge>}
                      </div>
                      <p className="mt-2 break-words text-xs text-muted-foreground">
                        {r.latest ? (
                          <>
                            版 {r.latest.version}・明示 {jpDate(r.latest.issuedOn)}
                            {r.latest.sentAt ? `・送付 ${jpDateTimeJst(r.latest.sentAt)}` : "・まだ送っていません"}
                            {r.latest.receivedAt ? `・受け取り ${jpDateTimeJst(r.latest.receivedAt)}` : ""}
                            {r.firstIssuedOn && r.firstIssuedOn < r.latest.issuedOn ? `・最初に明示した日 ${jpDate(r.firstIssuedOn)}` : ""}
                          </>
                        ) : r.firstIssuedOn ? (
                          `台帳の明示した日 ${jpDate(r.firstIssuedOn)}（手で入れた日付。明示書の記録はありません）`
                        ) : (
                          TERMS_STATUS.none.hint
                        )}
                      </p>
                      {r.changes.length > 0 && (
                        <ul className="mt-2 space-y-1 text-xs">
                          {r.changes.slice(0, 3).map((c, i) => (
                            <li key={i} className="break-words">
                              ・{c}
                            </li>
                          ))}
                          {r.changes.length > 3 && <li>ほか {r.changes.length - 3}件</li>}
                        </ul>
                      )}
                    </Card>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </>
      )}

      <footer className="space-y-1 border-t border-border pt-4 text-xs text-muted-foreground">
        <p>ここに出すのは記録の有無と中身の違いだけで、法令に沿っているかの判断ではありません。取り扱いは、必要に応じて弁護士などの専門家にご確認ください。</p>
        <p>
          出典：
          <a href={TERMS_SOURCES.flQa} target="_blank" rel="noopener noreferrer">
            公正取引委員会 フリーランス法 Q&A
          </a>
          ・
          <a href={TERMS_SOURCES.flLaw} target="_blank" rel="noopener noreferrer" className="ml-1">
            フリーランス法（e-Gov 法令検索）
          </a>
          ・
          <a href={TERMS_SOURCES.flKankoku} target="_blank" rel="noopener noreferrer" className="ml-1">
            勧告の一覧
          </a>
        </p>
      </footer>
    </div>
  );
}
