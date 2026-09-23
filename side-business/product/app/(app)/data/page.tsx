import Link from "next/link";
import { Card, buttonClass } from "@/components/ui";
import { PageHeader } from "~/components/page";
import { jstDateTime } from "~/components/close/format";
import { RestoreForm } from "~/components/data/restore-form";
import { getDb } from "~/db/client";
import { requirePageUser } from "~/server/auth";
import { loadDataOverview, schemaVersion } from "~/server/features/export-all";
import { EXPORT_TABLES } from "~/server/features/export-all/tables";
import { monthLabelJa } from "~/server/month";

export const metadata = { title: "全データの書き出し" };

/**
 * 全データの書き出し（オーナーだけ）：やめるときも、別の場所へ移すときも、会社のデータを全部持ち帰れる。
 * 書き出し＝ZIP（表ごとの CSV・明細の全部の版・目録・説明書き）。読み戻し＝新しい会社として入れる。
 */
export default async function DataPage() {
  const user = await requirePageUser("owner");
  const db = await getDb();
  const o = await loadDataOverview(db, user.tenantId);

  return (
    <div className="space-y-8">
      <PageHeader
        title="全データの書き出し"
        description="しめ日ラボに入っている、この会社のデータをすべて 1 つの ZIP にして持ち帰れます。やめるときも、別の場所へ移すときも使えます。"
      />

      <section aria-labelledby="export-heading" className="space-y-3">
        <h2 id="export-heading" className="text-lg font-bold">
          書き出す
        </h2>
        <dl className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <Card>
            <dt className="text-xs text-muted-foreground">ドライバー</dt>
            <dd className="num text-xl font-bold">{o.drivers}人</dd>
          </Card>
          <Card>
            <dt className="text-xs text-muted-foreground">データのある月</dt>
            <dd className="num text-xl font-bold">{o.months}か月</dd>
            {o.firstMonth && o.lastMonth && (
              <dd className="text-xs text-muted-foreground">
                {monthLabelJa(o.firstMonth)}〜{monthLabelJa(o.lastMonth)}
              </dd>
            )}
          </Card>
          <Card>
            <dt className="text-xs text-muted-foreground">明細の版</dt>
            <dd className="num text-xl font-bold">{o.statementVersions}件</dd>
          </Card>
          <Card>
            <dt className="text-xs text-muted-foreground">操作の記録</dt>
            <dd className="num text-xl font-bold">{o.auditRows.toLocaleString("ja-JP")}件</dd>
          </Card>
        </dl>
        <Card className="space-y-3">
          <p className="text-sm">ZIP の中身：</p>
          <ul className="list-disc space-y-1 pl-5 text-sm">
            <li>表ごとの CSV（{EXPORT_TABLES.length} 個。Excel でそのまま開けます）：ドライバー・元請・案件・単価・控除・稼働・調整・明細・確認・質問・取引条件・支払通知・突合・振込・締め・操作の記録 など</li>
            <li>支払明細のすべての版（1 版 1 ファイル。ドライバーが確認した版とハッシュで照らし合わせられます）</li>
            <li>manifest.json（データの形の版・表ごとの行数・ファイルのハッシュ）と、中身の説明書き（README.txt）</li>
          </ul>
          <p className="text-sm text-muted-foreground">
            パスワードと、ログイン中のしるし・招待のリンクの値は入れません。ドライバーの口座などの大切な情報が入るので、保管と受け渡しに気をつけてください。書き出したことは操作の記録に残ります。
          </p>
          <a href="/api/data/export" className={buttonClass("primary", "w-full sm:w-auto")}>
            全データを書き出す（ZIP）
          </a>
          <p className="text-xs text-muted-foreground">
            {o.lastExport
              ? `前に書き出した日時：${jstDateTime(o.lastExport.at)}${o.lastExport.byName ? `（${o.lastExport.byName}さん）` : ""}`
              : "まだ書き出したことはありません。"}
            　データの形の版：{schemaVersion()}
          </p>
        </Card>
      </section>

      <section aria-labelledby="restore-heading" className="space-y-3">
        <h2 id="restore-heading" className="text-lg font-bold">
          別の場所へ移す（読み戻し）
        </h2>
        <Card className="space-y-3">
          <p className="text-sm">
            別の場所のしめ日ラボで書き出した ZIP を、ここに新しい会社として読み込みます。いま使っている会社のデータは変わりません。
          </p>
          <ul className="list-disc space-y-1 pl-5 text-sm text-muted-foreground">
            <li>同じ会社がすでにこの場所にあるときは読み込みません（二重になるのを防ぐため）。</li>
            <li>書き出したあとに中身が書き換えられた ZIP や、ほかの会社の行が混ざった ZIP は読み込みません。</li>
            <li>読み込んだあと、表ごとの行数と、明細のすべての版のハッシュが書き出したときと同じかを確かめます。違えば、何も書き込みません。</li>
            <li>締めた月は締めたまま、操作の記録もそのまま移ります。パスワードは移らないので、読み込んだ会社のオーナーへの招待のリンクを作ります。</li>
          </ul>
          {process.env.DEMO_MODE === "1" ? (
            <p className="rounded-lg border border-border bg-muted p-3 text-sm">デモでは読み戻しは使えません。書き出しは試せます。</p>
          ) : (
            <RestoreForm />
          )}
        </Card>
      </section>

      <section className="space-y-2 text-sm text-muted-foreground">
        <h2 className="text-base font-bold text-foreground">保存について</h2>
        <ul className="list-disc space-y-1 pl-5">
          <li>しめ日ラボは、保存期間を過ぎたデータを自動で消しません。消すかどうかは会社で決めてください。</li>
          <li>帳簿や書類をどのくらいの期間、どう保存するかは、会社で決めた決まり（事務処理規程など）に沿ってください。判断に迷うときは、税理士にご相談ください。</li>
        </ul>
        <p>
          <Link href="/audit" className="inline-flex min-h-11 items-center">
            操作の記録を見る →
          </Link>
        </p>
      </section>
    </div>
  );
}
