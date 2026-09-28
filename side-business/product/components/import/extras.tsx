import Link from "next/link";
import { Money, TableWrap } from "@/components/ui";
import { AdjustColumnForm } from "~/components/import/adjust-form";
import { ActionForm, type FormAction } from "~/components/import/action-form";
import { Section } from "~/components/import/sections";
import { Badge } from "~/components/page";
import { signedAmount, type AdjustCandidate } from "~/server/features/import/adjust";
import { formatRate, guessText, type RuleGuess } from "~/server/features/import/deductions";
import { formulaText, type DeductionProposal, type MoneyExtras } from "~/server/features/import/proposals";
import { rateKey, type RateFinding } from "~/server/features/import/rates";
import { ADJUST_SIGN_LABEL } from "~/server/features/import/types";

/**
 * 取り込みの確認の画面：ファイルの金額の列から分かったこと（表示だけ。サーバーで描く）。
 * - 今の Excel の振込額 → 並行運用の比べ合わせに入れる
 * - 控除の列 → 式の提案（採用すると、合意の記録が無いルールとして作る）
 * - 振込手数料の列 → ルールにはせず、知らせるだけ
 * - 燃料・高速代・立替・事故の負担・手当の列 → その月の調整として入れる（決まった式にならない額）
 * - 単価・金額の列 → 台帳と違う人の「人ごとの単価」の下書き
 */

const ROUNDING_JA: Record<string, string> = { floor: "切り捨て", round: "四捨五入", ceil: "切り上げ" };

/** 振込手数料の根拠（フリーランス法 第5条の減額・公取委の Q&A と取適法のリーフレット） */
const FEE_SOURCES = [
  { href: "https://www.jftc.go.jp/fllaw_limited/fllaw_qa.html", label: "公正取引委員会 フリーランス法 Q&A" },
  { href: "https://www.jftc.go.jp/file/toriteki_leaflet.pdf", label: "取適法 リーフレット（公正取引委員会）" },
];

function ownText(g: RuleGuess): string {
  if (g.kind === "percent") return formatRate(g.rate);
  if (g.kind === "per_unit") return `${g.rate.toLocaleString("ja-JP", { maximumFractionDigits: 1 })}円/単位`;
  return `${Math.round(g.amount).toLocaleString("ja-JP")}円`;
}

function ProposalCard({ p, canEdit, batchId, adopt, tenantRounding }: { p: DeductionProposal; canEdit: boolean; batchId: string; adopt: FormAction; tenantRounding: string }) {
  const inf = p.inference;
  const exceptions = p.exceptionRules.filter((x) => !x.hasOwnRule);
  return (
    <li className="space-y-2 rounded-lg border border-border p-3 text-sm">
      <div className="flex flex-wrap items-center gap-2">
        <b className="text-base">「{p.header}」の列</b>
        <Badge>{p.categoryLabel}</Badge>
        {inf && (
          <Badge tone={inf.matched.length === inf.total ? "green" : "yellow"}>
            {inf.total}人中{inf.matched.length}人一致
          </Badge>
        )}
      </div>
      {inf ? (
        <>
          <p>
            あなたの Excel は <b>{guessText(inf.guess)}</b> で計算しているようです。合っていますか？
          </p>
          {p.formula &&
            (p.formula.used ? (
              <p className="text-xs text-muted-foreground">
                Excel の数式（<span className="break-all font-mono">{p.formula.sample}</span> など {p.formula.rows} 行）からも、同じ式を読み取りました。
              </p>
            ) : (
              <p className="text-xs text-muted-foreground">
                Excel の数式は <span className="break-all font-mono">{p.formula.sample}</span>（{formulaText(p.formula)}）です。この式を明細の委託料（税抜）に当てると値と合わない人がいるため、値から読み取った式を出しています。
              </p>
            ))}
          {p.perRow && <p className="text-xs text-muted-foreground">行ごとの額を、人ごとに足してから比べました。</p>}
          {inf.outliers.length > 0 && (
            <div className="rounded-lg border border-warning/40 bg-warning/10 p-2">
              <p className="font-bold">この式と合わない人</p>
              <ul className="mt-1 space-y-0.5">
                {inf.outliers.map((o) => (
                  <li key={o.driverId}>
                    {o.name}：Excel は <Money value={o.value} />、式では <Money value={o.expected} />
                    {o.own ? `（この人だけ ${ownText(o.own)} なら合います）` : "（決まった式では説明できません。確かめてください）"}
                  </li>
                ))}
              </ul>
            </div>
          )}
          {inf.roundings.length > 0 && inf.guess.kind !== "fixed" && !(inf.roundings as string[]).includes(tenantRounding) && (
            <p className="text-xs text-warning">
              Excel の端数は{inf.roundings.map((r) => ROUNDING_JA[r]).join("・")}で合っています。今の会社の設定（{ROUNDING_JA[tenantRounding] ?? tenantRounding}）だと、1 円ずれる人がいるかもしれません。会社の設定で確かめてください。
            </p>
          )}
          {p.existing ? (
            p.sameAsExisting ? (
              <>
                <p className="rounded-lg border border-success/40 bg-success/10 p-2 text-success">
                  ✓ 登録済みの控除「{p.existing.name}」と同じ式です。{exceptions.length === 0 ? "新しく作るものはありません。" : ""}
                </p>
                {exceptions.length > 0 && canEdit && (
                  <ActionForm
                    action={adopt}
                    submit="その人だけのルールを作る"
                    pendingText="作っています…"
                    confirm={
                      <>
                        {exceptions.map((x) => `${x.name} ${ownText(x.guess)}`).join("・")} の「{p.existing.name}」を、その人だけのルールとして作ります（ほかの人は今のまま）。書面の合意の記録が無いルールとして作るので、見張り番が知らせます。取引条件の記録に入れて、合意した日を入れてください。
                      </>
                    }
                    confirmSubmit="作る"
                  >
                    <input type="hidden" name="batchId" value={batchId} />
                    <input type="hidden" name="col" value={p.col} />
                    <input type="hidden" name="exceptionsOnly" value="1" />
                  </ActionForm>
                )}
              </>
            ) : (
              <p className="rounded-lg border border-warning/40 bg-warning/10 p-2">
                登録済みの控除「{p.existing.name}」と式が違います。二重に引かないよう、ここでは作りません。
                <Link href="/settings/rules" className="ml-1 inline-block min-h-11 py-2 font-bold">
                  控除のルールで確かめる
                </Link>
              </p>
            )
          ) : canEdit ? (
            <ActionForm
              action={adopt}
              submit="採用する"
              variant="primary"
              pendingText="作っています…"
              confirm={
                <>
                  控除「{p.name}」（{guessText(inf.guess)}）を作ります。書面の合意の記録が無いルールとして作るので、見張り番が「書面で合意した記録が見つかりません」と知らせます。取引条件の記録（明示書）に入れて、ドライバーと合意した日を入れてください。
                </>
              }
              confirmSubmit="作る"
            >
              <input type="hidden" name="batchId" value={batchId} />
              <input type="hidden" name="col" value={p.col} />
              {exceptions.length > 0 && (
                <label className="mb-2 flex min-h-11 items-start gap-3">
                  <input type="checkbox" name="withExceptions" defaultChecked className="mt-1 h-5 w-5 shrink-0" />
                  <span>
                    合わない人のうち、その人だけの式で合う人は、その人だけのルールも作る（{exceptions.map((x) => `${x.name} ${ownText(x.guess)}`).join("・")}）
                  </span>
                </label>
              )}
            </ActionForm>
          ) : null}
        </>
      ) : (
        <p className="text-muted-foreground">
          {p.reason ?? "決まった式が見つかりませんでした"}。
          {p.formula && (
            <>
              Excel の数式は <span className="break-all font-mono">{p.formula.sample}</span>（{formulaText(p.formula)}）ですが、値と合わない人が多いため、式にしませんでした。
            </>
          )}
          人ごとに額が変わるもの（燃料・立替 など）なら、下の「その月の調整として入れる」で、この列の額を人ごとの調整にできます（次の月も同じように入れます）。
        </p>
      )}
    </li>
  );
}

function qtyRate(n: number): string {
  return n.toLocaleString("ja-JP", { maximumFractionDigits: 2 });
}

/** 金額の列を、その月の調整として入れる（決まった式にならない、人ごとに変わる額） */
function AdjustCard({ c, canEdit, batchId, action }: { c: AdjustCandidate; canEdit: boolean; batchId: string; action: FormAction }) {
  const on = c.setting;
  const amounts = c.entries.map((e) => ({ ...e, amount: signedAmount(e.value, on?.sign ?? c.draft.sign) }));
  const total = amounts.reduce((a, e) => a + e.amount, 0);
  return (
    <li className="space-y-2 rounded-lg border border-border p-3 text-sm">
      <div className="flex flex-wrap items-center gap-2">
        <b className="text-base">「{c.header}」の列</b>
        <Badge>{c.kindLabel}</Badge>
        {on ? <Badge tone="green">調整として入れる</Badge> : <Badge tone="gray">入れない</Badge>}
        <span className="text-muted-foreground">{c.entries.length}人</span>
      </div>
      {on ? (
        <p>
          反映するとき、人ごとに「<b>{on.label}</b>」の調整を入れます（{ADJUST_SIGN_LABEL[on.sign]}・{on.taxable ? "消費税の対象" : "消費税の対象外"}・
          {on.agreedInWriting ? "書面の合意あり" : "書面の合意の記録なし"}）。合計 <Money value={total} />。
        </p>
      ) : (
        <p className="text-muted-foreground">
          人ごと・月ごとに額が変わるもの（燃料・高速代・立替・事故の負担・手当 など）は、この列の額を、その月の調整として人ごとに入れられます。
        </p>
      )}
      {c.sameNameRule && (
        <p className="rounded-lg border border-warning/40 bg-warning/10 p-2">
          同じ名前の控除のルール「{c.sameNameRule}」があります。両方あると二重に引くので、どちらか一方にしてください。
        </p>
      )}
      {c.unreadable.length > 0 && (
        <p className="text-xs text-warning">
          数として読めないセルがあります（{c.unreadable.slice(0, 5).join("・")}
          {c.unreadable.length > 5 ? ` ほか ${c.unreadable.length - 5} か所` : ""}）。その人の分は入れません。
        </p>
      )}
      {amounts.length > 0 && (
        <details>
          <summary className="min-h-11 cursor-pointer py-2 font-bold">人ごとの額を見る（{amounts.length}人）</summary>
          <ul className="grid gap-x-4 gap-y-1 sm:grid-cols-2">
            {amounts.map((e) => (
              <li key={e.driverId} className="flex justify-between gap-2">
                <span className="min-w-0 break-all">{e.name}</span>
                <Money value={e.amount} />
              </li>
            ))}
          </ul>
        </details>
      )}
      {canEdit &&
        (on ? (
          <div className="flex flex-wrap gap-2">
            <ActionForm action={action} submit="調整として入れるのをやめる" variant="ghost" pendingText="変えています…">
              <input type="hidden" name="batchId" value={batchId} />
              <input type="hidden" name="col" value={c.col} />
              <input type="hidden" name="enabled" value="0" />
            </ActionForm>
            <details className="w-full">
              <summary className="min-h-11 cursor-pointer py-2 font-bold">名前・向き・消費税を変える</summary>
              <AdjustColumnForm action={action} batchId={batchId} col={c.col} initial={on} mixedSigns={c.mixedSigns} />
            </details>
          </div>
        ) : (
          <details>
            <summary className="min-h-11 cursor-pointer py-2 font-bold">その月の調整として入れる</summary>
            <AdjustColumnForm
              action={action}
              batchId={batchId}
              col={c.col}
              initial={{ ...c.draft, agreedInWriting: false, basis: null }}
              mixedSigns={c.mixedSigns}
            />
          </details>
        ))}
    </li>
  );
}

/** 単価・金額の列から読んだ、人ごとの単価 */
function RatesCard({ f, canEdit, batchId, action }: { f: RateFinding; canEdit: boolean; batchId: string; action: FormAction }) {
  return (
    <li className="space-y-2 rounded-lg border border-border p-3 text-sm">
      <div className="flex flex-wrap items-center gap-2">
        <b className="text-base">「{f.header}」の列</b>
        <Badge>{f.kind === "rate" ? "単価" : "金額 ÷ 数量"}</Badge>
        {f.matched > 0 && <Badge tone="green">台帳と同じ {f.matched}件</Badge>}
        {f.proposals.length > 0 && <Badge tone="yellow">台帳と違う {f.proposals.length}件</Badge>}
      </div>
      {f.billLike ? (
        <p className="text-muted-foreground">元請からの単価（受注単価）と同じ値が多いので、ドライバーへの支払の単価ではないとみなしました。</p>
      ) : f.proposals.length > 0 ? (
        <>
          <p>
            Excel の単価が、台帳の単価（人ごとの単価、無ければ案件の支払単価）と違う人がいます。人ごとの単価として登録すると、明細はその単価 × 数量で計算します。
          </p>
          {canEdit ? (
            <ActionForm
              action={action}
              submit="選んだ人の単価を登録する"
              variant="primary"
              pendingText="登録しています…"
              confirm="選んだ人の単価を、人ごとの単価として登録します（すでにあれば上書き）。合意した日は空のままなので、取引条件の記録に入れて、合意した日を入れてください。"
              confirmSubmit="登録する"
            >
              <input type="hidden" name="batchId" value={batchId} />
              <input type="hidden" name="col" value={f.col} />
              <RateTable f={f} selectable />
            </ActionForm>
          ) : (
            <RateTable f={f} selectable={false} />
          )}
        </>
      ) : (
        f.matched > 0 && <p className="text-success">✓ すべて台帳の単価と同じです。</p>
      )}
      {f.varying.length > 0 && (
        <div className="rounded-lg border border-warning/40 bg-warning/10 p-2">
          <p className="font-bold">同じ人・同じ案件で、行ごとに単価が違う人がいます</p>
          <ul className="mt-1 space-y-0.5">
            {f.varying.slice(0, 10).map((v) => (
              <li key={`${v.driverName}|${v.projectName}`}>
                {v.driverName}・{v.projectName}：{v.rates.map(qtyRate).join("・")}円
              </li>
            ))}
          </ul>
          <p className="mt-1">
            段階制・最低保証・日額と歩合の組み合わせなどは、今の計算（単価 × 数量）では表せません。差は「稼働と調整」の調整で入れるか、導入のときにご相談ください。
          </p>
        </div>
      )}
    </li>
  );
}

function RateTable({ f, selectable }: { f: RateFinding; selectable: boolean }) {
  return (
    <TableWrap>
      <table className="mb-3 w-full min-w-[22rem] text-sm">
        <thead>
          <tr className="border-b border-border text-left text-muted-foreground">
            {selectable && <th className="py-2 pr-2 font-normal">登録</th>}
            <th className="py-2 pr-2 font-normal">人・案件</th>
            <th className="py-2 pr-2 text-right font-normal">台帳</th>
            <th className="py-2 text-right font-normal">Excel</th>
          </tr>
        </thead>
        <tbody>
          {f.proposals.map((p) => (
            <tr key={rateKey(p)} className="border-b border-border">
              {selectable && (
                <td className="py-1 pr-2">
                  <input type="checkbox" name="key" value={rateKey(p)} defaultChecked aria-label={`${p.driverName}・${p.projectName}`} className="h-5 w-5" />
                </td>
              )}
              <td className="py-1 pr-2">
                {p.driverName}・{p.projectName}
                {p.hasOverride && <span className="ml-1 text-xs text-muted-foreground">（人ごとの単価あり）</span>}
              </td>
              <td className="num py-1 pr-2 text-right">{qtyRate(p.current)}円</td>
              <td className="num py-1 text-right font-bold">{qtyRate(p.rate)}円</td>
            </tr>
          ))}
        </tbody>
      </table>
    </TableWrap>
  );
}

export function MoneyExtrasSection({
  extras,
  canEdit,
  batchId,
  month,
  adopt,
  adjustAction,
  ratesAction,
}: {
  extras: MoneyExtras;
  canEdit: boolean;
  batchId: string;
  month: string;
  adopt: FormAction;
  adjustAction: FormAction;
  ratesAction: FormAction;
}) {
  const tenantRounding = extras.rounding;
  const { payout, fees, proposals, adjust, rates } = extras;
  if (!payout && fees.length === 0 && proposals.length === 0 && adjust.length === 0 && rates.length === 0) return null;
  return (
    <Section title="金額の列から分かったこと">
      {payout &&
        (payout.entries.length > 0 ? (
          <p className="rounded-lg border border-success/40 bg-success/10 p-3 text-sm">
            <b>「{payout.header}」の列を、今の Excel の振込額として読みました（{payout.entries.length}人）。</b>
            反映すると「Excel と比べる」の画面に入れます（理由のメモが付いている人は上書きしません）。しめ日ラボの振込額と 1 円まで比べられます。
          </p>
        ) : (
          <p className="text-sm text-muted-foreground">
            「{payout.header}」の列は、同じ人の行で額が違うので、振込額（人ごとの額）とはみなしませんでした。
          </p>
        ))}
      {fees.map((f) => (
        <div key={f.col} className="rounded-lg border border-danger/40 bg-danger/10 p-3 text-sm">
          <p className="font-bold text-danger">振込手数料の列があります。ドライバーの負担にすると減額にあたるおそれがあります</p>
          <p className="mt-1">
            「{f.header}」の列は、控除のルールにはしません。振込手数料をドライバーに負担してもらっているなら、取り扱いを確かめることをおすすめします（フリーランス法 第5条）。判断は、会社と専門家（弁護士など）で行ってください。
          </p>
          <ul className="mt-1 space-y-0.5">
            {FEE_SOURCES.map((s) => (
              <li key={s.href}>
                <a href={s.href} target="_blank" rel="noreferrer" className="inline-block min-h-11 py-2">
                  {s.label}
                </a>
              </li>
            ))}
          </ul>
        </div>
      ))}
      {proposals.length > 0 && (
        <div className="space-y-2">
          <h3 className="text-sm font-bold">控除の提案（Excel の計算から読み取った式）</h3>
          <p className="text-sm text-muted-foreground">
            率の元にした委託料：{extras.base.from === "column" ? `ファイルの「${extras.base.header}」の列` : "明細と同じ計算（数量 × 支払単価）"}。
            採用すると、合意の記録が無いルールとして作ります。
            <Link href={`/terms?m=${month}`} className="ml-1 inline-block min-h-11 py-2">
              取引条件の記録へ
            </Link>
          </p>
          <ul className="space-y-2">
            {proposals.map((p) => (
              <ProposalCard key={p.col} p={p} canEdit={canEdit} batchId={batchId} adopt={adopt} tenantRounding={tenantRounding} />
            ))}
          </ul>
        </div>
      )}
      {adjust.length > 0 && (
        <div className="space-y-2">
          <h3 className="text-sm font-bold">その月の調整として入れる（人ごとに変わる額）</h3>
          <p className="text-sm text-muted-foreground">
            1 件ずつ打ち直さなくても、この列の額を人ごとの調整にできます。決めた入れ方は覚えるので、来月は置いて反映するだけです。
          </p>
          <ul className="space-y-2">
            {adjust.map((c) => (
              <AdjustCard key={c.col} c={c} canEdit={canEdit} batchId={batchId} action={adjustAction} />
            ))}
          </ul>
        </div>
      )}
      {rates.length > 0 && (
        <div className="space-y-2">
          <h3 className="text-sm font-bold">単価の列から分かったこと（人ごとの単価）</h3>
          <ul className="space-y-2">
            {rates.map((f) => (
              <RatesCard key={f.col} f={f} canEdit={canEdit} batchId={batchId} action={ratesAction} />
            ))}
          </ul>
        </div>
      )}
    </Section>
  );
}
