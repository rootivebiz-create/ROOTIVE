import { Card, Money, TableWrap } from "@/components/ui";
import { jpDate, jpMonth } from "@/lib/format";
import { pct } from "@/lib/payroll/money";
import { Badge } from "~/components/page";
import { signedYen } from "~/server/features/profit/format";
import type { BurdenSplit, FutureBurden } from "~/server/features/profit/summary";

const EMPTY_SPLIT: BurdenSplit = { people: 0, parts: [], total: 0, undated: [] };

/** 「佐藤 亮さん・木村 誠さん ほか 2人」 */
function namesText(names: string[]): string {
  const shown = names.slice(0, 3).map((n) => `${n}さん`).join("・");
  return names.length > 3 ? `${shown} ほか ${names.length - 3}人` : shown;
}

/**
 * 締めの期間が経過措置の段の境目（例：10 月 1 日）をまたぐ月の、日ごとに分けた内訳（明細の burdenParts を割合ごとに足したもの）。
 * 日付の無い稼働は期間の末日の割合で数えているので、その人の名前も出す。
 */
function SplitSection({ split, actual }: { split: BurdenSplit; actual: number }) {
  if (split.people === 0 && split.undated.length === 0) return null;
  return (
    <div className="space-y-2 rounded-lg border border-border p-3">
      <p className="text-sm font-bold">この月の締めの期間は、控除できる割合が変わる日をまたいでいます</p>
      {split.people > 0 && (
        <>
          <p className="text-sm">
            稼働に日付がある {split.people}人は、稼働の日ごとに割合を分けて数えています。この月の会社の負担は、全員で <Money value={actual} className="font-bold" /> です（上の「会社の利益」から引いている額）。
          </p>
          <TableWrap>
            <table className="w-full min-w-[30rem] border-collapse text-sm">
              <caption className="sr-only">控除できる割合ごとの内訳</caption>
              <thead>
                <tr className="border-b border-border text-xs text-muted-foreground">
                  <th scope="col" className="px-2 py-2 text-left font-normal">
                    稼働の日
                  </th>
                  <th scope="col" className="px-2 py-2 text-right font-normal">
                    控除できる割合
                  </th>
                  <th scope="col" className="px-2 py-2 text-right font-normal">
                    支払（委託料 ＋ 消費税相当額）
                  </th>
                  <th scope="col" className="px-2 py-2 text-right font-normal">
                    会社の負担
                  </th>
                  <th scope="col" className="px-2 py-2 text-right font-normal">
                    人数
                  </th>
                </tr>
              </thead>
              <tbody>
                {split.parts.map((p) => (
                  <tr key={p.rate} className="border-b border-border">
                    <th scope="row" className="whitespace-nowrap px-2 py-2 text-left font-normal">
                      {p.from === p.to ? jpDate(p.from) : `${jpDate(p.from)}〜${jpDate(p.to)}`}
                    </th>
                    <td className="num px-2 py-2 text-right">{pct(p.rate)}</td>
                    <td className="px-2 py-2 text-right">
                      <Money value={p.base} />
                    </td>
                    <td className="px-2 py-2 text-right">
                      <Money value={p.burden} />
                    </td>
                    <td className="num px-2 py-2 text-right">{p.people}人</td>
                  </tr>
                ))}
                <tr className="font-bold">
                  <th scope="row" className="px-2 py-2 text-left">
                    分けて数えた {split.people}人の合計
                  </th>
                  <td />
                  <td className="px-2 py-2 text-right">
                    <Money value={split.parts.reduce((a, p) => a + p.base, 0)} />
                  </td>
                  <td className="px-2 py-2 text-right">
                    <Money value={split.total} />
                  </td>
                  <td />
                </tr>
              </tbody>
            </table>
          </TableWrap>
          <p className="text-xs text-muted-foreground">支払は、稼働の日ごとの金額の割合で分けています（1 円未満は余りの大きい順に配っています）。1 人ずつ出して足しています。</p>
        </>
      )}
      {split.undated.length > 0 && (
        <p className="text-sm">
          日付の無い稼働がある {split.undated.length}人（{namesText(split.undated.map((u) => u.name))}）は、締めの期間の末日の割合で数えています。稼働に日付を入れて取り込むと、日ごとに分けて数えます。
        </p>
      )}
    </div>
  );
}

/** 出典（確かめた公式のページだけ） */
const SOURCES = {
  transitional: "https://www.nta.go.jp/taxes/shiraberu/zeimokubetsu/shohi/keigenzeiritsu/invoice_2tokurei.htm",
  kohyo: "https://www.invoice-kohyo.nta.go.jp/",
  jftcQa: "https://www.jftc.go.jp/dk/guideline/unyoukijun/invoice_qanda.html",
};

/**
 * インボイスの経過措置で、会社が負担する消費税（今と、これからの段階）。
 * 数字は「この月と同じ稼働が続いた場合の目安」。税金の判断や、支払の決め方の助言はしない。
 */
export function BurdenPanel({ future, month, split = EMPTY_SPLIT, actual }: { future: FutureBurden; month: string; split?: BurdenSplit; actual?: number }) {
  return (
    <Card className="space-y-4">
      <div>
        <h2 id="burden-heading" className="text-lg font-bold">
          インボイスの経過措置で、会社が負担する消費税
        </h2>
        <p className="mt-1 text-sm text-muted-foreground">
          インボイスの登録が無い方への支払では、仕入の消費税のうち控除できる割合が段階的に下がります。控除できない分は会社の負担になり、上の「会社の利益」から引いています。
        </p>
      </div>

      {!future.affected ? (
        <p className="text-sm">
          会社の設定が「原則課税」ではないため、この負担は計算していません。簡易課税・2割特例は、仕入の消費税ではなく売上の消費税から納める額を出す計算方法です。会社の計算方法が合っているかは、設定の画面と、顧問の税理士さんと確かめてください。
        </p>
      ) : future.people === 0 ? (
        <p className="text-sm">{jpMonth(month)}は、インボイスの登録が無い方への支払はありません。</p>
      ) : (
        <>
          <p className="text-sm">
            {jpMonth(month)}、登録の無い方 <strong>{future.people}人</strong>への支払（委託料 ＋ 消費税相当額）は <Money value={future.base} className="font-bold" /> です。
            そのうち仕入の消費税にあたる額は <Money value={future.creditable} />
            {future.current ? (
              <>
                。今の段階（{future.current.label}）は、その {pct(future.current.deductibleRate)} を控除でき、会社の負担は{split.people > 0 ? "（この段階の割合で 1 か月まるごと数えると）" : ""}{" "}
                <strong className="text-danger">
                  月 <Money value={future.current.monthly} />
                </strong>{" "}
                です。
              </>
            ) : (
              "です。"
            )}
          </p>
          <SplitSection split={split} actual={actual ?? split.total} />
          <div>
            <p className="mb-1 text-sm font-bold">同じ稼働が続いた場合の目安</p>
            <TableWrap>
              <table className="w-full min-w-[30rem] border-collapse text-sm">
                <caption className="sr-only">経過措置の段階ごとの、会社の負担の目安</caption>
                <thead>
                  <tr className="border-b border-border text-xs text-muted-foreground">
                    <th scope="col" className="px-2 py-2 text-left font-normal">
                      期間
                    </th>
                    <th scope="col" className="px-2 py-2 text-right font-normal">
                      控除できる割合
                    </th>
                    <th scope="col" className="px-2 py-2 text-right font-normal">
                      会社の負担（月）
                    </th>
                    <th scope="col" className="px-2 py-2 text-right font-normal">
                      年（月 × 12）
                    </th>
                    <th scope="col" className="px-2 py-2 text-right font-normal">
                      今との差（月）
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {future.steps.map((s) => (
                    <tr key={s.from} className={`border-b border-border ${s.isCurrent ? "bg-muted font-bold" : ""}`}>
                      <th scope="row" className={`whitespace-nowrap px-2 py-2 text-left ${s.isCurrent ? "font-bold" : "font-normal"}`}>
                        {s.label}
                        {s.isCurrent && (
                          <span className="ml-1">
                            <Badge tone="gray">今</Badge>
                          </span>
                        )}
                      </th>
                      <td className="num px-2 py-2 text-right">{pct(s.deductibleRate)}</td>
                      <td className="px-2 py-2 text-right">
                        <Money value={s.monthly} />
                      </td>
                      <td className="px-2 py-2 text-right">
                        <Money value={s.yearly} />
                      </td>
                      <td className="num whitespace-nowrap px-2 py-2 text-right">{s.isCurrent ? "—" : signedYen(s.diffMonthly)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </TableWrap>
            <p className="mt-2 text-xs text-muted-foreground">
              この月の支払が毎月同じだったとしたときの目安です。人数・稼働・登録の有無が変われば、額も変わります。1 人ずつ出して足しています（1 円未満は切り捨て）。
            </p>
          </div>
        </>
      )}

      <ul className="space-y-1 text-sm">
        <li>
          <a href={SOURCES.transitional} target="_blank" rel="noopener noreferrer" className="inline-flex min-h-11 items-center">
            国税庁：インボイス制度の経過措置・2割特例のページ
          </a>
        </li>
        <li>
          <a href={SOURCES.kohyo} target="_blank" rel="noopener noreferrer" className="inline-flex min-h-11 items-center">
            国税庁：適格請求書発行事業者の公表サイト（登録の有無を確かめる）
          </a>
        </li>
        <li>
          <a href={SOURCES.jftcQa} target="_blank" rel="noopener noreferrer" className="inline-flex min-h-11 items-center">
            公正取引委員会：免税事業者との取引についての Q&amp;A
          </a>
        </li>
      </ul>
      <p className="text-xs text-muted-foreground">税金の扱いの最終的な判断は、顧問の税理士さんと確かめてください。</p>
    </Card>
  );
}
