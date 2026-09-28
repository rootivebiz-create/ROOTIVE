import Link from "next/link";
import { notFound } from "next/navigation";
import { buttonClass, Card } from "@/components/ui";
import { jpDate, jpMonth } from "@/lib/format";
import { Notice } from "~/components/page";
import { TermsLinkPanel } from "~/components/terms/link-panel";
import { TermsStatusBadge } from "~/components/terms/status-badge";
import { TermsDocumentView } from "~/components/terms/terms-document-view";
import { TermsForm } from "~/components/terms/terms-form";
import { getDb } from "~/db/client";
import { requirePageUser, roleAtLeast } from "~/server/auth";
import { listTerms, loadTermsDriver, type TermsListRow, type TermsVersionView } from "~/server/features/terms";
import { deductionText, TERMS_SOURCES } from "~/server/features/terms/document";
import { jpDateTimeJst, termsLinkToken, termsShareMessage, termsShareSubject, todayJst } from "~/server/features/terms/links";
import { termsOrigin } from "~/server/features/terms/request";
import { TERMS_STATUS } from "~/server/features/terms/status";
import { shareLinks } from "~/server/features/statements/view";

export const metadata = { title: "取引条件の明示" };

/** 1 人の取引条件：最新の明示書・送る・受け取りの記録・新しい版を作る・版の履歴 */
export default async function TermsDriverPage({ params }: { params: Promise<{ driverId: string }> }) {
  const user = await requirePageUser("viewer");
  const { driverId } = await params;
  const db = await getDb();
  const detail = await loadTermsDriver(db, user.tenantId, driverId);
  if (!detail) notFound();
  const canEdit = roleAtLeast(user.role, "staff");
  const d = detail.driver;
  const latest = detail.latest;
  const today = todayJst();
  // 次に送る人（明示書が無い・まだ送っていない・明示のあとで条件が変わった人）。一覧の並びで、この人の次から順に
  const nextToSend = canEdit ? nextTermsToSend((await listTerms(db, user.tenantId)).rows, d.id) : null;
  const nextLink = nextToSend ? (
    <Link href={`/terms/${nextToSend.driverId}`} className={buttonClass("secondary", "w-full")}>
      次に送る人へ（{nextToSend.name}・{nextToSend.status === "none" ? "未作成" : nextToSend.status === "unsent" ? "未送付" : "条件が変わった"}）→
    </Link>
  ) : null;

  let link: { url: string; message: string; links: ReturnType<typeof shareLinks>; expiresText: string } | null = null;
  if (canEdit && latest) {
    const { token, expiresAt } = termsLinkToken({ id: latest.id, linkNonce: latest.linkNonce });
    const url = `${await termsOrigin()}/t/${token}`;
    const message = termsShareMessage(d.name, detail.company.name, url);
    link = {
      url,
      message,
      links: shareLinks({ message, subject: termsShareSubject(detail.company.name), phone: d.phone, email: d.email }),
      expiresText: jpDateTimeJst(new Date(expiresAt * 1000)),
    };
  }
  const openForm = !latest || detail.changes.length > 0;
  const form = canEdit ? (
    <TermsForm
      driverId={d.id}
      baseVersion={latest?.version ?? 0}
      projects={detail.projects}
      initial={detail.initial}
      today={today}
      preview={{
        deductions: detail.current.deductions.map(deductionText),
        paymentText: detail.current.payment.text,
        periodText: detail.current.payment.periodText,
        taxNote: detail.current.taxNote,
        feeByDriver: detail.warnings.feeByDriver,
        deemedText: detail.deemedText,
      }}
      links={{ rules: "/settings/rules", company: "/settings/company", rates: "/settings/rates", ntaQa: TERMS_SOURCES.ntaQa }}
      startOpen={openForm}
    />
  ) : null;

  return (
    <div className="space-y-5">
      <div>
        <Link href="/terms" className="inline-flex min-h-11 items-center text-sm">
          ← 取引条件の明示の一覧
        </Link>
        <div className="flex flex-wrap items-center gap-3">
          <h1 className="text-2xl font-bold">{d.name}さんの取引条件</h1>
          <TermsStatusBadge status={detail.status} workedRecently={detail.workedRecently} />
        </div>
        <p className="mt-1 text-sm text-muted-foreground">
          {latest ? `最新は版 ${latest.version}（明示 ${jpDate(latest.issuedOn)}）。${TERMS_STATUS[detail.status].hint}` : TERMS_STATUS.none.hint}
          {d.termsIssuedOn && `・台帳の「最初に明示した日」${jpDate(d.termsIssuedOn)}`}
          {detail.firstWorkMonth && `・最初の稼働 ${jpMonth(detail.firstWorkMonth)}`}
          {!d.active && "・無効にしたドライバー"}
        </p>
      </div>

      {!latest && detail.workedRecently && (
        <Notice tone="error">
          最近の稼働があるのに、明示書の記録がありません。{canEdit ? "下で版 1 を作って、ドライバーに送ってください。" : "事務・オーナーの方に、明示書を作って送るようお願いしてください。"}
        </Notice>
      )}
      {!latest && d.termsIssuedOn && (
        <Notice tone="info">
          台帳に明示した日（{jpDate(d.termsIssuedOn)}）が手で入っていますが、明示書の記録はありません。明示書を作ると、中身の写しとドライバーの「受け取りました」が残ります（台帳の日付は、それより前の日付で作ったときだけ動きます）。
        </Notice>
      )}
      {detail.warnings.paymentWords.length > 0 && (
        <p role="alert" className="rounded-lg border border-danger/40 bg-danger/10 p-3 text-sm text-danger">
          支払期日の文に「{detail.warnings.paymentWords.join("」「")}」が入っています。公正取引委員会の Q&A は、「〜まで」「〜以内」を具体的な支払期日と認めていません。
          <Link href="/settings/company" className="mx-1">
            設定 → 会社
          </Link>
          の支払日の確認をおすすめします。
          <a href={TERMS_SOURCES.flQa} target="_blank" rel="noopener noreferrer" className="ml-1">
            出典
          </a>
        </p>
      )}
      {detail.warnings.contractWording && (
        <p role="alert" className="rounded-lg border border-danger/40 bg-danger/10 p-3 text-sm text-danger">
          会社の設定の「支払期日の文言」（契約書などに書いている文：「{detail.warnings.contractWording.text}」）に「{detail.warnings.contractWording.words.join("」「")}」が入っています。
          公正取引委員会の Q&A は、「〜まで」「〜以内」を具体的な支払期日と認めていません。この明示書には、台帳から作った具体的な支払期日（{detail.current.payment.text}）が入りますが、契約書などの文言が食い違っていないかの確認をおすすめします。
          <Link href="/settings/company" className="mx-1">
            設定 → 会社
          </Link>
          <a href={TERMS_SOURCES.flQa} target="_blank" rel="noopener noreferrer" className="ml-1">
            出典
          </a>
        </p>
      )}
      {detail.warnings.feeByDriver && (
        <p role="alert" className="rounded-lg border border-danger/40 bg-danger/10 p-3 text-sm text-danger">
          振込手数料をドライバーが負担する設定です。報酬から振込手数料を差し引く扱いは、報酬の減額にあたるおそれがあります（フリーランス法 第5条・取適法（中小受託取引適正化法））。
          <Link href="/settings/company" className="mx-1">
            設定 → 会社
          </Link>
          の設定と、取り扱いについて専門家への確認をおすすめします。
          <a href={TERMS_SOURCES.flQa} target="_blank" rel="noopener noreferrer" className="ml-1">
            公取委 Q&A
          </a>
          ・
          <a href={TERMS_SOURCES.toritekiLeaflet} target="_blank" rel="noopener noreferrer" className="ml-1">
            取適法のリーフレット
          </a>
        </p>
      )}
      {detail.warnings.deadline && (
        <Notice tone="info">
          {detail.warnings.deadline.status === "ng"
            ? `今の支払日の決め方だと、締め日から数えても、支払日が受け取りから60日を超える月があります（いちばん長くて ${detail.warnings.deadline.maxDaysFromEnd}日）。`
            : `今の支払日の決め方だと、締め期間の最初の日に受け取った分は、支払日が受け取りから60日を超える月があります（いちばん長くて ${detail.warnings.deadline.maxDaysFromStart}日）。`}
          フリーランス法 第4条（支払期日）について、確認をおすすめします。
        </Notice>
      )}

      {detail.changes.length > 0 && latest && (
        <Card className="border-warning/60">
          <h2 className="font-bold text-warning">条件が変わっています（版 {latest.version} を明示したあとに、台帳や稼働が変わりました）</h2>
          <ul className="mt-2 space-y-1 text-sm">
            {detail.changes.map((c, i) => (
              <li key={i} className="break-words">
                ・{c}
              </li>
            ))}
          </ul>
          <p className="mt-2 text-sm">
            {canEdit ? (
              <>
                <a href="#new">下の「新しい版を作る」</a>で版 {latest.version + 1} を作って、送り直してください。
              </>
            ) : (
              "事務・オーナーの方に、新しい版を作って送るようお願いしてください。"
            )}
          </p>
        </Card>
      )}

      {latest && (
        // 列は必ず画面の幅に収める
        <div className="grid grid-cols-[minmax(0,1fr)] gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(0,26rem)]">
          <div className="order-2 min-w-0 space-y-3 lg:order-1">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h2 className="text-lg font-bold">ドライバーに見えている明示書（版 {latest.version}）</h2>
              <a href={`/api/terms/${latest.id}/pdf`} className={buttonClass("secondary")}>
                PDF（A4）
              </a>
            </div>
            <TermsDocumentView doc={latest.doc} />
          </div>
          <div className="order-1 min-w-0 space-y-5 lg:order-2">
            <Card>
              <h2 className="font-bold">ドライバーへ送る</h2>
              <dl className="mt-2 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-sm">
                <dt className="text-muted-foreground">明示した日</dt>
                <dd>{jpDate(latest.issuedOn)}</dd>
                <dt className="text-muted-foreground">送付</dt>
                <dd>{latest.sentAt ? jpDateTimeJst(latest.sentAt) : "まだ送っていません"}</dd>
                <dt className="text-muted-foreground">受け取り</dt>
                <dd>{latest.receivedAt ? `${jpDateTimeJst(latest.receivedAt)}（版 ${latest.version}）` : "まだ「受け取りました」の記録はありません"}</dd>
              </dl>
              <div className="mt-3">
                {link ? (
                  <TermsLinkPanel
                    recordId={latest.id}
                    url={link.url}
                    message={link.message}
                    links={link.links}
                    expiresText={link.expiresText}
                    hasPhone={!!d.phone}
                    hasEmail={!!d.email}
                  />
                ) : (
                  <p className="text-sm text-muted-foreground">ドライバー用のリンクは、見るだけの役割では出しません。送るのは事務・オーナーの方です。</p>
                )}
              </div>
              {/* 送ったら、そのまま次の人へ（スマホでは一番下まで行かなくてよいように、送るボタンの下に置く） */}
              {nextLink && <div className="mt-3">{nextLink}</div>}
            </Card>
          </div>
        </div>
      )}

      {form && (
        <section id="new" className="space-y-3">
          <h2 className="text-lg font-bold">{latest ? "新しい版を作る" : "明示書を作る（版 1）"}</h2>
          <p className="text-sm text-muted-foreground">
            単価・控除・支払日は台帳から入ります。書き換えるのは、仕事の中身・場所・期間などの文と、条項の有無だけです。保存したら、上の「ドライバーへ送る」から送ってください。
          </p>
          {form}
        </section>
      )}

      {!canEdit && !latest && <p className="text-sm text-muted-foreground">明示書を作るのは、事務・オーナーの方です。</p>}
      {!latest && nextLink && <nav aria-label="次に送る人">{nextLink}</nav>}

      {detail.versions.length > 0 && (
        <section className="space-y-3">
          <h2 className="text-lg font-bold">版の履歴（{detail.versions.length}件）</h2>
          <p className="text-sm text-muted-foreground">前の版は書き換えずに残ります。どの版を、いつ明示し、いつ受け取ってもらったかが分かります。</p>
          <ol className="space-y-2">
            {detail.versions.map((v) => (
              <VersionItem key={v.id} v={v} />
            ))}
          </ol>
        </section>
      )}

      <footer className="space-y-1 border-t border-border pt-4 text-xs text-muted-foreground">
        <p>明示書はひな形です。内容は、必要に応じて弁護士などの専門家に確認してください。ここに出すのは記録の有無と中身の違いだけで、法令に沿っているかの判断ではありません。</p>
        <p>
          出典：
          <a href={TERMS_SOURCES.flQa} target="_blank" rel="noopener noreferrer">
            公正取引委員会 フリーランス法 Q&A
          </a>
          ・
          <a href={TERMS_SOURCES.flGuide} target="_blank" rel="noopener noreferrer" className="ml-1">
            解釈ガイドライン
          </a>
          ・
          <a href={TERMS_SOURCES.flLaw} target="_blank" rel="noopener noreferrer" className="ml-1">
            条文（e-Gov）
          </a>
        </p>
      </footer>
    </div>
  );
}

/** 次に送る人：一覧の並びで、この人の次から順に見て、明示書が無い・まだ送っていない・条件が変わった人（いなければ null） */
function nextTermsToSend(rows: TermsListRow[], currentDriverId: string): TermsListRow | null {
  const i = rows.findIndex((r) => r.driverId === currentDriverId);
  const rotated = i >= 0 ? [...rows.slice(i + 1), ...rows.slice(0, i)] : rows;
  return rotated.find((r) => r.status === "none" || r.status === "unsent" || r.changes.length > 0) ?? null;
}

function VersionItem({ v }: { v: TermsVersionView }) {
  return (
    <li className="rounded-card border border-border bg-card">
      <details>
        <summary className="flex min-h-11 cursor-pointer flex-wrap items-center gap-x-3 gap-y-1 px-4 py-3">
          <span className="font-bold">版 {v.version}</span>
          <span className="text-sm">明示 {jpDate(v.issuedOn)}</span>
          <TermsStatusBadge status={v.status} />
          {v.isLatest ? <span className="text-xs text-muted-foreground">最新</span> : <span className="text-xs text-muted-foreground">前の版</span>}
        </summary>
        <div className="space-y-3 border-t border-border px-4 py-3 text-sm">
          <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1">
            <dt className="text-muted-foreground">作った日時</dt>
            <dd>{jpDateTimeJst(v.createdAt)}</dd>
            <dt className="text-muted-foreground">送付</dt>
            <dd>{v.sentAt ? jpDateTimeJst(v.sentAt) : "—"}</dd>
            <dt className="text-muted-foreground">受け取り</dt>
            <dd>{v.receivedAt ? jpDateTimeJst(v.receivedAt) : "—"}</dd>
            <dt className="text-muted-foreground">目印</dt>
            <dd className="num break-all">{v.doc.hashShort}</dd>
          </dl>
          {v.changesFromPrev === null ? (
            <p className="text-muted-foreground">最初の版です。</p>
          ) : v.changesFromPrev.length === 0 ? (
            <p className="text-muted-foreground">前の版から、明示した日のほかに変わったところはありません。</p>
          ) : (
            <div>
              <p className="font-bold">前の版（版 {v.version - 1}）から変わったところ</p>
              <ul className="mt-1 space-y-1">
                {v.changesFromPrev.map((c, i) => (
                  <li key={i} className="break-words">
                    ・{c}
                  </li>
                ))}
              </ul>
            </div>
          )}
          <a href={`/api/terms/${v.id}/pdf`} className={buttonClass("secondary")}>
            版 {v.version} の PDF
          </a>
          <details className="rounded-lg border border-border px-3">
            <summary className="cursor-pointer py-3 font-bold">版 {v.version} の中身を見る</summary>
            <div className="pb-3">
              <TermsDocumentView doc={v.doc} />
            </div>
          </details>
        </div>
      </details>
    </li>
  );
}
