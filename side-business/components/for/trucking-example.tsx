/**
 * /for/trucking の「計算の例」。架空の見本（lib/engine/presets の trucking）を lib/engine で計算して見せる。
 * 数字はここに書かない（見本の入力から毎回計算する）。サーバーで描くだけで、状態は持たない。
 */
import { Card, Money } from "@/components/ui";
import { cx } from "@/lib/cx";
import { calcModel } from "@/lib/engine/payModels";
import { getPreset, withServiceDate, type PresetSample } from "@/lib/engine/presets";
import { buildPayout, type PayoutResult } from "@/lib/engine/statement";
import { jpDate, monthLabel } from "@/lib/format";
import { pct } from "@/lib/payroll/money";

const TRUCKING = getPreset("trucking");

type Computed = {
  sample: PresetSample;
  result: PayoutResult;
  /** 元請への請求（税抜）。見本に請求側が無ければ null */
  bill: number | null;
  /** 経過措置の前後（免税の方だけ） */
  burdens: { date: string; rate: number; burden: number }[];
};

function compute(sample: PresetSample): Computed {
  const result = buildPayout(sample.input);
  const bill = sample.billLines ? sample.billLines.reduce((a, l) => a + calcModel(l).amount, 0) : null;
  const burdens = sample.input.payee.invoiceRegistered
    ? []
    : TRUCKING.compareServiceDates.map((date) => {
        const r = buildPayout(withServiceDate(sample.input, date));
        return { date, rate: r.deductibleRate, burden: r.invoiceBurden };
      });
  return { sample, result, bill, burdens };
}

const COMPUTED = TRUCKING.samples.map(compute);

/**
 * 免税のドライバーの見本で、経過措置の前後に会社が負担する消費税（本文で使う）。
 * 見本に免税の方がいなければ null。
 */
export function truckingBurdenCompare(): { name: string; burdens: { label: string; rate: number; burden: number }[] } | null {
  const exempt = COMPUTED.find((c) => c.burdens.length > 0);
  if (!exempt) return null;
  return {
    name: exempt.result.payee.name,
    burdens: exempt.burdens.map((b) => ({ label: monthLabel(b.date), rate: b.rate, burden: b.burden })),
  };
}

function Row({ label, detail, value, strong }: { label: string; detail?: string; value: number; strong?: boolean }) {
  return (
    <li className={cx("py-2", strong && "font-bold")}>
      <div className="flex items-baseline justify-between gap-3">
        <span>{label}</span>
        <Money value={value} className={strong ? "text-lg" : undefined} />
      </div>
      {detail && <p className="mt-0.5 text-xs text-muted-foreground">{detail}</p>}
    </li>
  );
}

function SampleCard({ c }: { c: Computed }) {
  const { sample, result, bill } = c;
  const terms = sample.input.paymentTerms;
  const within60 = terms && !result.warnings.some((w) => w.code === "over_60_days" || w.code === "due_from_invoice_receipt");
  const kept = bill === null ? null : bill - result.subtotal;
  return (
    <Card>
      <h4 className="font-bold leading-snug">{sample.title}</h4>
      <p className="mt-1 text-sm text-muted-foreground">{sample.point}</p>

      <p className="mt-3 text-xs font-bold text-muted-foreground">ドライバーへの支払</p>
      <ul className="divide-y divide-border text-sm">
        {result.lines.map((l) => (
          <Row key={l.label} label={l.label} detail={l.detail} value={l.amount} />
        ))}
        <Row label="報酬（税抜）" value={result.subtotal} strong />
        <Row
          label={result.taxLabel ?? "消費税相当額"}
          detail={
            result.taxLabel
              ? undefined
              : "上乗せしない（はじめから総額の単価で決めて、明示・合意している、という架空の条件）"
          }
          value={result.tax}
        />
        <Row
          label="源泉徴収"
          detail={result.withholding === 0 ? "運送の報酬は源泉徴収の対象に挙げられていないため、しない" : undefined}
          value={-result.withholding}
        />
        {result.deductionsTotal > 0 && <Row label="控除" value={-result.deductionsTotal} />}
        <Row label="振込額" value={result.payout} strong />
      </ul>
      {terms && (
        <p className="mt-2 text-xs text-muted-foreground">
          締め日{jpDate(terms.receivedOn)}・支払日{jpDate(terms.payOn)}の前提。
          {within60 ? "フリーランス法の60日の期限の中です。" : "60日の期限を確かめてください。"}
        </p>
      )}

      {bill !== null && kept !== null && (
        <>
          <p className="mt-4 text-xs font-bold text-muted-foreground">会社の側（税抜）</p>
          <ul className="divide-y divide-border text-sm">
            <Row
              label="元請への請求"
              detail={sample.billLines?.map((l) => calcModel(l).detail).join("、")}
              value={bill}
            />
            <Row label="ドライバーへの報酬（差し引いた後）" value={-result.subtotal} />
            <Row label="会社に残る額" value={kept} strong />
            {result.invoiceBurden > 0 && (
              <>
                <Row
                  label="控除できない消費税"
                  detail={`免税の方への支払。${monthLabel(sample.input.serviceDate)}は${pct(result.deductibleRate)}だけ控除できる（原則課税の会社の場合）`}
                  value={-result.invoiceBurden}
                />
                <Row label="負担を引いた後" value={kept - result.invoiceBurden} strong />
              </>
            )}
          </ul>
        </>
      )}

      {result.warnings.length > 0 && (
        <ul className="mt-3 space-y-1 text-sm">
          {result.warnings.map((w, i) => (
            <li key={`${w.code}-${i}`} className="rounded-lg border border-warning p-3">
              <span className="font-bold text-warning">注意：</span>
              {w.message}
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

export function TruckingExample() {
  const first = TRUCKING.samples[0];
  return (
    <section aria-labelledby="trucking-example-title" className="mt-8">
      <h3 id="trucking-example-title" className="text-lg font-bold leading-snug">
        計算の例：{TRUCKING.sampleCompany}の{first ? monthLabel(first.input.serviceDate) : ""}
      </h3>
      <p className="mt-2 text-sm">
        会社・ドライバー・金額はすべて架空です。無料の計算の道具と同じ仕組みで計算しています。ロイヤリティ・管理費は、契約で決めた差し引きとして、消費税を計算する前に引く前提です。
      </p>
      <div className="mt-4 grid gap-4 sm:grid-cols-2">
        {COMPUTED.map((c) => (
          <SampleCard key={c.sample.id} c={c} />
        ))}
      </div>
    </section>
  );
}
