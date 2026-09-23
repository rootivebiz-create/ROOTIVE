/**
 * /tools/payout の計算の結果。数字はすべて buildPayout の結果をそのまま出す（ここで計算し直さない）。
 * 振込額の内訳・源泉徴収（元・段階・式）・インボイスの負担（役務の提供を受けた日の割合）・注意・計算の順序・算定方法の文。
 */
import Link from "next/link";
import { useState, type ReactNode } from "react";
import { Button, Card, Money, TableWrap, buttonClass } from "@/components/ui";
import type { IndustryPreset } from "@/lib/engine/presets";
import type { PayoutInput, PayoutResult } from "@/lib/engine/statement";
import { DEFAULT_CONSUMPTION_TAX_RATE, bpText, en, num, percent, type EngineWarning, type WarningLevel } from "@/lib/engine/types";
import { BASE_RULE_LABELS, WITHHOLDING_CATEGORIES, withholdingRateFor } from "@/lib/engine/withholding";
import { jpDate, jpMonth } from "@/lib/tools/invoice-cost";
import { ORDER_SIDE_METHODS, burdenRows, isMonth, methodText, monthText, summaryTaxRows } from "./state";

const cx = (...c: (string | false | null | undefined)[]) => c.filter(Boolean).join(" ");

const BASE_RULE_SHORT: Record<PayoutResult["withholdingRule"], string> = {
  excl_tax_separated: "税抜",
  incl_tax: "税込",
  no_tax_added: "支払う報酬の額",
};

const LEVEL_BADGE: Record<WarningLevel | "input", { label: string; className: string }> = {
  input: { label: "入力", className: "bg-danger text-card" },
  warning: { label: "要注意", className: "bg-danger text-card" },
  caution: { label: "確認", className: "bg-warning text-card" },
  info: { label: "参考", className: "bg-muted text-foreground" },
};

const LEVEL_ORDER: WarningLevel[] = ["warning", "caution", "info"];

export function PayoutResultView({
  input,
  result,
  errors,
  preset,
  serviceMonth,
}: {
  input: PayoutInput;
  result: PayoutResult;
  errors: string[];
  preset: IndustryPreset;
  serviceMonth: string;
}) {
  return (
    <div className="space-y-4">
      <SummaryCard input={input} result={result} serviceMonth={serviceMonth} payeeWord={preset.terms.payee} />
      <WithholdingCard input={input} result={result} />
      <BurdenCard input={input} result={result} />
      <WarningsCard errors={errors} warnings={result.warnings} notes={result.notes} />
      <Card>
        <h3 className="font-bold">計算の順序</h3>
        <ol className="mt-2 space-y-2 text-sm">
          {result.explanation.map((step, i) => (
            <li key={i} className="num leading-relaxed [overflow-wrap:anywhere]">
              {step}
            </li>
          ))}
        </ol>
      </Card>
      <MethodCard text={methodText(input, result)} preset={preset} />
      {preset.cautions.length > 0 && (
        <Card>
          <h3 className="font-bold">{preset.shortLabel}で気をつけること</h3>
          <ul className="mt-2 list-disc space-y-1 pl-5 text-sm leading-relaxed">
            {preset.cautions.map((c) => (
              <li key={c}>{c}</li>
            ))}
          </ul>
        </Card>
      )}
    </div>
  );
}

/* ───────────── 振込額と内訳 ───────────── */

function Row({
  label,
  note,
  value,
  minus,
  strong,
}: {
  label: string;
  note?: ReactNode;
  value: number;
  minus?: boolean;
  strong?: boolean;
}) {
  return (
    <div className={cx("py-2", strong && "font-bold")}>
      <div className="flex items-baseline justify-between gap-3">
        <dt>{label}</dt>
        <dd className={cx("whitespace-nowrap text-right", strong && "text-lg")}>
          {minus && value > 0 && <span className="num">−</span>}
          <Money value={value} />
        </dd>
      </div>
      {note && <p className="mt-0.5 text-xs font-normal text-muted-foreground [overflow-wrap:anywhere]">{note}</p>}
    </div>
  );
}

function SummaryCard({
  input,
  result,
  serviceMonth,
  payeeWord,
}: {
  input: PayoutInput;
  result: PayoutResult;
  serviceMonth: string;
  payeeWord: string;
}) {
  const { payee } = input;
  const taxRows = summaryTaxRows(input, result);
  const hasSettlement = result.lines.some((l) => !l.taxable);
  const kind = `${payee.invoiceRegistered ? "インボイス登録あり" : "登録なし"}・${payee.isCorporation ? "法人" : "個人"}`;
  return (
    <Card className="border-2 border-foreground">
      <p className="text-sm text-muted-foreground [overflow-wrap:anywhere]">
        {payee.name}（{payeeWord}・{kind}）
        {isMonth(serviceMonth) && <>・{monthText(serviceMonth)}分</>}
      </p>
      <p className="mt-2 text-sm font-bold">振込額</p>
      <p className="text-3xl font-bold">
        <Money value={result.payout} />
      </p>
      <dl className="mt-3 divide-y divide-border border-t border-border text-sm">
        <Row label={taxRows.feeLabel} value={result.subtotal} note={taxRows.feeNote} />
        <Row label={taxRows.taxLabel} value={result.tax} note={taxRows.taxNote} />
        {hasSettlement && <Row label="精算（報酬ではない）" value={result.settlementsTotal} />}
        {result.reimbursementsPaid > 0 && <Row label="立替（報酬と一緒に払う）" value={result.reimbursementsPaid} />}
        <Row
          label="源泉徴収税額"
          value={result.withholding}
          minus
          note={
            result.withholding > 0
              ? `元 ${en(result.withholdingBase)}（${BASE_RULE_SHORT[result.withholdingRule]}）。くわしくは下の「源泉徴収」`
              : undefined
          }
        />
        <Row label="控除" value={result.deductionsTotal} minus note={result.deductionsTotal > 0 ? "源泉の元は減らさない" : undefined} />
        <Row label="振込額" value={result.payout} strong />
      </dl>
      {result.reimbursementsDirect > 0 && (
        <p className="mt-2 text-xs text-muted-foreground">
          発注者が直接払った立替 {en(result.reimbursementsDirect)} は、振込額にも源泉の元にも入れていません（参考）。
        </p>
      )}
    </Card>
  );
}

/* ───────────── 源泉徴収 ───────────── */

function WithholdingCard({ input, result }: { input: PayoutInput; result: PayoutResult }) {
  const groups = result.withholdingGroups;
  const rate = withholdingRateFor(input.paymentTerms?.payOn ?? input.serviceDate);
  return (
    <Card>
      <div className="flex items-baseline justify-between gap-3">
        <h3 className="font-bold">源泉徴収</h3>
        <Money value={result.withholding} className="text-lg font-bold" />
      </div>
      {groups.length === 0 ? (
        <p className="mt-2 text-sm">源泉徴収の区分を付けた行がないので、源泉徴収はしません。</p>
      ) : input.payee.isCorporation ? (
        <p className="mt-2 text-sm">支払先が法人なので、源泉徴収はしません（ここで扱うのは個人に払う報酬の源泉徴収です）。</p>
      ) : (
        <>
          <p className="mt-2 text-sm">
            <span className="font-bold">源泉の元：</span>
            {BASE_RULE_LABELS[result.withholdingRule]}
          </p>
          <p className="mt-1 text-xs text-muted-foreground">
            {groups.some((g) => WITHHOLDING_CATEGORIES[g.category].method === "two_tier")
              ? `${num(rate.stepThreshold / 10_000)}万円の段階は、同じ人への1回の支払で、区分が同じ行の合計に当てます（年の合計にはかけません）。`
              : "同じ人への1回の支払で、区分が同じ行を合計してから計算します。"}
            1円未満は切り捨てです。
          </p>
          <ul className="mt-3 space-y-3">
            {groups.map((g) => (
              <li key={g.category} className="rounded-lg border border-border p-3">
                <p className="text-sm font-bold">{WITHHOLDING_CATEGORIES[g.category].label}</p>
                <dl className="mt-1 text-sm">
                  <div className="flex items-baseline justify-between gap-3">
                    <dt>元</dt>
                    <dd className="text-right">
                      <Money value={g.base} />
                      {g.taxIncluded > 0 && (
                        <span className="block text-xs text-muted-foreground">うち消費税 {en(g.taxIncluded)}（税込の額にかけるため）</span>
                      )}
                    </dd>
                  </div>
                  {g.deduction > 0 && (
                    <div className="flex items-baseline justify-between gap-3">
                      <dt>控除額</dt>
                      <dd>
                        <span className="num">−</span>
                        <Money value={g.deduction} />
                      </dd>
                    </div>
                  )}
                </dl>
                {g.steps.length > 0 && (
                  <TableWrap>
                    <table className="mt-2 w-full border-collapse text-sm">
                      <thead>
                        <tr className="border-b border-border text-xs text-muted-foreground">
                          <th scope="col" className="py-1.5 pr-3 text-left font-normal">
                            段階
                          </th>
                          <th scope="col" className="px-2 py-1.5 text-right font-normal">
                            かかる額
                          </th>
                          <th scope="col" className="py-1.5 pl-2 text-right font-normal">
                            税額
                          </th>
                        </tr>
                      </thead>
                      <tbody>
                        {g.steps.map((s) => (
                          <tr key={s.label} className="border-b border-border last:border-0">
                            <th scope="row" className="py-1.5 pr-3 text-left font-normal">
                              {s.label}
                            </th>
                            <td className="px-2 py-1.5 text-right">
                              <Money value={s.amount} />
                            </td>
                            <td className="py-1.5 pl-2 text-right">
                              <Money value={s.tax} />
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </TableWrap>
                )}
                <p className="num mt-2 rounded bg-muted p-2 text-xs leading-relaxed [overflow-wrap:anywhere]">{g.formulaText}</p>
                {WITHHOLDING_CATEGORIES[g.category].paymentReportOver !== null && (
                  <p className="mt-2 text-xs text-muted-foreground">
                    同じ人への年の支払の合計が {en(WITHHOLDING_CATEGORIES[g.category].paymentReportOver ?? 0)} を超えたら、支払調書（翌年1月31日まで）の対象です。
                  </p>
                )}
              </li>
            ))}
          </ul>
          {result.withholding > 0 && (
            <p className="mt-3 text-sm">
              <span className="font-bold">納付：</span>
              {result.withholdingDue
                ? `${jpDate(result.withholdingDue)}まで（支払った月の翌月10日。土日祝日なら翌営業日）`
                : "支払った月の翌月10日まで（支払日を入れると日付を出します）"}
            </p>
          )}
          <p className="mt-2 text-xs text-muted-foreground">
            使った率（{bpText(rate.basicBp)}）の根拠：{rate.note}
            {rate.status === "expected" && "。この率は見込みで、確定ではありません"}
          </p>
        </>
      )}
    </Card>
  );
}

/* ───────────── インボイスの負担 ───────────── */

function BurdenCard({ input, result }: { input: PayoutInput; result: PayoutResult }) {
  const { payee } = input;
  const method = ORDER_SIDE_METHODS.find((m) => m.value === input.orderSideTaxMethod);
  const month = input.serviceDate.slice(0, 7);
  if (payee.invoiceRegistered) {
    return (
      <Card>
        <h3 className="font-bold">インボイスの負担（発注する側が控除できない消費税）</h3>
        <p className="mt-2 text-sm">
          インボイス登録をしている方への支払なので、経過措置による「控除できない負担」は出ません。
        </p>
      </Card>
    );
  }
  if (result.subtotal <= 0) {
    return (
      <Card>
        <h3 className="font-bold">インボイスの負担（発注する側が控除できない消費税）</h3>
        <p className="mt-2 text-sm">報酬が0円なので、負担はありません。</p>
      </Card>
    );
  }
  const rows = burdenRows(input);
  const general = input.orderSideTaxMethod === "general";
  const paid = result.subtotal + result.tax;
  const pctTax = Math.round((input.taxRate ?? DEFAULT_CONSUMPTION_TAX_RATE) * 100);
  return (
    <Card>
      <div className="flex items-baseline justify-between gap-3">
        <h3 className="font-bold">インボイスの負担（発注する側が控除できない消費税）</h3>
        <Money value={result.invoiceBurden} className="text-lg font-bold" />
      </div>
      {general ? (
        <p className="mt-2 text-sm">
          役務の提供を受けた月（{monthText(month)}）の経過措置で、控除できるのは <span className="font-bold">{percent(result.deductibleRate)}</span>
          。支払う {en(paid)} に含まれる消費税相当額（× {pctTax}/{100 + pctTax}）のうち、残りの {percent(1 - result.deductibleRate)} が負担です（1円未満切り捨て）。
        </p>
      ) : (
        <p className="mt-2 text-sm">
          発注する側が{method?.label ?? "原則課税以外"}なので、この負担は出ません（0円）。下の表は、原則課税だった場合の参考です。
        </p>
      )}
      {rows.length > 0 && (
        <TableWrap>
          <table className="mt-3 w-full border-collapse text-sm">
            <thead>
              <tr className="border-b border-border text-xs text-muted-foreground">
                <th scope="col" className="py-1.5 pr-3 text-left font-normal">
                  役務の提供を受けた日
                </th>
                <th scope="col" className="px-2 py-1.5 text-right font-normal">
                  控除できる割合
                </th>
                <th scope="col" className="py-1.5 pl-2 text-right font-normal">
                  {general ? "負担" : "負担（参考）"}
                </th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.from} className={cx("border-b border-border last:border-0", r.current && "bg-accent/20 font-bold")}>
                  <th scope="row" className={cx("py-2 pr-3 text-left", !r.current && "font-normal")}>
                    <span className="whitespace-nowrap">{jpMonth(r.from)}〜</span>
                    <wbr />
                    {r.to && <span className="whitespace-nowrap">{jpMonth(r.to)}</span>}
                    {r.current && (
                      <span className="ml-1 rounded bg-accent px-1.5 py-0.5 text-xs font-bold text-accent-foreground">この月</span>
                    )}
                  </th>
                  <td className="num px-2 py-2 text-right">{percent(r.rate)}</td>
                  <td className="py-2 pl-2 text-right">
                    <Money value={r.burden} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </TableWrap>
      )}
      <p className="mt-3 text-xs text-muted-foreground">
        割合は、請求書の日付や支払日ではなく、役務の提供を受けた日（課税仕入れの日）で決まります。
        この負担を理由に報酬や消費税相当額を一方的に下げると、フリーランス法の減額・買いたたきなどの問題になりえます。見直すときは相手と協議してください。
      </p>
      <p className="mt-2 text-xs">
        <Link href="/tools/invoice-cost" className="inline-flex min-h-11 items-center">
          経過措置の期間ごとの負担を見る（インボイスの負担の計算）
        </Link>
      </p>
    </Card>
  );
}

/* ───────────── 注意 ───────────── */

function Badge({ kind }: { kind: WarningLevel | "input" }) {
  const b = LEVEL_BADGE[kind];
  return <span className={cx("mr-2 inline-block rounded px-1.5 py-0.5 text-xs font-bold", b.className)}>{b.label}</span>;
}

function WarningsCard({ errors, warnings, notes }: { errors: string[]; warnings: EngineWarning[]; notes: string[] }) {
  const sorted = [...warnings].sort((a, b) => LEVEL_ORDER.indexOf(a.level) - LEVEL_ORDER.indexOf(b.level));
  const count = errors.length + warnings.length;
  return (
    <Card className={cx(count > 0 && "border-2 border-warning")}>
      <h3 className="font-bold">注意{count > 0 ? `（${count}件）` : ""}</h3>
      {count === 0 ? (
        <p className="mt-2 text-sm">この入力で出す注意はありません。</p>
      ) : (
        <ul className="mt-2 space-y-2 text-sm leading-relaxed">
          {errors.map((e) => (
            <li key={`input-${e}`}>
              <Badge kind="input" />
              {e}
            </li>
          ))}
          {sorted.map((w, i) => (
            <li key={`${w.code}-${w.source ?? ""}-${i}`}>
              <Badge kind={w.level} />
              {w.source && <span className="font-bold">{w.source}：</span>}
              {w.message}
            </li>
          ))}
        </ul>
      )}
      {notes.length > 0 && (
        <ul className="mt-3 space-y-1 border-t border-border pt-3 text-xs text-muted-foreground">
          {notes.map((n) => (
            <li key={n}>{n}</li>
          ))}
        </ul>
      )}
      <p className="mt-3 text-xs text-muted-foreground">
        この道具は、労働者性・偽装請負や、設定が適法かどうかを判定しません。税務の個別の判断もしません（源泉の区分の最終判断は税理士へ）。
      </p>
    </Card>
  );
}

/* ───────────── 算定方法の文 ───────────── */

function MethodCard({ text, preset }: { text: string; preset: IndustryPreset }) {
  const [copied, setCopied] = useState<{ text: string; ok: boolean } | null>(null);
  async function copy() {
    try {
      await navigator.clipboard.writeText(text);
      setCopied({ text, ok: true });
    } catch {
      setCopied({ text, ok: false });
    }
  }
  const message =
    copied && copied.text === text ? (copied.ok ? "コピーしました" : "コピーできませんでした。文章を長押しして選んでください") : "";
  return (
    <Card>
      <h3 className="font-bold">取引条件明示書に書ける「算定方法」</h3>
      <p className="mt-1 text-xs text-muted-foreground">
        金額を前もって決められない報酬（歩合・精算幅など）は、算定方法で示せます。今月の数字は入れず、式と率だけにしています。相手と確かめてから使ってください。
      </p>
      {text ? (
        <pre className="mt-3 whitespace-pre-wrap rounded-lg bg-muted p-3 font-sans text-sm leading-relaxed [overflow-wrap:anywhere]">{text}</pre>
      ) : (
        <p className="mt-3 text-sm text-muted-foreground">行を入れると、ここに文が出ます。</p>
      )}
      <div className="mt-3 flex flex-col gap-2 sm:flex-row">
        <Button type="button" onClick={copy} disabled={!text}>
          文をコピー
        </Button>
        <Link href="/tools/torihiki-joken" className={buttonClass("secondary")}>
          取引条件明示書のひな形を開く（軽貨物版）
        </Link>
      </div>
      <p aria-live="polite" className="mt-2 min-h-6 text-sm">
        {message}
      </p>
      {preset.disclosureExtras.length > 0 && (
        <div className="mt-2 border-t border-border pt-3">
          <p className="text-sm font-bold">{preset.shortLabel}で明示書に足すとよい項目</p>
          <ul className="mt-1 list-disc space-y-1 pl-5 text-sm">
            {preset.disclosureExtras.map((x) => (
              <li key={x}>{x}</li>
            ))}
          </ul>
        </div>
      )}
    </Card>
  );
}
