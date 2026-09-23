import type { Metadata } from "next";
import { TableWrap } from "@/components/ui";
import { PlateLogo } from "@/components/plate-logo";
import {
  BENEFITS,
  COMPARISON_CRITERIA,
  COMPARISON_NOTE,
  EXAMPLE_PAID,
  FEATURES,
  FREELANCE,
  FREE_CHECK,
  MAKER,
  NOT_ADVICE,
  PAINS,
  SAFETY,
  SOURCES,
  STEP_70_DATE,
  TRUST,
  burdenExample,
  comparisonChoices,
  flowSteps,
  perHeadEquivalent,
  shortSource,
} from "@/components/kit/content";
import { addressee, cx, displayUrl, jpToday, kitUrl, yenText } from "@/components/kit/format";
import { KitToolbar, PaperStyle } from "@/components/kit/paper";
import { Qr } from "@/components/kit/qr";
import { SenderBlock, SetupWarning } from "@/components/kit/sender";
import { DemoBadge, MiniTable, Slide } from "@/components/kit/slide";
import { summarize } from "@/lib/payroll/calc";
import { pct, yen } from "@/lib/payroll/money";
import { sampleData } from "@/lib/payroll/sample";
import { deductibleRateForExempt } from "@/lib/payroll/tax";
import { jpDate, jpMonth } from "@/lib/tools/invoice-cost";
import { CONTACT, MAINTENANCE_INCLUDES, OPTIONS, PLANS, SITE, businessInfo, type Plan } from "@/site.config";

type Props = { searchParams: Promise<Record<string, string | string[] | undefined>> };

/** タイトルは「PDFに保存」したときのファイル名にもなるので、宛名を入れる */
export async function generateMetadata({ searchParams }: Props): Promise<Metadata> {
  const to = addressee((await searchParams).company);
  return {
    title: to ? `ご提案書（${to}）` : "ご提案書",
    robots: { index: false, follow: false },
  };
}

/** 印刷では 1 枚 = A4 横 1 ページ。画面ではカードとして縦に並べる */
const DECK_CSS = `
@media print {
  .kit-slide {
    width: auto;
    height: calc(210mm - 1px);
    margin: 0 !important;
    padding: 9mm 13mm 6mm !important;
    border: 0 !important;
    border-radius: 0 !important;
    box-shadow: none !important;
    overflow: hidden;
    break-inside: avoid;
    page-break-inside: avoid;
    aspect-ratio: auto !important;
  }
  .kit-slide:last-child { break-after: auto; }
}
`;

const TOTAL = 9;
const DEMO_MONTH = "2026-10";

function PriceLine({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between gap-2 border-b border-border py-1 last:border-b-0">
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="num text-right font-bold">{value}</dd>
    </div>
  );
}

function PlanCard({ plan }: { plan: Plan }) {
  const oneOff = plan.monthlyYen === 0;
  return (
    <li
      className={cx(
        "relative flex flex-col rounded-card bg-card p-3",
        plan.featured ? "border-2 border-foreground" : "border border-border",
      )}
    >
      {plan.featured && (
        <span className="absolute -top-2.5 left-3 rounded-full bg-accent px-2 text-xs font-bold leading-5 text-accent-foreground">
          おすすめ
        </span>
      )}
      <h3 className="font-bold leading-snug">{plan.name}</h3>
      <p className="mt-0.5 text-xs leading-snug text-muted-foreground">{plan.forWhom}</p>
      <dl className="mt-2 text-sm">
        <PriceLine label={oneOff ? "費用（1回）" : "初期費用"} value={yenText(plan.initialYen)} />
        <PriceLine label="月額" value={oneOff ? "なし" : yenText(plan.monthlyYen)} />
        <PriceLine label="期間の目安" value={plan.weeks} />
      </dl>
      <ul className="mt-2 list-disc space-y-0.5 pl-4 text-xs leading-snug">
        {plan.includes.map((item) => (
          <li key={item}>{item}</li>
        ))}
      </ul>
      {plan.note && <p className="mt-2 rounded bg-muted p-2 text-xs leading-snug">{plan.note}</p>}
    </li>
  );
}

export default async function ProposalPage({ searchParams }: Props) {
  const sp = await searchParams;
  const to = addressee(sp.company);
  const info = businessInfo();
  const today = jpToday();

  const data = sampleData(DEMO_MONTH);
  const summary = summarize(data);
  const exempt =
    summary.statements.find((s) => !s.driver.invoiceRegistered && s.adjustmentTotal !== 0) ??
    summary.statements.find((s) => !s.driver.invoiceRegistered) ??
    summary.statements[0];
  const exemptPL = summary.drivers.find((d) => d.driver.id === exempt.driver.id);
  const taxRateLabel = pct(data.settings.taxRate);
  const demoDeductible = pct(deductibleRateForExempt(summary.judgedOn));
  const monthLabel = jpMonth(`${DEMO_MONTH}-01`);
  const bestProject = [...summary.projects]
    .filter((p) => p.margin !== null)
    .sort((a, b) => (b.margin ?? 0) - (a.margin ?? 0))[0];

  const burden = burdenExample();
  const choices = comparisonChoices();
  const perHead = perHeadEquivalent();
  const steps = flowSteps();
  const contactUrl = kitUrl("/contact", "proposal");
  const demoUrl = kitUrl("/demo", "proposal");
  const tagline = SITE.tagline.replace(/。$/, "");

  return (
    <div className="kit-deck">
      <PaperStyle orientation="landscape" css={DECK_CSS} />
      <KitToolbar
        title="提案書（A4横・9枚）"
        hint="商談の前にPDFで送る・画面共有で見せる・印刷して渡す、に使います。印刷の画面で「PDFに保存」、向きは横、余白はなし、背景のグラフィックはオンにしてください。"
      >
        <form action="/kit/proposal" method="get" className="mt-3 flex flex-col gap-2 sm:flex-row sm:items-end">
          <label className="block flex-1">
            <span className="block text-sm font-bold">表紙の宛名（任意）</span>
            <input
              name="company"
              defaultValue={typeof sp.company === "string" ? sp.company : ""}
              maxLength={40}
              placeholder="例：サンプル運送株式会社"
              className="mt-1 block min-h-11 w-full rounded-lg border border-border bg-card px-3 text-base text-foreground outline-none focus:border-foreground"
            />
          </label>
          <button
            type="submit"
            className="inline-flex min-h-11 items-center justify-center rounded-lg border border-border bg-card px-4 text-sm font-bold text-foreground hover:bg-muted"
          >
            宛名を入れる
          </button>
        </form>
        <SetupWarning className="mt-3" />
      </KitToolbar>

      <div className="kit-paper kit-desk -mx-4 bg-[#e6e6e1] px-3 py-4 sm:mx-0 sm:rounded-card sm:p-5">
        {/* 1. 表紙 */}
        <Slide id="cover" n={1} total={TOTAL}>
          <div className="flex h-full flex-col">
            <div className="flex items-center justify-between gap-3">
              <p className="flex items-center gap-2 font-bold">
                <PlateLogo />
                <span className="text-lg">{SITE.name}</span>
              </p>
              <p className="num text-sm text-muted-foreground">{today}</p>
            </div>

            <div className="mt-8 border-l-8 border-accent pl-4 lg:mt-10 lg:pl-6">
              {to && <p className="text-lg font-bold lg:text-2xl">{to}</p>}
              <p className={cx("text-sm font-bold text-muted-foreground", to && "mt-3")}>
                業務委託ドライバーを使う軽貨物・運送会社さまへのご提案
              </p>
              <h2 className="mt-2 text-[1.6rem] font-bold leading-tight tracking-tight [word-break:auto-phrase] sm:text-[2rem] lg:text-[2.6rem]">
                {tagline}
              </h2>
              <p className="mt-3 max-w-3xl leading-relaxed lg:text-lg">
                支払明細・振込データ・案件別の利益を、今のExcelのルールのまま、御社のアカウントに作ります。
              </p>
            </div>

            <ul className="mt-6 grid gap-2 sm:grid-cols-3 lg:mt-auto print:mt-auto print:grid-cols-3">
              {BENEFITS.map((b) => (
                <li key={b.title} className="rounded-card border border-border p-3">
                  <p className="font-bold leading-snug">{b.title}</p>
                  <p className="mt-1 text-xs leading-snug text-muted-foreground">{b.body}</p>
                </li>
              ))}
            </ul>
            <p className="mt-4 text-sm leading-relaxed">
              <span className="font-bold">
                提案：{SITE.name}
                {info.ownerName ? `　${info.ownerName}` : ""}
              </span>
              <span className="mt-1 block text-muted-foreground">{MAKER}</span>
            </p>
          </div>
        </Slide>

        {/* 2. 月末のお困りごと */}
        <Slide id="pains" n={2} total={TOTAL} kicker="月末のお困りごと" title="月末に、こんなことはありませんか">
          <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 lg:gap-4 print:grid-cols-3">
            {PAINS.map((p, i) => (
              <li key={p.title} className="flex gap-3 rounded-card border border-border p-3 lg:p-5">
                <span
                  aria-hidden
                  className="num inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-plate text-sm font-bold text-plate-foreground lg:h-9 lg:w-9 lg:text-base"
                >
                  {i + 1}
                </span>
                <span>
                  <span className="block font-bold leading-snug lg:text-lg">{p.title}</span>
                  <span className="mt-1 block text-sm leading-snug text-muted-foreground lg:mt-2 lg:text-base">{p.body}</span>
                </span>
              </li>
            ))}
          </ul>
          <p className="mt-5 rounded-card bg-muted p-4 font-bold leading-relaxed lg:mt-8 lg:p-6 lg:text-xl">
            ひとつでも当てはまれば、今のやり方を変えずに、毎月の締めを仕組みにできるかもしれません。
          </p>
        </Slide>

        {/* 3. 期限 */}
        <Slide id="deadlines" n={3} total={TOTAL} kicker="今知っておきたい期限" title="10月からの70%と、フリーランス法">
          <div className="grid gap-4 lg:grid-cols-2 print:grid-cols-2">
            <section aria-labelledby="d70" className="flex flex-col rounded-card border border-border p-4 lg:p-5">
              <p className="flex flex-wrap items-center gap-2">
                <span className="num font-bold">{STEP_70_DATE}</span>
                <span className="rounded bg-muted px-2 text-xs font-bold leading-5">消費税</span>
              </p>
              <h3 id="d70" className="mt-1 text-lg font-bold leading-snug lg:text-xl">
                免税ドライバーへの支払の控除が、80%から70%に
              </h3>
              <p className="mt-1 text-sm leading-snug lg:text-[15px]">
                インボイス未登録（免税）の方への支払は、消費税の一部しか差し引けません。その割合が下がり、会社の負担が増えます（令和8年度税制改正）。
              </p>
              <div className="mt-2">
                <MiniTable
                  dense
                  caption={`例：税込${yenText(EXAMPLE_PAID)}を払ったときの会社の負担（1人・1か月）`}
                  head={[{ label: "期間" }, { label: "控除できる割合" }, { label: "会社の負担", num: true }]}
                  rows={burden.map((b) => [
                    <span key="l" className={cx(b.current && "font-bold")}>
                      {b.label}
                    </span>,
                    b.rateLabel,
                    <span key="v" className={cx(b.current && "font-bold")}>
                      {yenText(b.burden)}
                    </span>,
                  ])}
                />
              </div>
              <p className="mt-2 text-xs leading-snug text-muted-foreground">
                負担が出るのは、消費税を原則課税で計算している会社です。簡易課税・2割特例の会社には出ません。
              </p>
              <p className="mt-auto pt-2 text-[11px] leading-snug text-muted-foreground lg:text-xs">
                出典：{SOURCES.nta.label}
                <span className="block [overflow-wrap:anywhere]">{shortSource(SOURCES.nta.url)}</span>
              </p>
            </section>

            <section aria-labelledby="dfl" className="flex flex-col rounded-card border border-border p-4 lg:p-5">
              <p className="flex flex-wrap items-center gap-2">
                <span className="num font-bold">{FREELANCE.recommendedOn}</span>
                <span className="rounded bg-muted px-2 text-xs font-bold leading-5">フリーランス法</span>
              </p>
              <h3 id="dfl" className="mt-1 text-lg font-bold leading-snug lg:text-xl">
                公正取引委員会が、日本郵便に勧告
              </h3>
              <p className="mt-1 text-sm leading-snug lg:text-[15px]">取引条件を明示していなかったことや、支払の遅れについての勧告です。</p>
              <p className="mt-3 text-sm font-bold lg:mt-5 lg:text-base">フリーランス法（{FREELANCE.enforcedOn}施行）で求められること</p>
              <ul className="mt-1 space-y-1.5 text-sm leading-snug lg:space-y-2.5 lg:text-base">
                <li className="flex gap-2">
                  <span aria-hidden className="font-bold">・</span>
                  <span>
                    個人の業務委託ドライバーに仕事を頼んだら、単価・支払期日などの取引条件を、
                    <strong>すぐに書面かメールなどで明示</strong>する
                  </span>
                </li>
                <li className="flex gap-2">
                  <span aria-hidden className="font-bold">・</span>
                  <span>
                    支払期日は、役務の提供を受けた日から<strong>60日以内</strong>の、できるだけ短い期間で決める
                  </span>
                </li>
              </ul>
              <p className="mt-auto pt-2 text-[11px] leading-snug text-muted-foreground lg:text-xs">
                出典：{SOURCES.jftc.label}
                <span className="block [overflow-wrap:anywhere]">{shortSource(SOURCES.jftc.url)}</span>
                {SOURCES.lnews.label}
                <span className="block [overflow-wrap:anywhere]">{shortSource(SOURCES.lnews.url)}</span>
              </p>
            </section>
          </div>
          <p className="mt-3 text-sm leading-snug lg:mt-4 lg:text-[15px]">
            <span className="font-bold">このほか：</span>
            {SAFETY.deadline}までに、貨物軽自動車安全管理者の選任（2025年3月末までに届出をしていた事業者）。
            <span className="text-muted-foreground">{NOT_ADVICE}</span>
          </p>
        </Slide>

        {/* 4. できること：支払明細と振込データ */}
        <Slide id="statements" n={4} total={TOTAL} kicker="できること①" title="支払明細と振込データを、毎月自動で">
          <p className="-mt-2 mb-3 flex flex-wrap items-center gap-2 text-sm">
            <DemoBadge />
            <span className="text-muted-foreground">
              {data.settings.companyName}・{monthLabel}分（実在の人物・会社ではありません）
            </span>
          </p>
          <div className="grid gap-4 lg:grid-cols-[1fr_1.15fr] print:grid-cols-[1fr_1.15fr]">
            <section aria-labelledby="st-title" className="rounded-card border-2 border-foreground p-3">
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <h3 id="st-title" className="font-bold lg:text-lg">
                  支払明細書（{monthLabel}分）
                </h3>
                <span className="text-xs text-muted-foreground">振込日 {jpDate(data.settings.payDate)}</span>
              </div>
              <p className="mt-1 text-sm">
                <span className="font-bold">{exempt.driver.name} 様</span>
                <span className="ml-2 text-xs text-muted-foreground">
                  {exempt.driver.invoiceRegistered ? `登録番号 ${exempt.driver.registrationNo ?? ""}` : "インボイス未登録（免税）"}
                </span>
              </p>
              <TableWrap>
                <MiniTable
                  className="mt-2"
                  head={[{ label: "案件（元請）" }, { label: "数量", num: true }, { label: "単価", num: true }, { label: "金額", num: true }]}
                  rows={exempt.lines.map((l) => [
                    `${l.projectName}（${l.client}）`,
                    `${l.qty.toLocaleString("ja-JP")}${l.unit}`,
                    yen(l.rate),
                    yen(l.amount),
                  ])}
                />
              </TableWrap>
              <dl className="mt-2 text-[13px] lg:text-sm">
                {[
                  ["委託料（税抜）", exempt.subtotal],
                  [`消費税（${taxRateLabel}）`, exempt.tax],
                  [`ロイヤリティ（${pct(exempt.driver.royaltyRate)}）`, -exempt.royalty],
                  ["管理費", -exempt.fee],
                  ["控除にかかる消費税", -exempt.deductionTax],
                  ...exempt.adjustments.map((a) => [a.label, a.amount] as const),
                ].map(([label, value]) => (
                  <div key={String(label)} className="flex justify-between gap-2 border-b border-border py-0.5 lg:py-1">
                    <dt>{label}</dt>
                    <dd className="num">{yen(Number(value))}</dd>
                  </div>
                ))}
                <div className="flex justify-between gap-2 pt-1 text-sm font-bold lg:text-lg">
                  <dt>振込額</dt>
                  <dd className="num">{yen(exempt.total)}</dd>
                </div>
              </dl>
              {exemptPL && exemptPL.invoiceCost > 0 && (
                <p className="mt-2 rounded bg-muted p-2 text-xs leading-snug lg:text-sm">
                  この方への支払で、会社が控除できない消費税：<span className="num font-bold">{yen(exemptPL.invoiceCost)}</span>
                  （{monthLabel}・控除{demoDeductible}の期間）。会社側の集計にだけ出し、明細には載せません。
                </p>
              )}
            </section>

            <div className="flex min-w-0 flex-col gap-3">
              <section aria-labelledby="tr-title">
                <h3 id="tr-title" className="text-sm font-bold lg:text-base">
                  振込データ（全銀形式・{jpDate(data.settings.payDate)}振込）
                </h3>
                <TableWrap>
                  <MiniTable
                    className="mt-1"
                    head={[{ label: "ドライバー" }, { label: "振込先" }, { label: "振込額", num: true }]}
                    rows={summary.statements.map((s) => [
                      s.driver.name,
                      s.driver.bank ? `${s.driver.bank.bankNameKana} ${s.driver.bank.branchNameKana}` : "—",
                      yen(s.total),
                    ])}
                    foot={["合計", `${summary.statements.length}件`, yen(summary.payout)]}
                  />
                </TableWrap>
              </section>
              <ul className="space-y-1.5 text-sm leading-snug lg:mt-2 lg:space-y-2.5 lg:text-[15px]">
                {FEATURES.slice(0, 2)
                  .concat(FEATURES.slice(3))
                  .map((f) => (
                    <li key={f.title} className="flex gap-2">
                      <span aria-hidden className="mt-1.5 h-2 w-2 shrink-0 rounded-full bg-accent" />
                      <span>
                        <span className="font-bold">{f.title}</span>：{f.body}
                      </span>
                    </li>
                  ))}
              </ul>
            </div>
          </div>
        </Slide>

        {/* 5. できること：利益 */}
        <Slide id="profit" n={5} total={TOTAL} kicker="できること②" title="案件別・元請別・ドライバー別の利益が、毎月見える">
          <p className="-mt-2 mb-3 flex flex-wrap items-center gap-2 text-sm">
            <DemoBadge />
            <span className="text-muted-foreground">
              {data.settings.companyName}・{monthLabel}分（前のページと同じ架空のデータ）
            </span>
          </p>
          <dl className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-5 print:grid-cols-5">
            {[
              { label: "売上", value: summary.sales },
              { label: "委託料", value: summary.cost },
              { label: "ロイヤリティ・管理費", value: summary.royaltyAndFee },
              { label: "控除できない消費税", value: summary.invoiceCost },
              { label: "会社に残る利益", value: summary.profit, strong: true },
            ].map((k) => (
              <div
                key={k.label}
                className={cx("rounded-card p-2.5 lg:p-3.5", k.strong ? "bg-plate text-plate-foreground" : "border border-border")}
              >
                <dt className={cx("text-xs font-bold lg:text-sm", k.strong ? "text-plate-foreground" : "text-muted-foreground")}>{k.label}</dt>
                <dd className="num mt-0.5 text-lg font-bold leading-tight lg:mt-1 lg:text-2xl">
                  {yen(k.value)}
                  {k.strong && summary.margin !== null && <span className="ml-1 text-xs">（{pct(summary.margin)}）</span>}
                </dd>
              </div>
            ))}
          </dl>
          <div className="mt-4 grid gap-4 lg:mt-5 lg:grid-cols-[1.35fr_1fr_1fr] lg:gap-5 print:grid-cols-[1.35fr_1fr_1fr]">
            <TableWrap>
              <MiniTable
                caption="案件別"
                head={[{ label: "案件（元請）" }, { label: "売上", num: true }, { label: "粗利", num: true }, { label: "粗利率", num: true }]}
                rows={summary.projects.map((p) => [
                  `${p.project.name}（${p.project.client}）`,
                  yen(p.sales),
                  yen(p.gross),
                  p.margin === null ? "—" : pct(p.margin),
                ])}
              />
            </TableWrap>
            <TableWrap>
              <MiniTable
                caption="元請別"
                head={[{ label: "元請" }, { label: "売上", num: true }, { label: "粗利", num: true }, { label: "粗利率", num: true }]}
                rows={summary.clients.map((c) => [c.client, yen(c.sales), yen(c.gross), c.margin === null ? "—" : pct(c.margin)])}
              />
            </TableWrap>
            <TableWrap>
              <MiniTable
                caption="ドライバー別"
                head={[{ label: "ドライバー" }, { label: "売上", num: true }, { label: "利益", num: true }]}
                rows={summary.drivers.map((d) => [
                  <span key="n">
                    {d.driver.name}
                    {!d.driver.invoiceRegistered && <span className="ml-1 text-[11px] text-muted-foreground">免税</span>}
                  </span>,
                  yen(d.sales),
                  yen(d.profit),
                ])}
              />
            </TableWrap>
          </div>
          <ul className="mt-4 grid gap-2 sm:grid-cols-2 lg:mt-5 lg:gap-4 print:grid-cols-2">
            {bestProject && bestProject.margin !== null && (
              <li className="rounded-card border-l-4 border-accent bg-muted p-3 text-sm leading-snug lg:text-base">
                粗利率がいちばん高い案件は
                <span className="font-bold">
                  {bestProject.project.name}（{bestProject.project.client}）の{pct(bestProject.margin)}
                </span>
              </li>
            )}
            {summary.invoiceCost > 0 && (
              <li className="rounded-card border-l-4 border-accent bg-muted p-3 text-sm leading-snug lg:text-base">
                免税の方の分の、控除できない消費税は
                <span className="num font-bold">月{yen(summary.invoiceCost)}</span>
                （12か月なら<span className="num">{yen(summary.invoiceCost * 12)}</span>）
              </li>
            )}
          </ul>
          <p className="mt-3 text-xs leading-snug text-muted-foreground lg:text-sm">
            粗利 ＝ 売上 − 委託料。会社に残る利益 ＝ 売上 − 委託料 ＋ ロイヤリティ・管理費 − 免税の方の分の控除できない消費税。数字の出し方は、御社の今の集計に合わせて作ります。
          </p>
        </Slide>

        {/* 6. 料金 */}
        <Slide id="pricing" n={6} total={TOTAL} kicker="料金（税抜）" title="月額は定額。ドライバーは何人でも同じです">
          <div className="grid gap-3 lg:grid-cols-[1fr_1fr_1fr_0.95fr] print:grid-cols-[1fr_1fr_1fr_0.95fr]">
            <ul className="contents">
              {PLANS.map((p) => (
                <PlanCard key={p.id} plan={p} />
              ))}
            </ul>
            <div className="flex flex-col gap-2 text-xs leading-snug">
              <section aria-labelledby="price-notes" className="rounded-card bg-muted p-3">
                <h3 id="price-notes" className="text-sm font-bold">
                  料金について
                </h3>
                <ul className="mt-1 list-disc space-y-0.5 pl-4">
                  <li>表示はすべて税抜です</li>
                  <li>月額は、ドライバーが何人でも同じです</li>
                  <li>サーバー代は御社が直接お支払いください（見積で目安をお示しします）</li>
                  {info.invoiceRegNo && <li className="num">登録番号 {info.invoiceRegNo}</li>}
                </ul>
              </section>
              {OPTIONS.map((o) => (
                <section key={o.id} aria-labelledby={`opt-${o.id}`} className="rounded-card border border-border p-3">
                  <h3 id={`opt-${o.id}`} className="text-sm font-bold">
                    オプション：{o.name}
                  </h3>
                  <p className="num mt-1 font-bold">
                    初期 {yenText(o.initialYen)}・月額 {yenText(o.monthlyYen)}
                  </p>
                  {o.note && <p className="mt-1 text-muted-foreground">{o.note}</p>}
                </section>
              ))}
              <section aria-labelledby="maint" className="rounded-card border border-border p-3">
                <h3 id="maint" className="text-sm font-bold">
                  月額（保守）に含むもの
                </h3>
                <ul className="mt-1 list-disc space-y-0.5 pl-4">
                  {MAINTENANCE_INCLUDES.map((m) => (
                    <li key={m}>{m}</li>
                  ))}
                </ul>
              </section>
            </div>
          </div>
        </Slide>

        {/* 7. 比較 */}
        <Slide id="compare" n={7} total={TOTAL} kicker="ほかの選び方との比較" title="形が合うなら、既製品が一番安い">
          <p className="-mt-1 mb-3 text-sm leading-relaxed lg:mb-4 lg:text-base">
            既製品で足りるなら、そちらをおすすめします。当方が向いているのは、控除が複雑な会社や、元請ごとに締めや明細の形が違う会社です。
          </p>
          {/* スマホ：選び方ごとのカード */}
          <ul className="grid gap-3 md:hidden print:hidden">
            {choices.map((c) => (
              <li key={c.name} className={cx("rounded-card p-3", c.ours ? "border-2 border-foreground" : "border border-border")}>
                <h3 className="font-bold">{c.name}</h3>
                <dl className="mt-1 space-y-1 text-sm">
                  {COMPARISON_CRITERIA.map((k) => (
                    <div key={k.key}>
                      <dt className="text-xs font-bold text-muted-foreground">{k.label}</dt>
                      <dd className="leading-snug">{c.values[k.key]}</dd>
                    </div>
                  ))}
                </dl>
              </li>
            ))}
          </ul>
          {/* タブレット・PC・印刷：表 */}
          <table className="hidden w-full border-collapse text-[13px] leading-snug md:table lg:text-sm print:table">
            <caption className="sr-only">ほかの選び方と{SITE.name}の比較</caption>
            <thead>
              <tr>
                <th scope="col" className="w-32 border-b-2 border-foreground">
                  <span className="sr-only">比べる点</span>
                </th>
                {choices.map((c) => (
                  <th
                    key={c.name}
                    scope="col"
                    className={cx(
                      "border-b-2 border-foreground px-2 py-2 text-left align-bottom font-bold [word-break:auto-phrase] lg:px-3 lg:text-base",
                      c.ours && "bg-accent",
                    )}
                  >
                    {c.name}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {COMPARISON_CRITERIA.map((k) => (
                <tr key={k.key}>
                  <th scope="row" className="border-b border-border py-2 pr-2 text-left align-top text-xs font-bold text-muted-foreground lg:py-3 lg:text-sm">
                    {k.label}
                  </th>
                  {choices.map((c) => (
                    <td key={c.name} className={cx("border-b border-border px-2 py-2 align-top lg:px-3 lg:py-3", c.ours && "bg-muted font-bold")}>
                      {c.values[k.key]}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
          {perHead && perHead.heads > 0 && (
            <p className="mt-3 rounded-card border-l-4 border-accent bg-muted p-3 text-sm leading-snug lg:mt-5 lg:p-4 lg:text-base">
              例：月額{yenText(perHead.monthly)}は、1人月1,000円前後のアプリなら{perHead.heads}人分。当方はドライバーが増えても月額が変わりません。
            </p>
          )}
          <p className="mt-2 text-xs text-muted-foreground">{COMPARISON_NOTE}</p>
        </Slide>

        {/* 8. 導入の流れと安心の仕組み */}
        <Slide id="flow" n={8} total={TOTAL} kicker="導入の流れと安心の仕組み" title="今のExcelと並べて、差がないことを確かめてから">
          <div className="grid gap-4 lg:grid-cols-[1fr_1.1fr] print:grid-cols-[1fr_1.1fr]">
            <section aria-labelledby="flow-steps">
              <h3 id="flow-steps" className="text-sm font-bold lg:text-base">
                導入の流れ
              </h3>
              <ol className="mt-2 space-y-2">
                {steps.map((s, i) => (
                  <li key={s.title} className="flex gap-3 rounded-card border border-border p-2.5 lg:p-3">
                    <span
                      aria-hidden
                      className="num inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-accent text-xs font-bold text-accent-foreground"
                    >
                      {i + 1}
                    </span>
                    <span className="min-w-0">
                      <span className="font-bold lg:text-lg">{s.title}</span>
                      {s.time && <span className="num ml-2 text-xs text-muted-foreground lg:text-sm">{s.time}</span>}
                      <span className="mt-0.5 block text-xs leading-snug lg:text-sm">{s.body}</span>
                    </span>
                  </li>
                ))}
              </ol>
            </section>
            <section aria-labelledby="trust">
              <h3 id="trust" className="text-sm font-bold lg:text-base">
                安心してお任せいただくために
              </h3>
              <ul className="mt-2 grid gap-2 sm:grid-cols-2 lg:gap-3 print:grid-cols-2">
                {TRUST.map((t) => (
                  <li key={t.title} className="rounded-card bg-muted p-2.5 lg:p-3.5">
                    <p className="text-sm font-bold leading-snug lg:text-base">{t.title}</p>
                    <p className="mt-0.5 text-xs leading-snug lg:mt-1 lg:text-sm">{t.body}</p>
                  </li>
                ))}
              </ul>
            </section>
          </div>
        </Slide>

        {/* 9. 次の一歩 */}
        <Slide id="next" n={9} total={TOTAL} kicker="次の一歩" title="まずは、先月分の無料診断から">
          <div className="grid gap-5 lg:grid-cols-[1.25fr_1fr] print:grid-cols-[1.25fr_1fr]">
            <div className="min-w-0">
              <ol className="space-y-2">
                <li className="rounded-card border border-border p-3 lg:p-4">
                  <p className="font-bold lg:text-lg">① 30分のオンライン相談（無料）</p>
                  <p className="mt-0.5 text-sm leading-snug lg:mt-1 lg:text-base">今の締め方・明細の形をうかがい、御社のやり方のまま仕組みにできるかをお伝えします。</p>
                </li>
                <li className="rounded-card border border-border p-3 lg:p-4">
                  <p className="font-bold lg:text-lg">② {FREE_CHECK.title}</p>
                  <p className="mt-0.5 text-sm leading-snug lg:mt-1 lg:text-base">{FREE_CHECK.body}</p>
                </li>
                <li className="rounded-card border border-border p-3 lg:p-4">
                  <p className="font-bold lg:text-lg">③ 決めるのは、それを見てから</p>
                  <p className="mt-0.5 text-sm leading-snug lg:mt-1 lg:text-base">無理にすすめることはしません。合わなければ、既製品をおすすめします。</p>
                </li>
              </ol>
              <p className="mt-3 text-xs leading-snug text-muted-foreground lg:text-sm">{NOT_ADVICE}</p>
            </div>
            <div className="flex min-w-0 flex-col gap-3">
              <div className="grid grid-cols-2 gap-3">
                <figure className="rounded-card border border-border p-3 text-center">
                  <Qr url={contactUrl} label="相談・無料診断のページのQRコード" className="mx-auto w-full max-w-[40mm]" />
                  <figcaption className="mt-2 text-xs font-bold leading-snug">
                    相談・無料診断
                    <span className="block font-normal text-muted-foreground [overflow-wrap:anywhere]">{displayUrl("/contact")}</span>
                  </figcaption>
                </figure>
                <figure className="rounded-card border border-border p-3 text-center">
                  <Qr url={demoUrl} label="デモのページのQRコード" className="mx-auto w-full max-w-[40mm]" />
                  <figcaption className="mt-2 text-xs font-bold leading-snug">
                    デモを触る
                    <span className="block font-normal text-muted-foreground [overflow-wrap:anywhere]">{displayUrl("/demo")}</span>
                  </figcaption>
                </figure>
              </div>
              {CONTACT.bookingUrl && (
                <p className="text-xs leading-snug">
                  <span className="font-bold">日時をすぐ決めるなら：</span>
                  <span className="[overflow-wrap:anywhere]">{CONTACT.bookingUrl}</span>
                </p>
              )}
              <div className="rounded-card border-2 border-foreground p-3 text-sm leading-snug lg:p-4 lg:text-base">
                <SenderBlock />
              </div>
            </div>
          </div>
        </Slide>
      </div>
    </div>
  );
}
