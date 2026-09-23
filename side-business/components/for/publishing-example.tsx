/**
 * /for/publishing の「計算の例」と、本文に埋め込む数字。
 * 架空の見本（lib/engine/presets の publishing）を lib/engine で計算して見せる。
 * 数字はここに書かない（見本の入力から毎回計算する）。サーバーで描くだけで、状態は持たない。
 */
import { Card, Money } from "@/components/ui";
import { getPreset, withServiceDate, type PresetSample } from "@/lib/engine/presets";
import { buildPayout, type PayoutResult } from "@/lib/engine/statement";
import { num } from "@/lib/engine/types";
import { BASE_RULE_LABELS, WITHHOLDING_CATEGORIES, paymentReportRequired } from "@/lib/engine/withholding";
import { pct } from "@/lib/payroll/money";

const cx = (...c: (string | false | null | undefined)[]) => c.filter(Boolean).join(" ");

export const PUBLISHING = getPreset("publishing");

/** 2026-10-31 → 2026年10月分 */
export function monthLabel(date: string): string {
  const [y, m] = date.split("-").map(Number);
  return `${y}年${m}月分`;
}

/** 2026-11-30 → 2026年11月30日 */
export function jpDate(date: string): string {
  const [y, m, d] = date.split("-").map(Number);
  return `${y}年${m}月${d}日`;
}

/** 50000 → 5万円 */
export function manYen(value: number): string {
  return `${num(value / 10_000)}万円`;
}

/** 受け取った日を1日目として、支払日が何日目か */
function dayNumber(from: string, to: string): number {
  const t = (d: string) => {
    const [y, m, day] = d.split("-").map(Number);
    return Date.UTC(y, m - 1, day);
  };
  return Math.round((t(to) - t(from)) / 86_400_000) + 1;
}

type Computed = {
  sample: PresetSample;
  result: PayoutResult;
  /** 経過措置の前後（免税の方だけ） */
  burdens: { date: string; rate: number; burden: number }[];
};

function compute(sample: PresetSample): Computed {
  const result = buildPayout(sample.input);
  const burdens = sample.input.payee.invoiceRegistered
    ? []
    : PUBLISHING.compareServiceDates.map((date) => {
        const r = buildPayout(withServiceDate(sample.input, date));
        return { date, rate: r.deductibleRate, burden: r.invoiceBurden };
      });
  return { sample, result, burdens };
}

const COMPUTED = PUBLISHING.samples.map(compute);

/** 1号の支払調書の基準（年の支払の合計がこれを超えたら対象） */
const REPORT_OVER = WITHHOLDING_CATEGORIES.ko1.paymentReportOver;

/**
 * 課税事業者の見本で、請求書に消費税が分けて書いてあるときと、書いていないときの源泉（本文で使う）。
 * 見本が無ければ null。
 */
export function publishingTaxBaseCompare(): {
  name: string;
  separated: { base: number; withholding: number };
  notSeparated: { base: number; withholding: number };
} | null {
  const c = COMPUTED.find(
    (x) => x.result.payee.invoiceRegistered && x.result.tax > 0 && x.result.withholding > 0 && x.result.reimbursementsPaid === 0,
  );
  if (!c) return null;
  const incl = buildPayout({ ...c.sample.input, taxShownSeparately: false });
  return {
    name: c.result.payee.name,
    separated: { base: c.result.withholdingBase, withholding: c.result.withholding },
    notSeparated: { base: incl.withholdingBase, withholding: incl.withholding },
  };
}

/**
 * 免税の方の見本で、経過措置の前後に発注する側が負担する消費税（本文で使う）。
 * 見本に免税の方がいなければ null。
 */
export function publishingBurdenCompare(): { name: string; burdens: { label: string; rate: number; burden: number }[] } | null {
  const exempt = COMPUTED.find((c) => c.burdens.length > 0);
  if (!exempt) return null;
  return {
    name: exempt.result.payee.name,
    burdens: exempt.burdens.map((b) => ({ label: monthLabel(b.date), rate: b.rate, burden: b.burden })),
  };
}

/** 60日を過ぎる見本（本文で使う）。無ければ null */
export function publishingLateExample(): { name: string; receivedOn: string; payOn: string; day: number } | null {
  const c = COMPUTED.find((x) => x.result.warnings.some((w) => w.code === "over_60_days"));
  const terms = c?.sample.input.paymentTerms;
  if (!c || !terms) return null;
  return { name: c.result.payee.name, receivedOn: terms.receivedOn, payOn: terms.payOn, day: dayNumber(terms.receivedOn, terms.payOn) };
}

function Row({ label, detail, value, strong }: { label: string; detail?: string; value: number; strong?: boolean }) {
  return (
    <li className={cx("py-2", strong && "font-bold")}>
      <div className="flex items-baseline justify-between gap-3">
        <span>{label}</span>
        <Money value={value} className={strong ? "text-lg" : undefined} />
      </div>
      {detail && <p className="mt-0.5 text-xs font-normal text-muted-foreground">{detail}</p>}
    </li>
  );
}

function SampleCard({ c }: { c: Computed }) {
  const { sample, result, burdens } = c;
  const terms = sample.input.paymentTerms;
  const late = result.warnings.some((w) => w.code === "over_60_days" || w.code === "due_from_invoice_receipt");
  const single = result.lines.length === 1 ? result.lines[0] : null;
  const withholdingDetail = [
    ...result.withholdingGroups.map((g) => g.formulaText),
    result.withholding > 0 ? `元は${BASE_RULE_LABELS[result.withholdingRule]}` : null,
    result.reimbursementsPaid > 0 ? "報酬と一緒に払う交通費も元に入れる" : null,
  ]
    .filter(Boolean)
    .join("。");
  const reportOver = REPORT_OVER !== null && paymentReportRequired("ko1", result.subtotal);

  return (
    <Card>
      <h4 className="font-bold leading-snug">{sample.title}</h4>
      <p className="mt-1 text-sm text-muted-foreground">{sample.point}</p>

      <ul className="mt-3 divide-y divide-border text-sm">
        {single ? (
          <Row label={`${single.label}（税抜）`} detail={single.detail} value={result.subtotal} strong />
        ) : (
          <>
            {result.lines.map((l) => (
              <Row key={l.label} label={l.label} detail={l.detail} value={l.amount} />
            ))}
            <Row label="報酬（税抜）" value={result.subtotal} strong />
          </>
        )}
        <Row
          label={result.taxLabel ?? "消費税"}
          detail={
            result.taxLabel === "消費税相当額"
              ? "免税の方へ上乗せして払う分。請求書で報酬と分けて書いてもらう前提"
              : result.taxLabel === null
                ? "上乗せしない"
                : undefined
          }
          value={result.tax}
        />
        {result.reimbursementsPaid > 0 && <Row label="交通費（報酬と一緒に払う）" value={result.reimbursementsPaid} />}
        <Row label="源泉徴収" detail={withholdingDetail || undefined} value={-result.withholding} />
        {result.deductionsTotal > 0 && <Row label="控除" value={-result.deductionsTotal} />}
        <Row label="振込額" value={result.payout} strong />
      </ul>

      {burdens.length > 0 && (
        <div className="mt-3 rounded-lg bg-muted p-3 text-sm">
          <p className="text-xs font-bold text-muted-foreground">発注する側が控除できない消費税（原則課税の会社の場合）</p>
          <ul className="mt-1 space-y-1">
            {burdens.map((b) => (
              <li key={b.date} className="flex items-baseline justify-between gap-3">
                <span>
                  {monthLabel(b.date)}
                  <span className="ml-1 text-xs text-muted-foreground">（控除{pct(b.rate)}）</span>
                </span>
                <Money value={b.burden} />
              </li>
            ))}
          </ul>
        </div>
      )}

      <ul className="mt-3 space-y-1 text-xs text-muted-foreground">
        {terms && (
          <li>
            納品{jpDate(terms.receivedOn)}・支払{jpDate(terms.payOn)}（納品の日を1日目として{dayNumber(terms.receivedOn, terms.payOn)}日目）の前提。
            {late ? "" : "フリーランス法の60日の期限の中です。"}
          </li>
        )}
        {result.withholdingDue && <li>源泉税の納付：{jpDate(result.withholdingDue)}まで（支払った月の翌月10日。土日祝日なら翌営業日）</li>}
        {reportOver && REPORT_OVER !== null && (
          <li>この1回だけで年{manYen(REPORT_OVER)}を超えるので、支払調書の対象です（翌年1月31日まで）。</li>
        )}
      </ul>

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

export function PublishingExample() {
  const first = PUBLISHING.samples[0];
  return (
    <section aria-labelledby="publishing-example-title" className="mt-8">
      <h3 id="publishing-example-title" className="text-lg font-bold leading-snug">
        計算の例：{PUBLISHING.sampleCompany}の{first ? monthLabel(first.input.serviceDate) : ""}
      </h3>
      <p className="mt-2 text-sm">
        会社・人・金額はすべて架空です。無料の計算の道具と同じ仕組みで計算しています。どの例も、個人の方への支払で、請求書に報酬と消費税（相当額）が分けて書いてある前提です。
      </p>
      <div className="mt-4 grid gap-4 sm:grid-cols-2">
        {COMPUTED.map((c) => (
          <SampleCard key={c.sample.id} c={c} />
        ))}
      </div>
      <p className="mt-3 text-xs text-muted-foreground">
        振込額 = 報酬（税抜）＋ 消費税（相当額）＋ 報酬と一緒に払う交通費 − 源泉徴収。源泉税は1円未満を切り捨てています。
      </p>
    </section>
  );
}
