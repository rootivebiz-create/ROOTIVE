import { Money, TableWrap } from "@/components/ui";
import { jpDate } from "@/lib/format";
import type { CompanyCopy } from "~/server/features/statements/company-copy";

const NTA_TRANSITIONAL_URL = "https://www.nta.go.jp/taxes/shiraberu/zeimokubetsu/shohi/keigenzeiritsu/invoice_2tokurei.htm";

/**
 * 会社の控え（会社の画面だけ。ドライバーの画面・ドライバーの PDF には出さない）。
 * 登録番号の無い方への支払で、会社が仕入税額控除できずに負担する消費税（経過措置）と、その内訳。
 * 数字はどれも保存した明細の写しから（画面で計算し直さない）。登録番号のある方には出さない。
 */
export function CompanyCopyBox({ copy, taxMethod }: { copy: CompanyCopy; taxMethod: string }) {
  if (!copy.unregistered) return null;
  return (
    <section className="rounded-card border-2 border-dashed border-border bg-muted p-4 text-sm" aria-label="会社の控え">
      <h2 className="font-bold">会社の控え：経過措置の負担（ドライバーには見せません）</h2>
      {taxMethod !== "general" && copy.invoiceBurden === 0 && copy.parts.length === 0 ? (
        <p className="mt-1">会社の消費税の計算が原則課税ではない設定のため、この負担は 0 円として計算しています（設定は「会社」の画面で変えられます）。</p>
      ) : (
        <>
          {/* 数字は明細を作ったときの写し。そのあとで会社の設定を変えていれば、そう書く（作り直すまで数字は変わらない） */}
          {taxMethod !== "general" && (
            <p className="mt-1 rounded-lg border border-warning/40 bg-warning/10 p-2">
              いまの会社の設定は原則課税ではありません。下の数字は、明細を作ったときの設定（原則課税）で計算したものです。明細を作り直すと 0 円になります。
            </p>
          )}
          <p className="mt-1">登録番号の無い方への支払（税込）のうち、仕入税額控除できるのは経過措置の割合までです。控除できない分を会社が負担します。</p>
          <dl className="mt-2 grid grid-cols-[minmax(0,1fr)_auto] gap-x-3 gap-y-1">
            <dt>期間の末日の割合</dt>
            <dd className="num text-right">{copy.deductibleRatePercent !== null ? `${copy.deductibleRatePercent}%` : "—"}</dd>
            <dt className="font-bold">{copy.parts.length > 0 ? "会社が負担する消費税（日ごとに分けた目安）" : "会社が負担する消費税"}</dt>
            <dd className="text-right font-bold">
              <Money value={copy.invoiceBurden} />
            </dd>
          </dl>
          {copy.parts.length > 0 && (
            <>
              <p className="mt-3 font-bold">締めの期間が、割合の変わる日をまたいでいます（稼働の日ごとに分けて計算）</p>
              <p className="mt-1 break-words">{copy.partsText}</p>
              <TableWrap>
                <table className="mt-2 w-full min-w-[18rem] text-sm">
                  <thead>
                    <tr className="border-b border-border text-left text-xs text-muted-foreground">
                      <th className="py-1 pr-2 font-normal">期間</th>
                      <th className="py-1 pr-2 text-right font-normal">支払（税込）</th>
                      <th className="py-1 pr-2 text-right font-normal">控除できる割合</th>
                      <th className="py-1 text-right font-normal">会社の負担</th>
                    </tr>
                  </thead>
                  <tbody>
                    {copy.parts.map((p) => (
                      <tr key={`${p.from}-${p.to}`} className="border-b border-border">
                        <td className="py-1 pr-2">
                          {p.label}
                          <span className="block text-xs text-muted-foreground">
                            稼働 {p.from === p.to ? jpDate(p.from) : `${jpDate(p.from)}〜${jpDate(p.to)}`}
                          </span>
                        </td>
                        <td className="py-1 pr-2 text-right">
                          <Money value={p.base} />
                        </td>
                        <td className="num py-1 pr-2 text-right">{p.ratePercent}%</td>
                        <td className="py-1 text-right">
                          <Money value={p.burden} />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </TableWrap>
              <p className="mt-2 rounded-lg border border-warning/40 bg-warning/10 p-2" role="note">
                稼働の日ごとに割合を分けた目安です。国税庁の Q&A には、9月21日から提供を受けて10月20日に完了した役務を、期間全体で10月1日以後の割合とする例があります。どちらで扱うかは税理士にご確認ください
                {copy.periodEndBurden !== null && (
                  <>
                    （期間全体を末日の割合{copy.deductibleRatePercent !== null ? `（${copy.deductibleRatePercent}%）` : ""}で数えた場合：
                    <Money value={copy.periodEndBurden} />）
                  </>
                )}
                。会計ソフト向けの仕訳の税区分は、期間の末日の割合で出します。
              </p>
            </>
          )}
          {copy.undatedAcrossStep && (
            <p className="mt-2 rounded-lg border border-warning/40 bg-warning/10 p-2 font-bold text-warning" role="note">
              日付の無い稼働があり、期間の末日の割合で計算しています。稼働に日付を入れて明細を作り直すと、日ごとの割合で分けて計算します（見張り番にも出ます）。
            </p>
          )}
          <p className="mt-2 text-xs text-muted-foreground">
            会社の控えとしての目安です。扱いは税理士にご確認ください（
            <a href={NTA_TRANSITIONAL_URL} target="_blank" rel="noopener noreferrer">
              国税庁 インボイス制度の経過措置
            </a>
            ）。
          </p>
        </>
      )}
    </section>
  );
}
