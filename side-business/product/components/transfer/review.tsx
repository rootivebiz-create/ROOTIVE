import Link from "next/link";
import { Card } from "@/components/ui";
import { Badge } from "~/components/page";
import { jstDateTime } from "~/components/close/format";
import type { NoteDriver, TransferReview } from "~/server/features/transfer";
import { monthLabelJa } from "~/server/month";

/**
 * 振込データを作る前に見せること（画面の上に必ず出す）。
 * ① 前回の振込から口座が変わった人（変えた人と日時つき）… 作るときに「確かめました」の印が要る
 * ② 質問・未確認・前の版の確認 … 知らせるだけで、止めない
 */

function who(d: NoteDriver): string {
  return d.driverCode ? `${d.driverName}（${d.driverCode}）` : d.driverName;
}

function names(list: NoteDriver[], max = 8): string {
  const shown = list.slice(0, max).map((d) => d.driverName);
  return list.length > max ? `${shown.join("、")} ほか ${list.length - max}人` : shown.join("、");
}

export function TransferReviewSection({ review, m }: { review: TransferReview; m: string }) {
  const { bank, notes } = review;
  const infoCount = notes.openQuestions.length + notes.unconfirmed.length + notes.oldVersion.length;
  return (
    <section aria-labelledby="review-heading" className="space-y-3">
      <h3 id="review-heading" className="font-bold">
        作る前に確かめること
      </h3>

      {/* ① 口座の変更 */}
      <Card className={bank.changed.length ? "border-danger/60" : undefined}>
        <div className="flex flex-wrap items-center gap-2">
          <h4 className="min-w-0 flex-1 font-bold">前回の振込から口座が変わった人</h4>
          {bank.changed.length ? <Badge tone="red">{bank.changed.length}人</Badge> : <Badge tone="green">いません</Badge>}
        </div>
        {bank.changed.length === 0 ? (
          <p className="mt-2 text-sm text-muted-foreground">
            振込する {bank.compared}人の口座を、前に作った振込データのときの口座と比べました。変わった人はいません。
          </p>
        ) : (
          <div className="mt-2 space-y-3 text-sm">
            <p>
              口座の変更は、なりすましの連絡などによる誤った振込が起きやすいところです。振込データを作る前に、登録している電話番号へこちらから電話するなどして、ご本人に確かめてください。
            </p>
            <ul className="space-y-3">
              {bank.changed.map((c) => (
                <li key={c.driverId} className="rounded-lg border border-danger/30 p-3">
                  <p className="font-bold text-danger">{who(c)}</p>
                  <dl className="mt-1 grid gap-1">
                    <div className="flex flex-wrap gap-x-2">
                      <dt className="text-muted-foreground">前回</dt>
                      <dd className="min-w-0 break-all">
                        <span className="num">{c.previous.masked}</span>
                        <span className="text-muted-foreground">
                          （{c.previous.month ? `${monthLabelJa(c.previous.month)}分・` : ""}
                          {jstDateTime(c.previous.at)} に作った振込データ{c.previous.deleted ? "・あとで取り消したもの" : ""}）
                        </span>
                      </dd>
                    </div>
                    <div className="flex flex-wrap gap-x-2">
                      <dt className="text-muted-foreground">いま</dt>
                      <dd className="num min-w-0 break-all font-bold">{c.currentMasked}</dd>
                    </div>
                    <div className="flex flex-wrap gap-x-2">
                      <dt className="text-muted-foreground">変わったところ</dt>
                      <dd>{c.fields.join("・")}</dd>
                    </div>
                  </dl>
                  {c.edits.length ? (
                    <ul className="mt-2 space-y-1">
                      {c.edits.map((e, i) => (
                        <li key={i}>
                          <span className="num">{jstDateTime(e.at)}</span> に{e.userName ? `${e.userName}さんが` : "（だれかが）"}
                          {e.fields.join("・")}を変えました
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <p className="mt-2 text-muted-foreground">変わった日時は記録にありません（ドライバーの設定の画面の外で変わったか、記録を始める前の変更です）。</p>
                  )}
                  <Link href={`/settings/drivers/${c.driverId}`} className="mt-1 inline-flex min-h-11 items-center">
                    {c.driverName}さんの口座を見る →
                  </Link>
                </li>
              ))}
            </ul>
            <p className="text-muted-foreground">口座番号は下 3 桁だけを出しています。前回の口座は、振込データを作ったときの記録から比べています。</p>
          </div>
        )}
        {bank.firstTime.length > 0 && (
          <p className="mt-3 text-sm">
            <Badge tone="yellow">初めての振込</Badge>{" "}
            <span className="ml-1">
              {names(bank.firstTime)}（{bank.firstTime.length}人）は、前に振り込んだ記録がありません。初めての口座は、通帳やキャッシュカードの写しなどで確かめておくと安心です。
            </span>
          </p>
        )}
        {bank.unknown.length > 0 && (
          <p className="mt-2 text-sm text-muted-foreground">
            {names(bank.unknown)}（{bank.unknown.length}人）は、前回の振込のときの口座の記録がありません（この確かめを始める前の振込です）。今回作る振込データから比べられるようになります。
          </p>
        )}
      </Card>

      {/* ② 知らせること（止めない） */}
      <Card>
        <div className="flex flex-wrap items-center gap-2">
          <h4 className="min-w-0 flex-1 font-bold">明細の質問と確認の様子（参考）</h4>
          {infoCount ? <Badge tone="yellow">確かめてください</Badge> : <Badge tone="green">ありません</Badge>}
        </div>
        {infoCount === 0 ? (
          <p className="mt-2 text-sm text-muted-foreground">未解決の質問・まだ確認されていない明細・前の版を確認したままの明細はありません。</p>
        ) : (
          <ul className="mt-2 space-y-2 text-sm">
            {notes.openQuestions.length > 0 && (
              <li>
                <span className="font-bold">未解決の質問 {notes.openQuestions.length}人：</span>
                {notes.openQuestions.map((q) => `${q.driverName}（${q.count}件）`).join("、")}。
                振り込む額が変わるかもしれないので、先に返事をしておくと安心です。
              </li>
            )}
            {notes.oldVersion.length > 0 && (
              <li>
                <span className="font-bold">前の版を確認したまま {notes.oldVersion.length}人：</span>
                {notes.oldVersion.map((o) => `${o.driverName}（第${o.confirmedVersion}版を確認・いまは第${o.currentVersion}版）`).join("、")}。
                今の明細をもう一度送って、確認をお願いしてください。
              </li>
            )}
            {notes.unconfirmed.length > 0 && (
              <li>
                <span className="font-bold">まだ確認されていない {notes.unconfirmed.length}人：</span>
                {notes.unconfirmed.map((u) => `${u.driverName}（${u.status}）`).join("、")}。
              </li>
            )}
          </ul>
        )}
        {infoCount > 0 && (
          <>
            <p className="mt-2 text-sm text-muted-foreground">振込データは作れます（止めません）。</p>
            <Link href={`/statements?m=${m}`} className="inline-flex min-h-11 items-center text-sm">
              明細と確認の様子を見る →
            </Link>
          </>
        )}
      </Card>
    </section>
  );
}
