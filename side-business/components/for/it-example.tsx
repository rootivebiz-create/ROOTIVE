/**
 * /for/it の「計算の例」。架空の見本（lib/engine/presets の it）を lib/engine で計算して見せる。
 * 数字はここに書かない（見本の入力から毎回計算する）。サーバーで描くだけで、状態は持たない。
 */
import { Card, Money, TableWrap } from "@/components/ui";
import {
  calcModel,
  calcSettlement,
  SETTLEMENT_MODE_LABELS,
  type SettlementInput,
  type SettlementResult,
} from "@/lib/engine/payModels";
import {
  getPreset,
  withServiceDate,
  type PresetSample,
} from "@/lib/engine/presets";
import {
  buildPayout,
  type PayoutLine,
  type PayoutResult,
} from "@/lib/engine/statement";
import { en, num } from "@/lib/engine/types";
import { BASE_RULE_LABELS } from "@/lib/engine/withholding";
import { pct } from "@/lib/payroll/money";

const cx = (...c: (string | false | null | undefined)[]) =>
  c.filter(Boolean).join(" ");

export const IT = getPreset("it");

/** 2026-10-31 → 2026年10月分 */
export function monthLabel(date: string): string {
  const [y, m] = date.split("-").map(Number);
  return `${y}年${m}月分`;
}

/** 行のうち、最初の精算幅の行の入力（無ければ null） */
function settlementOf(lines: PayoutLine[] | undefined): SettlementInput | null {
  for (const l of lines ?? []) if (l.model === "settlement") return l.input;
  return null;
}

function linesTotal(lines: PayoutLine[]): number {
  return lines.reduce((a, l) => a + calcModel(l).amount, 0);
}

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
  const bill = sample.billLines ? linesTotal(sample.billLines) : null;
  const burdens = sample.input.payee.invoiceRegistered
    ? []
    : IT.compareServiceDates.map((date) => {
        const r = buildPayout(withServiceDate(sample.input, date));
        return { date, rate: r.deductibleRate, burden: r.invoiceBurden };
      });
  return { sample, result, bill, burdens };
}

const sampleById = (id: string) => IT.samples.find((s) => s.id === id);

function pick(ids: string[]): Computed[] {
  return ids
    .map(sampleById)
    .filter((s): s is PresetSample => s !== undefined)
    .map(compute);
}

/** 精算幅の見本（超過・下限割れ・月の途中の参画） */
const SETTLEMENT_SAMPLES = pick(["it-tanaka", "it-sato", "it-watanabe"]);
/** 請求と支払で精算幅がずれる見本 */
const MISMATCH_SAMPLE = sampleById("it-nakamura");
/** デザイン料の源泉徴収の見本 */
const WITHHOLDING_SAMPLES = pick(["it-takahashi", "it-yamamoto"]);

/**
 * 免税の方の見本で、経過措置の前後に発注する側が負担する消費税（本文で使う）。
 * 見本に免税の方がいなければ null。
 */
export function itBurdenCompare(): {
  name: string;
  burdens: { label: string; rate: number; burden: number }[];
} | null {
  const exempt = [...SETTLEMENT_SAMPLES, ...WITHHOLDING_SAMPLES].find(
    (c) => c.burdens.length > 0,
  );
  if (!exempt) return null;
  return {
    name: exempt.result.payee.name,
    burdens: exempt.burdens.map((b) => ({
      label: monthLabel(b.date),
      rate: b.rate,
      burden: b.burden,
    })),
  };
}

/** 取引条件明示書に書ける「算定方法」の例（最初の精算幅の見本から作る） */
export function itDisclosureExample(): { name: string; text: string } | null {
  for (const c of SETTLEMENT_SAMPLES) {
    const line = c.sample.input.lines.find((l) => l.model === "settlement");
    if (line)
      return {
        name: c.result.payee.name,
        text: calcModel(line).formulaText.trim(),
      };
  }
  return null;
}

function Row({
  label,
  detail,
  value,
  strong,
}: {
  label: string;
  detail?: string;
  value: number;
  strong?: boolean;
}) {
  return (
    <li className={cx("py-2", strong && "font-bold")}>
      <div className="flex items-baseline justify-between gap-3">
        <span>{label}</span>
        <Money value={value} className={strong ? "text-lg" : undefined} />
      </div>
      {detail && (
        <p className="mt-0.5 text-xs font-normal text-muted-foreground [overflow-wrap:anywhere]">
          {detail}
        </p>
      )}
    </li>
  );
}

function Warnings({ result }: { result: PayoutResult }) {
  if (result.warnings.length === 0) return null;
  return (
    <ul className="mt-3 space-y-1 text-sm">
      {result.warnings.map((w, i) => (
        <li
          key={`${w.code}-${i}`}
          className="rounded-lg border border-warning p-3"
        >
          <span className="font-bold text-warning">注意：</span>
          {w.message}
        </li>
      ))}
    </ul>
  );
}

/** 技術者への支払（報酬・消費税・源泉・振込額） */
function PayoutRows({
  result,
  withholdingDetail,
  settlementNote,
}: {
  result: PayoutResult;
  withholdingDetail?: string;
  /** 精算幅の行の説明に足す文（日割りの精算幅など） */
  settlementNote?: string | null;
}) {
  return (
    <ul className="divide-y divide-border text-sm">
      {result.lines.map((l, i) => (
        <Row
          key={`${l.label}-${i}`}
          label={l.label}
          detail={
            l.model === "settlement" && settlementNote
              ? `${l.detail}。${settlementNote}`
              : l.detail
          }
          value={l.amount}
        />
      ))}
      <Row label="報酬（税抜）" value={result.subtotal} strong />
      <Row
        label={result.taxLabel ?? "消費税"}
        detail={
          result.taxLabel === "消費税相当額"
            ? "免税の方にも、消費税相当額を上乗せして払う条件（架空）"
            : result.taxLabel === null
              ? "上乗せしない条件（架空）"
              : undefined
        }
        value={result.tax}
      />
      <Row
        label="源泉徴収"
        detail={withholdingDetail}
        value={-result.withholding}
      />
      {result.deductionsTotal > 0 && (
        <Row label="控除" value={-result.deductionsTotal} />
      )}
      <Row label="振込額" value={result.payout} strong />
    </ul>
  );
}

const hoursFormat = new Intl.NumberFormat("ja-JP", {
  maximumFractionDigits: 2,
});

/** 日割りした精算幅（日割りの無い見本は null） */
function proratedRangeText(lines: PayoutLine[]): string | null {
  const input = settlementOf(lines);
  if (!input?.proration) return null;
  const { lower, upper } = calcSettlement(input).settlement;
  if (lower === null || upper === null) return null;
  const h = (x: number) =>
    `${Number.isInteger(Math.round(x * 1e6) / 1e4) ? "" : "約"}${hoursFormat.format(x)}`;
  return `精算幅も同じ割合で ${h(lower)}〜${h(upper)}時間に縮めて比べる`;
}

function SettlementCard({ c }: { c: Computed }) {
  const { sample, result, bill, burdens } = c;
  const margin = bill === null ? null : bill - result.subtotal;
  const prorated = proratedRangeText(sample.input.lines);
  return (
    <Card>
      <h4 className="font-bold leading-snug">{sample.title}</h4>
      <p className="mt-1 text-sm text-muted-foreground">{sample.point}</p>

      <p className="mt-3 text-xs font-bold text-muted-foreground">
        技術者への支払
      </p>
      <PayoutRows
        result={result}
        settlementNote={prorated}
        withholdingDetail={
          result.withholding === 0
            ? "システム開発の報酬は、源泉徴収の対象に挙げられていないため、しない"
            : undefined
        }
      />

      {bill !== null && margin !== null && (
        <>
          <p className="mt-4 text-xs font-bold text-muted-foreground">
            会社の側（税抜）
          </p>
          <ul className="divide-y divide-border text-sm">
            <Row
              label="元請への請求"
              detail={sample.billLines
                ?.map((l) => calcModel(l).detail)
                .join("、")}
              value={bill}
            />
            <Row label="技術者への報酬" value={-result.subtotal} />
            <Row label="粗利" value={margin} strong />
          </ul>
        </>
      )}

      {burdens.length > 0 && (
        <>
          <p className="mt-4 text-xs font-bold text-muted-foreground">
            発注する側が控除できない消費税（原則課税の会社の場合）
          </p>
          <ul className="divide-y divide-border text-sm">
            {burdens.map((b) => (
              <Row
                key={b.date}
                label={`${monthLabel(b.date)}の稼働なら`}
                detail={`控除できるのは${pct(b.rate)}`}
                value={-b.burden}
              />
            ))}
          </ul>
        </>
      )}

      <Warnings result={result} />
    </Card>
  );
}

function WithholdingCard({ c }: { c: Computed }) {
  const { sample, result } = c;
  const formulas = result.withholdingGroups
    .map((g) => g.formulaText)
    .join("、");
  const basis =
    result.tax > 0 ? `元は${BASE_RULE_LABELS[result.withholdingRule]}。` : "";
  return (
    <Card>
      <h4 className="font-bold leading-snug">{sample.title}</h4>
      <p className="mt-1 text-sm text-muted-foreground">{sample.point}</p>
      <p className="mt-3 text-xs font-bold text-muted-foreground">
        デザイナーへの支払
      </p>
      <PayoutRows result={result} withholdingDetail={`${basis}${formulas}`} />
      <Warnings result={result} />
    </Card>
  );
}

/** 精算幅の見本（上下割の超過・下限割れ・月の途中の参画） */
export function ItSettlementExamples() {
  if (SETTLEMENT_SAMPLES.length === 0) return null;
  const first = SETTLEMENT_SAMPLES[0].sample;
  return (
    <section aria-labelledby="it-settlement-title" className="mt-8">
      <h3 id="it-settlement-title" className="text-lg font-bold leading-snug">
        計算の例：{IT.sampleCompany}の{monthLabel(first.input.serviceDate)}
      </h3>
      <p className="mt-2 text-sm">
        会社・技術者・金額はすべて架空です。無料の計算の道具と同じ仕組みで計算しています。精算幅・方式・時間の丸め・単価の端数は、この例の契約で決めた条件です。
      </p>
      <div className="mt-4 grid gap-4 sm:grid-cols-2">
        {SETTLEMENT_SAMPLES.map((c) => (
          <SettlementCard key={c.sample.id} c={c} />
        ))}
      </div>
    </section>
  );
}

function adjustmentText(r: SettlementResult): string {
  const s = r.settlement;
  if (s.adjustment > 0)
    return `＋${en(s.adjustment)}（超過単価 ${en(s.excessUnitPrice ?? 0)}）`;
  if (s.adjustment < 0)
    return `−${en(-s.adjustment)}（控除単価 ${en(s.shortUnitPrice ?? 0)}）`;
  return "精算なし（幅の中）";
}

function rangeText(input: SettlementInput): string {
  if (input.lower === undefined || input.upper === undefined)
    return SETTLEMENT_MODE_LABELS[input.mode];
  return `${num(input.lower)}〜${num(input.upper)}時間（${SETTLEMENT_MODE_LABELS[input.mode]}）`;
}

/** 請求と支払で精算幅がずれるときの粗利 */
export function ItMismatchExample() {
  const sample = MISMATCH_SAMPLE;
  const billLines = sample?.billLines;
  const payInput = settlementOf(sample?.input.lines);
  const billInput = settlementOf(billLines);
  if (!sample || !billLines || !payInput || !billInput) return null;

  const result = buildPayout(sample.input);
  const pay = calcSettlement(payInput);
  const billSettlement = calcSettlement(billInput);
  const bill = linesTotal(billLines);
  const margin = bill - result.subtotal;

  // 請求側も支払側と同じ精算幅だったら（比べるためだけの計算）
  const sameRangeLines: PayoutLine[] = billLines.map((l) =>
    l.model === "settlement"
      ? {
          ...l,
          input: { ...l.input, lower: payInput.lower, upper: payInput.upper },
        }
      : l,
  );
  const billSame = linesTotal(sameRangeLines);
  const marginSame = billSame - result.subtotal;

  const rows: { label: string; bill: string; pay: string }[] = [
    {
      label: "月額",
      bill: en(billInput.monthly ?? 0),
      pay: en(payInput.monthly ?? 0),
    },
    { label: "精算幅", bill: rangeText(billInput), pay: rangeText(payInput) },
    {
      label: "実働",
      bill: `${num(billSettlement.settlement.countedHours)}時間`,
      pay: `${num(pay.settlement.countedHours)}時間`,
    },
    {
      label: "精算",
      bill: adjustmentText(billSettlement),
      pay: adjustmentText(pay),
    },
    { label: "税抜の額", bill: en(bill), pay: en(result.subtotal) },
  ];

  return (
    <section aria-labelledby="it-mismatch-title" className="mt-8">
      <h3 id="it-mismatch-title" className="text-lg font-bold leading-snug">
        請求と支払で精算幅がずれるとき
      </h3>
      <Card className="mt-3">
        <h4 className="font-bold leading-snug">{sample.title}</h4>
        <p className="mt-1 text-sm text-muted-foreground">{sample.point}</p>
        <div className="mt-3">
          <TableWrap>
            <table className="w-full min-w-[20rem] border-collapse text-sm">
              <thead>
                <tr>
                  <th
                    scope="col"
                    className="border border-border bg-muted px-2 py-2 text-left"
                  >
                    <span className="sr-only">項目</span>
                  </th>
                  <th
                    scope="col"
                    className="border border-border bg-muted px-2 py-2 text-left"
                  >
                    元請への請求
                  </th>
                  <th
                    scope="col"
                    className="border border-border bg-muted px-2 py-2 text-left"
                  >
                    技術者への支払
                  </th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.label}>
                    <th
                      scope="row"
                      className="whitespace-nowrap border border-border px-2 py-2 text-left font-bold"
                    >
                      {r.label}
                    </th>
                    <td className="num border border-border px-2 py-2">
                      {r.bill}
                    </td>
                    <td className="num border border-border px-2 py-2">
                      {r.pay}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </TableWrap>
        </div>
        <ul className="mt-3 divide-y divide-border text-sm">
          <Row label="粗利（この契約のまま）" value={margin} strong />
          <Row
            label={`請求も${num(payInput.lower ?? 0)}〜${num(payInput.upper ?? 0)}時間だったら`}
            detail={`請求 ${en(billSame)} − 支払 ${en(result.subtotal)}`}
            value={marginSame}
          />
        </ul>
        <p className="mt-3 text-sm">
          同じ実働でも、精算幅が請求と支払で違うと、粗利が月ごとに動きます。逆に、支払側の幅のほうが広いと、請求では精算が出るのに支払では出ない月もあります。どちらの幅も契約で決まるので、請求側と支払側を並べて確かめるのが確実です。
        </p>
        <Warnings result={result} />
      </Card>
    </section>
  );
}

/** デザイン料の源泉徴収の見本 */
export function ItWithholdingExamples() {
  if (WITHHOLDING_SAMPLES.length === 0) return null;
  return (
    <section aria-labelledby="it-withholding-title" className="mt-6">
      <h3 id="it-withholding-title" className="text-lg font-bold leading-snug">
        計算の例：デザイン料の源泉徴収
      </h3>
      <p className="mt-2 text-sm">
        {IT.sampleCompany}
        が、個人のデザイナーに払う例です（人・金額は架空）。請求書で消費税を分けて書いてある前提です。
      </p>
      <div className="mt-4 grid gap-4 sm:grid-cols-2">
        {WITHHOLDING_SAMPLES.map((c) => (
          <WithholdingCard key={c.sample.id} c={c} />
        ))}
      </div>
    </section>
  );
}
