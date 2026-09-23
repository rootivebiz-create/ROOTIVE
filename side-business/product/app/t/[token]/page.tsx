import { notFound } from "next/navigation";
import { jpDate } from "@/lib/format";
import { ReceiveForm } from "~/components/terms/receive-form";
import { TermsDocumentView } from "~/components/terms/terms-document-view";
import { getDb } from "~/db/client";
import { loadTermsPortal } from "~/server/features/terms/portal";
import { isTermsStaffPreview } from "~/server/features/terms/request";

export const dynamic = "force-dynamic";

/** ドライバーの取引条件のページ（ログインなし）。リンクの署名・期限・作り直しを毎回確かめる */
export default async function DriverTermsPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const db = await getDb();
  const data = await loadTermsPortal(db, token);
  if (!data) notFound();
  const staffPreview = await isTermsStaffPreview(db, token);
  const d = data.doc;
  const enc = encodeURIComponent(token);

  return (
    <main>
      <header className="mb-4">
        <p className="text-sm text-muted-foreground">{data.companyName}</p>
        <h1 className="text-2xl font-bold">取引条件のお知らせ</h1>
        <p className="text-sm text-muted-foreground">
          {d.driver.name} 様・版 {d.version}・{jpDate(d.issuedOn)}
        </p>
      </header>

      <div className="space-y-3">
        {!data.isLatest && (
          <div role="alert" className="rounded-lg border-2 border-danger bg-danger/10 p-3 font-bold text-danger">
            新しい版があります。
            <span className="mt-1 block text-sm font-normal text-foreground">
              このページは前の版（版 {d.version}）です。いまの条件は版 {data.latestVersion} です。
              {data.latestToken ? "下のボタンから、新しい版を開いてください。" : "会社から新しい版のリンクが届くまで、お待ちください。届かないときは、会社にお尋ねください。"}
            </span>
            {data.latestToken && (
              <a
                href={`/t/${encodeURIComponent(data.latestToken)}`}
                className="mt-2 flex min-h-11 items-center justify-center rounded-lg bg-foreground px-4 text-base font-bold text-background no-underline"
              >
                新しい版（版 {data.latestVersion}）を開く
              </a>
            )}
          </div>
        )}
        {staffPreview && (
          <p role="status" className="rounded-lg border border-border bg-muted p-3 text-sm">
            会社の方としてログインしたまま開いています。「受け取りました」は、ドライバーご本人だけが押せます（ご本人が会社の方でもあるときは、ログアウトしてから開き直してください）。
          </p>
        )}
        {data.isLatest && data.received ? (
          <p className="rounded-lg border border-success/40 bg-success/10 p-3 text-sm font-bold text-success">
            {data.received.at} に受け取りました（版 {data.received.version}）
          </p>
        ) : data.isLatest ? (
          <div className="space-y-2 text-base">
            <p>
              {data.companyName}
              から、お仕事の条件（仕事の内容・報酬・支払日・差し引くもの など）をお知らせする書面です。
            </p>
            <p>
              読んだら、
              <a href="#receive" className="font-bold">
                いちばん下の「受け取りました」
              </a>
              を押してください。分からないところ・違うと思うところは、会社にお尋ねください。
            </p>
          </div>
        ) : null}
      </div>

      <div className="mt-4">
        <TermsDocumentView doc={d} large />
      </div>

      <section id="receive" className="mt-6 scroll-mt-4">
        <h2 className="mb-2 text-lg font-bold">受け取りの記録</h2>
        {data.isLatest ? (
          <ReceiveForm token={token} version={d.version} received={data.received} disabled={staffPreview} />
        ) : (
          <p className="rounded-lg border border-border bg-muted p-3 text-sm">この版では「受け取りました」は押せません。{data.latestToken ? "上の「新しい版を開く」から開いてください。" : "新しい版のリンクを開いてください。"}</p>
        )}
      </section>

      <section className="mt-8">
        <h2 className="text-lg font-bold">保存する</h2>
        <a
          href={`/api/t/${enc}/pdf`}
          className="mt-2 flex min-h-11 items-center justify-center rounded-lg border border-border bg-card px-4 text-sm font-bold text-foreground no-underline"
        >
          この書面を PDF で保存
        </a>
      </section>

      <footer className="mt-10 space-y-1 border-t border-border pt-4 text-xs text-muted-foreground">
        <p>このページは {data.companyName} からあなたに届いた取引条件の書面です。リンクをほかの人に送らないでください。</p>
        <p>このリンクは {data.linkExpiresText} まで使えます。内容についてのご質問は、会社にお尋ねください。</p>
      </footer>
    </main>
  );
}
