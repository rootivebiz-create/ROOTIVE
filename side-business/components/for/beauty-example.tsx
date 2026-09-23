/**
 * /for/beauty の「計算の例」と、本文に埋め込む数字。架空の見本（lib/engine/presets の beauty）を lib/engine で計算して見せる。
 * 数字はここに書かない（見本の入力から毎回計算する）。サーバーで描くだけで、状態は持たない。
 * 労働者性は判定しない（エンジンが出す注意をそのまま見せるだけ）。
 */
import { Card, Money } from "@/components/ui";
import { calcModel } from "@/lib/engine/payModels";
import { getPreset, withServiceDate, type PresetSample } from "@/lib/engine/presets";
import { buildPayout, type Payee, type PayoutInput, type PayoutResult } from "@/lib/engine/statement";
import type { WarningLevel } from "@/lib/engine/types";
import { BASE_RULE_LABELS } from "@/lib/engine/withholding";
import { pct } from "@/lib/payroll/money";
import { paymentDeadlineCheck, type DayOfMonth, type PayMonthOffset } from "@/lib/tools/torihiki-joken";

const cx = (...c: (string | false | null | undefined)[]) => c.filter(Boolean).join(" ");

export const BEAUTY = getPreset("beauty");

/** 2026-10-31 → 2026年10月31日 */
export function jpDate(date: string): string {
  const [y, m, d] = date.split("-").map(Number);
  return `${y}年${m}月${d}日`;
}

/** 2026-10-31 → 2026年10月分 */
export function monthLabel(date: string): string {
  const [y, m] = date.split("-").map(Number);
  return `${y}年${m}月分`;
}

type Burden = { date: string; rate: number; burden: number };

type Computed = {
  sample: PresetSample;
  result: PayoutResult;
  /** 経過措置の前後にサロンが控除できない消費税（免税の方で報酬があるときだけ） */
  burdens: Burden[];
  /** サロンが簡易課税なら（免税の方で報酬があるときだけ） */
  simplifiedBurden: number | null;
};

function compute(sample: PresetSample): Computed {
  const result = buildPayout(sample.input);
  const exempt = !sample.input.payee.invoiceRegistered && result.subtotal > 0;
  const burdens = exempt
    ? BEAUTY.compareServiceDates.map((date) => {
        const r = buildPayout(withServiceDate(sample.input, date));
        return { date, rate: r.deductibleRate, burden: r.invoiceBurden };
      })
    : [];
  const simplifiedBurden = exempt ? buildPayout({ ...sample.input, orderSideTaxMethod: "simplified" }).invoiceBurden : null;
  return { sample, result, burdens, simplifiedBurden };
}

const SAMPLES = BEAUTY.samples.map(compute);

/**
 * 免税の方の見本で、経過措置の前後にサロン（原則課税）が控除できない消費税と、簡易課税なら 0 円であること。
 * 見本に免税の方がいなければ null。
 */
export function beautyBurdenCompare(): {
  name: string;
  burdens: { label: string; rate: number; burden: number }[];
  simplified: number;
} | null {
  const c = SAMPLES.find((s) => s.burdens.length > 0 && s.simplifiedBurden !== null);
  if (!c || c.simplifiedBurden === null) return null;
  return {
    name: c.result.payee.name,
    burdens: c.burdens.map((b) => ({ label: monthLabel(b.date), rate: b.rate, burden: b.burden })),
    simplified: c.simplifiedBurden,
  };
}

/** 取引条件明示書の「報酬の額」に書ける算定方法の例（歩合・差し引き・段階歩合の見本から作る） */
export function beautyDisclosureExample(): { name: string; items: { label: string; text: string }[] }[] {
  const out: { name: string; items: { label: string; text: string }[] }[] = [];
  for (const c of SAMPLES) {
    const lines = c.sample.input.lines.filter((l) => l.model === "commission" || l.model === "contractFee" || l.model === "tiered");
    if (lines.length === 0) continue;
    out.push({ name: c.result.payee.name, items: lines.map((l) => ({ label: l.label, text: calcModel(l).formulaText.trim() })) });
  }
  return out;
}

/* ───────────── 源泉徴収の例（施術の歩合と講習の講師料を同じ人に払う） ───────────── */

const WITHHOLDING_PAYEE: Payee = { name: "スタイリスト（架空・登録済み）", invoiceRegistered: true, isCorporation: false, paysTaxOnTop: true };
/** 例の支払日（月末締め・翌月25日払いの架空の条件） */
const WITHHOLDING_PAY_ON = "2026-11-25";

const WITHHOLDING_INPUT: PayoutInput = {
  payee: WITHHOLDING_PAYEE,
  lines: [
    {
      label: "施術の歩合",
      model: "commission",
      input: { categories: [{ label: "技術", sales: 400_000, rate: 0.5 }] },
      withholding: "none",
    },
    { label: "講習の講師料", model: "unit", input: { qty: 2, rate: 20_000, unitLabel: "回" }, withholding: "ko1" },
  ],
  serviceDate: BEAUTY.serviceDate,
  orderSideTaxMethod: BEAUTY.orderSideTaxMethod,
  paymentTerms: { receivedOn: BEAUTY.serviceDate, payOn: WITHHOLDING_PAY_ON, monthlyClosing: true },
};

/* ───────────── 支払期日の例（lib/tools/torihiki-joken と同じ判定） ───────────── */

/** 見本の月の初日（締め期間の最初の日から数える） */
function monthStart(date: string): string {
  return `${date.slice(0, 7)}-01`;
}

const DUE_RULES: { closingDay: DayOfMonth; payMonthOffset: PayMonthOffset; payDay: DayOfMonth }[] = [
  { closingDay: "末", payMonthOffset: 1, payDay: 25 },
  { closingDay: "末", payMonthOffset: 1, payDay: "末" },
];

/** 月末締めの支払のルールごとに、見本の月の分が60日（2か月）以内に払えるか */
export function beautyDueExamples(): { rule: string; payDate: string; limit: string; ok: boolean }[] {
  const out: { rule: string; payDate: string; limit: string; ok: boolean }[] = [];
  for (const r of DUE_RULES) {
    const check = paymentDeadlineCheck({ ...r, serviceFrom: monthStart(BEAUTY.serviceDate), months: 1 });
    const row = check.rows[0];
    if (check.error || !row) continue;
    out.push({ rule: check.ruleLabel, payDate: row.payDateActual, limit: row.limitFromStart, ok: row.status === "ok" });
  }
  return out;
}

/* ───────────── 表示の部品 ───────────── */

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

const LEVEL_LABELS: Record<WarningLevel, string> = {
  warning: "注意",
  caution: "確かめてください",
  info: "参考",
};

function Warnings({ result }: { result: PayoutResult }) {
  if (result.warnings.length === 0 && result.notes.length === 0) return null;
  return (
    <ul className="mt-3 space-y-1 text-sm">
      {result.warnings.map((w, i) => (
        <li
          key={`${w.code}-${i}`}
          className={cx("rounded-lg border p-3", w.level === "info" ? "border-border" : "border-warning")}
        >
          <span className={cx("font-bold", w.level !== "info" && "text-warning")}>
            {LEVEL_LABELS[w.level]}
            {w.source ? `（${w.source}）` : ""}：
          </span>
          {w.message}
        </li>
      ))}
      {result.notes.map((n) => (
        <li key={n} className="rounded-lg border border-border bg-muted p-3">
          <span className="font-bold">補足：</span>
          {n}
        </li>
      ))}
    </ul>
  );
}

function taxDetail(result: PayoutResult): string | undefined {
  if (result.taxLabel === "消費税相当額") return "免税の方にも、消費税相当額を上乗せして払う条件（架空）";
  if (result.taxLabel === null) {
    return result.payee.invoiceRegistered ? "上乗せしない条件（架空）" : "免税の方で、はじめから総額で決めた条件（架空）";
  }
  return undefined;
}

/** 報酬・消費税・源泉・差し引き・振込額。面貸しの精算だけの見本は、精算の行と振込額だけ */
function PayoutRows({ sample, result }: { sample: PresetSample; result: PayoutResult }) {
  const hasFee = result.subtotal !== 0 || result.settlementsTotal === 0;
  const deductions = sample.input.deductions ?? [];
  const withholdingDetail =
    result.withholding === 0
      ? "施術の報酬は、源泉徴収の対象に挙げられていないため、しない"
      : result.withholdingGroups.map((g) => g.formulaText).join("、");
  return (
    <ul className="divide-y divide-border text-sm">
      {result.lines.map((l, i) => (
        <Row key={`${l.label}-${i}`} label={l.label} detail={l.detail} value={l.amount} />
      ))}
      {hasFee && <Row label="報酬（税抜）" value={result.subtotal} strong />}
      {hasFee && <Row label={result.taxLabel ?? "消費税"} detail={taxDetail(result)} value={result.tax} />}
      {hasFee && <Row label="源泉徴収" detail={withholdingDetail} value={-result.withholding} />}
      {deductions.map((d, i) => (
        <Row
          key={`${d.label}-${i}`}
          label={d.label}
          detail={d.agreedInWriting ? "取引条件に書いてある差し引き" : "取引条件に書いていない差し引き（架空の悪い例）"}
          value={-Math.floor(d.amount)}
        />
      ))}
      <Row label={hasFee ? "振込額" : "振込額（精算額）"} value={result.payout} strong />
    </ul>
  );
}

function SampleCard({ c }: { c: Computed }) {
  const { sample, result, burdens, simplifiedBurden } = c;
  return (
    <Card>
      <h4 className="font-bold leading-snug">{sample.title}</h4>
      <p className="mt-1 text-sm text-muted-foreground">{sample.point}</p>
      <p className="mt-3 text-xs font-bold text-muted-foreground">スタッフへの支払</p>
      <PayoutRows sample={sample} result={result} />

      {burdens.length > 0 && (
        <>
          <p className="mt-4 text-xs font-bold text-muted-foreground">サロンが控除できない消費税（原則課税のサロンの場合）</p>
          <ul className="divide-y divide-border text-sm">
            {burdens.map((b) => (
              <Row key={b.date} label={`${monthLabel(b.date)}の施術なら`} detail={`控除できるのは${pct(b.rate)}`} value={-b.burden} />
            ))}
            {simplifiedBurden !== null && <Row label="簡易課税・免税のサロンなら" value={-simplifiedBurden} />}
          </ul>
        </>
      )}

      <Warnings result={result} />
    </Card>
  );
}

/** ヘアサロン ルミエ（架空）の5人ぶんの見本 */
export function BeautySamples() {
  if (SAMPLES.length === 0) return null;
  return (
    <section aria-labelledby="beauty-samples-title" className="mt-8">
      <h3 id="beauty-samples-title" className="text-lg font-bold leading-snug">
        計算の例：{BEAUTY.sampleCompany}の{monthLabel(BEAUTY.serviceDate)}
      </h3>
      <p className="mt-2 text-sm">
        サロン・スタッフ・金額・率はすべて架空で、相場を示すものではありません。無料の計算の道具と同じ仕組みで計算しています。売上はすべて税抜で、率は税抜の売上に掛ける契約の例です。
      </p>
      <div className="mt-4 grid gap-4 sm:grid-cols-2">
        {SAMPLES.map((c) => (
          <SampleCard key={c.sample.id} c={c} />
        ))}
      </div>
    </section>
  );
}

/** 施術の歩合と講習の講師料を同じ人に払うときの源泉徴収（講師料の行だけ） */
export function BeautyWithholdingExample() {
  const separated = buildPayout(WITHHOLDING_INPUT);
  const notSeparated = buildPayout({ ...WITHHOLDING_INPUT, taxShownSeparately: false });
  const lecture = separated.withholdingGroups[0];
  const lectureIncl = notSeparated.withholdingGroups[0];
  if (!lecture || !lectureIncl) return null;
  return (
    <Card className="mt-4">
      <h4 className="font-bold leading-snug">計算の例：施術の歩合と講習の講師料を一緒に払う</h4>
      <p className="mt-1 text-sm text-muted-foreground">
        {WITHHOLDING_PAYEE.name}に、施術の歩合と、サロンの講習の講師料を同じ日に払う例です。源泉徴収は講師料の行だけにかけます。
      </p>
      <ul className="mt-3 divide-y divide-border text-sm">
        {separated.lines.map((l, i) => (
          <Row
            key={`${l.label}-${i}`}
            label={l.label}
            detail={`${l.detail}（源泉徴収：${l.withholding === "none" ? "しない" : "する"}）`}
            value={l.amount}
          />
        ))}
        <Row label="報酬（税抜）" value={separated.subtotal} strong />
        <Row label={separated.taxLabel ?? "消費税"} value={separated.tax} />
        <Row
          label="源泉徴収（講師料の行だけ）"
          detail={`元は${BASE_RULE_LABELS[separated.withholdingRule]}。${lecture.formulaText}`}
          value={-separated.withholding}
        />
        <Row label="振込額" value={separated.payout} strong />
      </ul>
      <ul className="mt-3 list-disc space-y-1 pl-5 text-sm">
        <li>
          請求書で消費税を分けて書いていなければ、元は税込の講師料になり、{lectureIncl.formulaText}です。
        </li>
        {separated.withholdingDue && (
          <li>
            {jpDate(WITHHOLDING_PAY_ON)}に払うなら、源泉税は{jpDate(separated.withholdingDue)}
            までに納めます（支払った月の翌月10日。土日祝日なら翌営業日）。
          </li>
        )}
      </ul>
    </Card>
  );
}
