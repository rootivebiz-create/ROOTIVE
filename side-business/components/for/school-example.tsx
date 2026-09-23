/**
 * /for/school の「計算の例」と、本文に埋め込む数字。
 * 架空の見本（lib/engine/presets の school）を lib/engine で計算して見せる。
 * 数字はここに書かない（見本の入力から毎回計算する）。サーバーで描くだけで、状態は持たない。
 */
import { Card, Money } from "@/components/ui";
import { getPreset, withServiceDate, type PresetSample } from "@/lib/engine/presets";
import { buildPayout, type PayoutResult } from "@/lib/engine/statement";
import { num } from "@/lib/engine/types";
import { BASE_RULE_LABELS, WITHHOLDING_CATEGORIES, paymentReportRequired } from "@/lib/engine/withholding";
import { pct } from "@/lib/payroll/money";
import { sixtyDayLimit } from "@/lib/tools/torihiki-joken";

const cx = (...c: (string | false | null | undefined)[]) => c.filter(Boolean).join(" ");

export const SCHOOL = getPreset("school");

/** 2026-10-31 → 2026年10月分 */
export function monthLabel(date: string): string {
  const [y, m] = date.split("-").map(Number);
  return `${y}年${m}月分`;
}

/** 2026-12-31 → 2026年12月31日 */
export function jpDate(date: string): string {
  const [y, m, d] = date.split("-").map(Number);
  return `${y}年${m}月${d}日`;
}

/** 50000 → 5万円 */
export function manYen(value: number): string {
  return `${num(value / 10_000)}万円`;
}

type Computed = {
  sample: PresetSample;
  result: PayoutResult;
  /** 経過措置の前後で、発注する側が控除できない消費税（免税の方だけ） */
  burdens: { date: string; rate: number; burden: number }[];
};

function compute(sample: PresetSample): Computed {
  const result = buildPayout(sample.input);
  const burdens = sample.input.payee.invoiceRegistered
    ? []
    : SCHOOL.compareServiceDates.map((date) => {
        const r = buildPayout(withServiceDate(sample.input, date));
        return { date, rate: r.deductibleRate, burden: r.invoiceBurden };
      });
  return { sample, result, burdens };
}

const COMPUTED = SCHOOL.samples.map(compute);

/** この支払で、支払調書（年の支払が基準を超えたら）の対象になる区分があるか */
function reportRequiredThisMonth(result: PayoutResult): boolean {
  return result.withholdingGroups.some((g) => paymentReportRequired(g.category, g.amountExclTax));
}

/* ───────────── 本文で使う数字（見本から計算する） ───────────── */

/**
 * 登録済みの講師の見本で、請求書に消費税が分けて書いてあるときと、書いていないときの源泉。
 * 見本が無ければ null。
 */
export function schoolTaxBaseCompare(): {
  name: string;
  separated: { base: number; withholding: number };
  notSeparated: { base: number; withholding: number };
} | null {
  const c = COMPUTED.find((x) => x.result.payee.invoiceRegistered && x.result.tax > 0 && x.result.withholding > 0);
  if (!c) return null;
  const incl = buildPayout({ ...c.sample.input, taxShownSeparately: false });
  return {
    name: c.result.payee.name,
    separated: { base: c.result.withholdingBase, withholding: c.result.withholding },
    notSeparated: { base: incl.withholdingBase, withholding: incl.withholding },
  };
}

/** 教室の使用料などを相殺する見本（源泉は相殺の前の額に）。無ければ null */
export function schoolOffsetExample(): {
  name: string;
  base: number;
  withholding: number;
  deductionLabel: string;
  deduction: number;
  payout: number;
} | null {
  const c = COMPUTED.find((x) => x.result.deductionsTotal > 0 && x.result.withholding > 0);
  const first = c?.sample.input.deductions?.[0];
  if (!c || !first) return null;
  return {
    name: c.result.payee.name,
    base: c.result.withholdingBase,
    withholding: c.result.withholding,
    deductionLabel: first.label,
    deduction: c.result.deductionsTotal,
    payout: c.result.payout,
  };
}

/**
 * 免税の講師の見本で、経過措置の前後に教室が負担する消費税（原則課税の教室の場合）。
 * 1人目の例と、免税の講師の合計。あわせて、同じ支払を簡易課税の教室がしたときの負担（0 のはず）。
 * 見本に免税の方がいなければ null。
 */
export function schoolBurdenCompare(): {
  first: { name: string; burdens: { label: string; rate: number; burden: number }[] };
  count: number;
  totals: { label: string; rate: number; burden: number }[];
  simplified: number;
} | null {
  const exempt = COMPUTED.filter((c) => c.burdens.length > 0);
  const head = exempt[0];
  if (!head) return null;
  const totals = SCHOOL.compareServiceDates.map((date) => {
    const rows = exempt.map((c) => c.burdens.find((b) => b.date === date));
    return {
      label: monthLabel(date),
      rate: rows[0]?.rate ?? 0,
      burden: rows.reduce((a, b) => a + (b?.burden ?? 0), 0),
    };
  });
  const simplified = buildPayout({ ...head.sample.input, orderSideTaxMethod: "simplified" }).invoiceBurden;
  return {
    first: {
      name: head.result.payee.name,
      burdens: head.burdens.map((b) => ({ label: monthLabel(b.date), rate: b.rate, burden: b.burden })),
    },
    count: exempt.length,
    totals,
    simplified,
  };
}

/** 支払期日が60日を過ぎる見本。無ければ null */
export function schoolLateExample(): { name: string; receivedOn: string; payOn: string; limit: string } | null {
  const c = COMPUTED.find((x) => x.result.warnings.some((w) => w.code === "over_60_days"));
  const terms = c?.sample.input.paymentTerms;
  if (!c || !terms) return null;
  return { name: c.result.payee.name, receivedOn: terms.receivedOn, payOn: terms.payOn, limit: sixtyDayLimit(terms.receivedOn) };
}

/* ───────────── 見本のカード ───────────── */

function Row({ label, detail, value, strong }: { label: string; detail?: string; value: number; strong?: boolean }) {
  return (
    <li className={cx("py-2", strong && "font-bold")}>
      <div className="flex items-baseline justify-between gap-3">
        <span>{label}</span>
        <Money value={value} className={strong ? "text-lg" : undefined} />
      </div>
      {detail && <p className="mt-0.5 text-xs font-normal text-muted-foreground [overflow-wrap:anywhere]">{detail}</p>}
    </li>
  );
}

function withholdingDetail(result: PayoutResult): string {
  if (result.withholdingGroups.length === 0) {
    return result.lines.some((l) => l.withholdingNeedsReview)
      ? "源泉徴収の対象に挙げられている報酬（教授料・原稿料など）の行が無いため0円。区分は要確認"
      : "源泉徴収の対象の行はありません";
  }
  return [
    ...result.withholdingGroups.map((g) => g.formulaText),
    result.tax > 0 ? `元は${BASE_RULE_LABELS[result.withholdingRule]}` : null,
    result.deductionsTotal > 0 ? "相殺の前の額にかける" : null,
  ]
    .filter(Boolean)
    .join("。");
}

function SampleCard({ c }: { c: Computed }) {
  const { sample, result, burdens } = c;
  const terms = sample.input.paymentTerms;
  const deductions = sample.input.deductions ?? [];
  const single = result.lines.length === 1 ? result.lines[0] : null;

  return (
    <Card>
      <h4 className="font-bold leading-snug">{sample.title}</h4>
      <p className="mt-1 text-sm text-muted-foreground">{sample.point}</p>

      <ul className="mt-3 divide-y divide-border text-sm">
        {single ? (
          <Row
            label={`${single.label}（税抜）`}
            detail={`${single.detail}${single.withholdingNeedsReview ? "（源泉の区分は要確認）" : ""}`}
            value={result.subtotal}
            strong
          />
        ) : (
          <>
            {result.lines.map((l, i) => (
              <Row key={`${l.label}-${i}`} label={l.label} detail={l.detail} value={l.amount} />
            ))}
            <Row label="報酬（税抜）" value={result.subtotal} strong />
          </>
        )}
        <Row
          label={result.taxLabel ?? "消費税"}
          detail={
            result.taxLabel === "消費税相当額"
              ? "免税の方へ上乗せして払う分（架空の条件）"
              : result.taxLabel === null
                ? "上乗せしない条件（架空。はじめから総額で決めた前提）"
                : undefined
          }
          value={result.tax}
        />
        <Row label="源泉徴収" detail={withholdingDetail(result)} value={-result.withholding} />
        {deductions.map((d, i) => (
          <Row
            key={`${d.label}-${i}`}
            label={d.label}
            detail={d.agreedInWriting ? `契約で決めて明示・合意した相殺${d.basis ? `（${d.basis}）` : ""}` : "合意の無い差し引き"}
            value={-Math.floor(d.amount)}
          />
        ))}
        <Row label="振込額" value={result.payout} strong />
      </ul>

      {burdens.length > 0 && (
        <div className="mt-3 rounded-lg bg-muted p-3 text-sm">
          <p className="text-xs font-bold text-muted-foreground">教室が控除できない消費税（原則課税の教室の場合）</p>
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
            締め{jpDate(terms.receivedOn)}・支払{jpDate(terms.payOn)}の前提
            {terms.basedOnInvoiceReceipt ? "（請求書を受け取った月の翌月末払い）" : ""}。
          </li>
        )}
        {reportRequiredThisMonth(result) && WITHHOLDING_CATEGORIES.ko1.paymentReportOver !== null && (
          <li>
            この1か月分だけで年{manYen(WITHHOLDING_CATEGORIES.ko1.paymentReportOver)}を超えるので、支払調書の対象です（翌年1月31日まで）。
          </li>
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

export function SchoolExample() {
  const first = SCHOOL.samples[0];
  return (
    <section aria-labelledby="school-example-title" className="mt-8">
      <h3 id="school-example-title" className="text-lg font-bold leading-snug">
        計算の例：{SCHOOL.sampleCompany}の{first ? monthLabel(first.input.serviceDate) : ""}
      </h3>
      <p className="mt-2 text-sm">
        教室・講師・金額はすべて架空です。無料の計算の道具と同じ仕組みで計算しています。どの例も個人の講師への支払で、消費税（相当額）を上乗せするときは請求書で報酬と分けて書いてある前提です。教室は消費税を原則課税で計算している前提です。
      </p>
      <div className="mt-4 grid gap-4 sm:grid-cols-2">
        {COMPUTED.map((c) => (
          <SampleCard key={c.sample.id} c={c} />
        ))}
      </div>
      <p className="mt-3 text-xs text-muted-foreground">
        振込額 = 報酬（税抜）＋ 消費税（相当額）− 源泉徴収 − 契約で決めた相殺。源泉税は1円未満を切り捨てています。
      </p>
    </section>
  );
}
