import Link from "next/link";
import { Money } from "@/components/ui";
import { Badge } from "~/components/page";
import type { VersionHistoryItem } from "~/server/features/statements/history";

/**
 * 版の履歴（会社の画面）。新しい版が上。どの版も、作った日時・振込額・目印（ハッシュの頭）と、
 * 1 つ前の版から変わったところ、その版をドライバーがいつ確認したかを出す。古い版はたたんでおく。
 */
export function VersionHistory({ statementId, items }: { statementId: string; items: VersionHistoryItem[] }) {
  if (items.length === 0) {
    return <p className="mt-2 text-sm text-muted-foreground">版の写しはまだありません。明細を作ると、ここに版 1 が入ります。</p>;
  }
  return (
    <ol className="mt-2 space-y-2" aria-label="版の履歴">
      {items.map((v, i) => (
        <li key={v.version}>
          {/* いちばん新しい版は開いたまま。古い版は押すと開く */}
          <details open={i === 0} className="rounded-lg border border-border p-3 text-sm">
            <summary className="flex min-h-11 cursor-pointer flex-wrap items-center gap-x-3 gap-y-1">
              <span className="font-bold">版 {v.version}</span>
              {v.current && <Badge tone="green">いまの版</Badge>}
              {v.confirmations.length > 0 && <Badge tone={v.current ? "green" : "gray"}>確認 {v.confirmations.length}回</Badge>}
              {v.total !== null && <Money value={v.total} className="ml-auto font-bold" />}
            </summary>
            <dl className="mt-2 grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-1">
              <dt className="text-muted-foreground">作った日時</dt>
              <dd>
                {v.missing ? "写しが残っていません（確認の記録だけがあります）" : v.createdAtText}
                {v.createdByName && <span className="text-muted-foreground">（{v.createdByName}）</span>}
              </dd>
              <dt className="text-muted-foreground">目印</dt>
              <dd className="break-all font-mono text-xs">{v.hashShort}</dd>
            </dl>
            {v.prevVersion !== null && (
              <div className="mt-2">
                <p className="font-bold">版 {v.prevVersion} から変わったところ</p>
                <ul className="mt-1 space-y-1">
                  {v.changes.map((c, j) => (
                    <li key={j} className="break-words">
                      ・{c}
                    </li>
                  ))}
                </ul>
              </div>
            )}
            {v.prevVersion === null && !v.missing && <p className="mt-2 text-muted-foreground">最初に作った版です。</p>}
            <div className="mt-2">
              <p className="font-bold">ドライバーの確認</p>
              {v.confirmations.length === 0 ? (
                <p className="text-muted-foreground">この版の確認はありません。</p>
              ) : (
                <ul className="mt-1 space-y-1">
                  {v.confirmations.map((c, j) => (
                    <li key={j} className="break-words">
                      {c.at} に確認（そのときの振込額 <Money value={c.total} />）{c.hashMatches ? "" : "・目印が写しと違います（確認の記録を見てください）"}
                    </li>
                  ))}
                </ul>
              )}
            </div>
            {!v.missing && !v.current && (
              <Link href={`/statements/${statementId}/versions/${v.version}`} className="mt-2 inline-flex min-h-11 items-center">
                版 {v.version} の中身を見る
              </Link>
            )}
          </details>
        </li>
      ))}
    </ol>
  );
}
