"use client";

/**
 * 計算ツール：免税（インボイス未登録）のドライバーへの支払で、会社が負担する消費税。
 * 入れた金額はこの画面の中だけで計算し、どこにも送らない。
 */
import { useId, useState, useSyncExternalStore } from "react";
import { Button, Card, Field, Money, NumberInput, TableWrap } from "@/components/ui";
import { pct, yen } from "@/lib/payroll/money";
import {
  calcInvoiceCost,
  groupDigits,
  jpDate,
  jpMonth,
  readAmount,
  shareText,
  toDateString,
  totalFromHeadcount,
  type InvoiceCostResult,
  type InvoiceCostRow,
  type TaxMethod,
} from "@/lib/tools/invoice-cost";

const cx = (...c: (string | false | null | undefined)[]) => c.filter(Boolean).join(" ");

// 「今日」と共有ボタンの有無は端末でしか分からない。サーバーの HTML では null / false にして、表示のあとで入れかえる
const noSubscribe = () => () => {};
const clientToday = () => toDateString(new Date());
const serverToday = () => null;
const clientCanShare = () => typeof navigator !== "undefined" && typeof navigator.share === "function";
const serverCanShare = () => false;
/** 今日が分かるまでの仮の日付（この日付で出した「今」は画面に出さない） */
const PLACEHOLDER_DATE = "2026-09-01";

const METHODS: { value: TaxMethod; label: string; note: string }[] = [
  { value: "general", label: "原則課税", note: "仕入れの消費税を、実際の額で差し引く" },
  { value: "simplified", label: "簡易課税・2割特例", note: "売上の消費税をもとに、決まった割合で計算する" },
];

export function InvoiceCostCalculator() {
  const today = useSyncExternalStore(noSubscribe, clientToday, serverToday);
  const canShare = useSyncExternalStore(noSubscribe, clientCanShare, serverCanShare);
  const ready = today !== null;

  const [amountText, setAmountText] = useState("1,100,000");
  const [countText, setCountText] = useState("5");
  const [perPersonText, setPerPersonText] = useState("220,000");
  const [method, setMethod] = useState<TaxMethod>("general");
  const [copied, setCopied] = useState<{ text: string; ok: boolean } | null>(null);

  const amountId = useId();
  const hintId = useId();
  const errorId = useId();
  const radioName = useId();

  const amount = readAmount(amountText);
  const helperTotal = totalFromHeadcount(countText, perPersonText);
  const date = today ?? PLACEHOLDER_DATE;
  const result =
    amount.value === null ? null : calcInvoiceCost({ monthlyPaidInclTax: amount.value, taxMethod: method, today: date });
  const ifGeneral =
    amount.value === null || method === "general"
      ? null
      : calcInvoiceCost({ monthlyPaidInclTax: amount.value, taxMethod: "general", today: date });
  const summary = result && ready ? shareText(result) : null;

  function updateHelper(nextCount: string, nextPerPerson: string) {
    setCountText(nextCount);
    setPerPersonText(nextPerPerson);
    const total = totalFromHeadcount(nextCount, nextPerPerson);
    if (total !== null) setAmountText(groupDigits(total));
  }

  async function copySummary() {
    if (!summary) return;
    try {
      await navigator.clipboard.writeText(`${summary}\n${window.location.origin}${window.location.pathname}`);
      setCopied({ text: summary, ok: true });
    } catch {
      setCopied({ text: summary, ok: false });
    }
  }

  async function shareSummary() {
    if (!summary) return;
    try {
      await navigator.share({ title: document.title, text: summary, url: `${window.location.origin}${window.location.pathname}` });
    } catch {
      // 閉じただけ（AbortError）など。何もしない
    }
  }

  const copyMessage =
    copied && copied.text === summary
      ? copied.ok
        ? "コピーしました"
        : "コピーできませんでした。文章を長押しして選んでください"
      : "";

  return (
    <div className="space-y-4">
      <Card>
        <h2 className="text-lg font-bold">金額を入れる</h2>
        <div className="mt-3 space-y-5">
          <div>
            <label htmlFor={amountId} className="block text-sm font-bold">
              免税（未登録）の方への月の支払（税込）
            </label>
            <div className="relative mt-1">
              <NumberInput
                id={amountId}
                value={amountText}
                onChange={(e) => setAmountText(e.target.value)}
                onBlur={() => {
                  if (amount.value !== null) setAmountText(groupDigits(amount.value));
                }}
                enterKeyHint="done"
                aria-invalid={amount.error ? true : undefined}
                aria-describedby={amount.error ? `${hintId} ${errorId}` : hintId}
                className="pr-10 text-lg font-bold"
              />
              <span className="pointer-events-none absolute inset-y-0 right-3 flex items-center text-sm text-muted-foreground">
                円
              </span>
            </div>
            <p id={hintId} className="mt-1 text-xs text-muted-foreground">
              インボイス登録をしていないドライバー全員の、1か月の支払の合計です。例として110万円を入れています。「110万」や全角でも入れられます。
            </p>
            {amount.error && (
              <p id={errorId} role="alert" className="mt-1 text-sm font-bold text-danger">
                {amount.error}
              </p>
            )}
          </div>

          <details className="group rounded-lg border border-border">
            <summary className="flex min-h-11 cursor-pointer list-none items-center justify-between gap-2 px-3 text-sm font-bold [&::-webkit-details-marker]:hidden">
              人数 × 1人あたりで出す
              <span aria-hidden className="text-lg leading-none text-muted-foreground transition group-open:rotate-45">
                ＋
              </span>
            </summary>
            <div className="grid grid-cols-[minmax(0,2fr)_minmax(0,3fr)] items-end gap-3 px-3 pb-3">
              <Field label="人数">
                <span className="relative block">
                  <NumberInput
                    inputMode="numeric"
                    value={countText}
                    onChange={(e) => updateHelper(e.target.value, perPersonText)}
                    className="pr-9"
                  />
                  <span className="pointer-events-none absolute inset-y-0 right-3 flex items-center text-sm text-muted-foreground">
                    人
                  </span>
                </span>
              </Field>
              <Field label="1人あたりの月の支払（税込）">
                <span className="relative block">
                  <NumberInput
                    value={perPersonText}
                    onChange={(e) => updateHelper(countText, e.target.value)}
                    onBlur={() => {
                      const v = readAmount(perPersonText).value;
                      if (v !== null) setPerPersonText(groupDigits(v));
                    }}
                    className="pr-9"
                  />
                  <span className="pointer-events-none absolute inset-y-0 right-3 flex items-center text-sm text-muted-foreground">
                    円
                  </span>
                </span>
              </Field>
            </div>
            <div className="flex flex-wrap items-center gap-x-3 gap-y-2 px-3 pb-3 text-sm">
              {helperTotal === null ? (
                <span className="text-muted-foreground">人数と金額を入れると、合計を上の欄に入れます。</span>
              ) : (
                <>
                  <span>
                    合計 <Money value={helperTotal} className="font-bold" />
                  </span>
                  {amount.value === helperTotal ? (
                    <span className="text-muted-foreground">上の欄に入っています</span>
                  ) : (
                    <Button type="button" variant="secondary" onClick={() => setAmountText(groupDigits(helperTotal))}>
                      上の欄に入れる
                    </Button>
                  )}
                </>
              )}
            </div>
          </details>

          <fieldset>
            <legend className="text-sm font-bold">会社の消費税の計算方法</legend>
            <div className="mt-1 grid gap-2 sm:grid-cols-2">
              {METHODS.map((m) => (
                <label
                  key={m.value}
                  className="flex min-h-11 cursor-pointer items-start gap-3 rounded-lg border border-border bg-card p-3 has-checked:border-foreground has-checked:ring-1 has-checked:ring-foreground"
                >
                  <input
                    type="radio"
                    name={radioName}
                    value={m.value}
                    checked={method === m.value}
                    onChange={() => setMethod(m.value)}
                    className="mt-1 size-5 shrink-0 accent-primary"
                  />
                  <span>
                    <span className="block font-bold">{m.label}</span>
                    <span className="block text-xs text-muted-foreground">{m.note}</span>
                  </span>
                </label>
              ))}
            </div>
            <p className="mt-2 text-xs text-muted-foreground">
              負担が増えるのは原則課税の会社だけです。どちらか分からなければ、顧問の税理士に「うちは原則課税ですか」と聞いてください。
            </p>
          </fieldset>
        </div>
      </Card>

      <section aria-label="計算の結果" className="space-y-4">
        {result === null ? (
          <Card>
            <p className="text-muted-foreground">月の支払を入れると、ここに結果が出ます。</p>
          </Card>
        ) : !ready ? (
          <Card className="min-h-40">
            <p className="text-muted-foreground">計算しています…</p>
          </Card>
        ) : result.affected ? (
          <CurrentCard result={result} />
        ) : (
          <SimplifiedCard reference={ifGeneral} />
        )}

        {result && <PeriodsTable result={result} ready={ready} />}

        {summary && (
          <Card>
            <h2 className="font-bold">この結果を共有する</h2>
            <p className="mt-2 rounded-lg bg-muted p-3 text-sm leading-relaxed">{summary}</p>
            <div className="mt-3 flex flex-wrap gap-2">
              <Button type="button" onClick={copySummary}>
                文章をコピー
              </Button>
              {canShare && (
                <Button type="button" variant="secondary" onClick={shareSummary}>
                  共有する
                </Button>
              )}
            </div>
            <p aria-live="polite" className="mt-2 min-h-6 text-sm">
              {copyMessage}
            </p>
          </Card>
        )}
      </section>
    </div>
  );
}

function CurrentCard({ result }: { result: InvoiceCostResult }) {
  const { current, next, daysUntilNext } = result;
  if (!current) {
    return (
      <Card>
        <p className="text-muted-foreground">端末の日付が経過措置（2023年10月）より前になっています。日付を確かめてください。</p>
      </Card>
    );
  }
  return (
    <Card className="border-2 border-foreground">
      <p className="text-sm text-muted-foreground">
        いま（{current.label}）は、控除できる割合が {pct(current.deductibleRate)}
      </p>
      <h2 className="mt-2 text-sm font-bold">控除できずに会社が負担する消費税</h2>
      <p className="mt-1 flex flex-wrap items-baseline gap-x-4 gap-y-1">
        <span className="text-3xl font-bold">
          月 <Money value={current.monthly} />
        </span>
        <span>
          年 <Money value={current.yearly} className="font-bold" />
        </span>
      </p>
      <p className="num mt-2 text-xs text-muted-foreground">
        計算：{yen(result.monthlyPaidInclTax)} × 10/110 × (1 − {pct(current.deductibleRate)}) = {yen(current.monthly)}
        （1円未満は切り捨て）
      </p>
      {next ? (
        <div className="mt-4 rounded-lg bg-accent p-3 text-accent-foreground">
          <p className="font-bold">
            {jpDate(next.from)}から
            {daysUntilNext !== null && daysUntilNext <= 90 ? `（あと${daysUntilNext}日）` : ""}、控除できる割合が
            {pct(next.deductibleRate)}に下がります
          </p>
          <p className="mt-1">
            会社の負担は 月 <Money value={next.monthly} className="font-bold" />（年 <Money value={next.yearly} />
            ）。いまより 月 <span className="num font-bold">+{yen(next.diffMonthly)}</span>、年{" "}
            <span className="num font-bold">+{yen(next.yearly - current.yearly)}</span> です。
          </p>
        </div>
      ) : (
        <p className="mt-4 text-sm">経過措置は終わりました。仕入税額相当額の全額が会社の負担です。</p>
      )}
    </Card>
  );
}

function SimplifiedCard({ reference }: { reference: InvoiceCostResult | null }) {
  const cur = reference?.current;
  const next = reference?.next;
  return (
    <Card className="border-2 border-success">
      <h2 className="text-lg font-bold text-success">簡易課税・2割特例なら、会社の負担は増えません</h2>
      <p className="mt-2 text-sm">
        売上の消費税をもとに納める額を計算するので、ドライバーがインボイス登録をしていなくても、納める消費税は変わりません。
      </p>
      {cur && (
        <p className="mt-3 text-sm text-muted-foreground">
          参考：原則課税だった場合は、いま 月 <Money value={cur.monthly} />
          {next && (
            <>
              、{jpMonth(next.from)}から 月 <Money value={next.monthly} />
            </>
          )}
          の負担です。
        </p>
      )}
    </Card>
  );
}

function PeriodsTable({ result, ready }: { result: InvoiceCostResult; ready: boolean }) {
  return (
    <Card>
      <h2 className="font-bold">期間ごとの負担</h2>
      <p className="mt-1 text-xs text-muted-foreground">
        どの割合になるかは、支払った日ではなく「仕事をしてもらった日（課税仕入れを行った日）」で決まります。
      </p>
      <TableWrap>
        <table className="mt-3 w-full min-w-[36rem] border-collapse text-sm">
          <thead>
            <tr className="border-b border-border text-xs text-muted-foreground">
              <th scope="col" className="py-2 pl-2 pr-3 text-left">
                期間
              </th>
              <th scope="col" className="px-3 py-2 text-right">
                控除できる割合
              </th>
              <th scope="col" className="px-3 py-2 text-right">
                月の負担
              </th>
              <th scope="col" className="px-3 py-2 text-right">
                年の負担
              </th>
              <th scope="col" className="py-2 pl-3 pr-2 text-right">
                今と比べて（月）
              </th>
            </tr>
          </thead>
          <tbody>
            {result.rows.map((row) => (
              <PeriodRow key={row.from} row={row} status={ready ? row.status : null} affected={result.affected} />
            ))}
          </tbody>
        </table>
      </TableWrap>
      <p className="mt-3 text-xs text-muted-foreground">
        年の負担は月の負担 × 12 です。実際の消費税は1年分（課税期間）でまとめて計算するので、目安として見てください。
      </p>
    </Card>
  );
}

function PeriodRow({ row, status, affected }: { row: InvoiceCostRow; status: InvoiceCostRow["status"] | null; affected: boolean }) {
  const isCurrent = status === "current";
  const showDiff = affected && status === "future";
  return (
    <tr
      className={cx(
        "border-b border-border last:border-0",
        isCurrent && "bg-accent/20 font-bold",
        status === "past" && "text-muted-foreground",
      )}
    >
      <th scope="row" className={cx("whitespace-nowrap py-3 pl-2 pr-3 text-left", !isCurrent && "font-normal")}>
        {row.label}
        {isCurrent && (
          <span className="ml-2 rounded bg-accent px-1.5 py-0.5 text-xs font-bold text-accent-foreground">いま</span>
        )}
        {status === "past" && <span className="ml-2 text-xs">終了</span>}
      </th>
      <td className="num px-3 py-3 text-right">{pct(row.deductibleRate)}</td>
      <td className="px-3 py-3 text-right">
        <Money value={row.monthly} />
      </td>
      <td className="px-3 py-3 text-right">
        <Money value={row.yearly} />
      </td>
      <td className="num whitespace-nowrap py-3 pl-3 pr-2 text-right">
        {showDiff ? <span className="text-danger">+{yen(row.diffMonthly)}</span> : "—"}
      </td>
    </tr>
  );
}
