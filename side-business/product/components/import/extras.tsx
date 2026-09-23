import Link from "next/link";
import { Money } from "@/components/ui";
import { ActionForm, type FormAction } from "~/components/import/action-form";
import { Section } from "~/components/import/sections";
import { Badge } from "~/components/page";
import { formatRate, guessText, type RuleGuess } from "~/server/features/import/deductions";
import { formulaText, type DeductionProposal, type MoneyExtras } from "~/server/features/import/proposals";

/**
 * 取り込みの確認の画面：ファイルの金額の列から分かったこと（表示だけ。サーバーで描く）。
 * - 今の Excel の振込額 → 並行運用の比べ合わせに入れる
 * - 控除の列 → 式の提案（採用すると、合意の記録が無いルールとして作る）
 * - 振込手数料の列 → ルールにはせず、知らせるだけ
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
          その月だけの足し引きなら、「稼働と調整」の調整で入れてください（合意の記録と根拠も入れられます）。
        </p>
      )}
    </li>
  );
}

export function MoneyExtrasSection({
  extras,
  canEdit,
  batchId,
  month,
  adopt,
}: {
  extras: MoneyExtras;
  canEdit: boolean;
  batchId: string;
  month: string;
  adopt: FormAction;
}) {
  const tenantRounding = extras.rounding;
  const { payout, fees, proposals } = extras;
  if (!payout && fees.length === 0 && proposals.length === 0) return null;
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
    </Section>
  );
}
