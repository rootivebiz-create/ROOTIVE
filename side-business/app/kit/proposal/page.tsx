import type { Metadata } from "next";
import { TableWrap } from "@/components/ui";
import { PlateLogo } from "@/components/plate-logo";
import {
  BENEFITS,
  DEMO_COMPANY,
  DEMO_MONTH_LABEL,
  ENOUGH,
  EXAMPLE_PAID,
  FREELANCE,
  LEAD,
  MAKER,
  NOT_ADVICE,
  PAINS,
  SAFETY,
  SOURCES,
  STATEMENT_EXAMPLE,
  STEP_70,
  STEP_70_CHANGE,
  STEP_70_DATE,
  TRIAL_DELIVERABLES,
  TRUST,
  burdenExample,
  flowSteps,
  leadOffer,
  parallelExample,
  PARALLEL_EXAMPLE,
  reconcileExample,
  ratePct,
  reconcileLetterLine,
  shortSource,
  signedYen,
  statementExampleTotal,
  watchExample,
} from "@/components/kit/content";
import { addressee, displayUrl, kitUrl, productDemoUrl, shortUrl } from "@/components/kit/format";
import { KitToolbar, PaperStyle } from "@/components/kit/paper";
import { Qr } from "@/components/kit/qr";
import { SenderBlock, SetupWarning } from "@/components/kit/sender";
import { DemoBadge, MiniTable, Slide } from "@/components/kit/slide";
import { cx } from "@/lib/cx";
import { jpToday, yenText } from "@/lib/format";
import { trialOffer } from "@/lib/plans";
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
        <PriceLine label={oneOff ? "期間の目安" : "立ち上げの目安"} value={plan.weeks} />
      </dl>
      <ul className="mt-2 list-disc space-y-0.5 pl-4 text-[11px] leading-snug">
        {plan.includes.map((item) => (
          <li key={item}>{item}</li>
        ))}
      </ul>
      {plan.note && <p className="mt-2 rounded bg-muted p-2 text-xs leading-snug">{plan.note}</p>}
    </li>
  );
}

/** 見張り番の重さの札（赤・黄・お知らせ）。紙でも読めるよう、色だけに頼らず文字で書く */
function LevelTag({ level }: { level: string }) {
  return (
    <span
      className={cx(
        "inline-flex h-5 min-w-10 shrink-0 items-center justify-center rounded px-1.5 text-[11px] font-bold leading-none",
        level === "赤" ? "bg-danger text-white" : level === "黄" ? "bg-accent text-accent-foreground" : "border border-foreground",
      )}
    >
      {level}
    </span>
  );
}

export default async function ProposalPage({ searchParams }: Props) {
  const sp = await searchParams;
  const to = addressee(sp.company);
  const info = businessInfo();
  const today = jpToday();

  const rec = reconcileExample();
  const recFirst = rec.lines.find((l) => l.diff !== 0) ?? rec.lines[0];
  const par = parallelExample();
  const watch = watchExample();
  const payout = statementExampleTotal();

  const burden = burdenExample();
  const steps = flowSteps();
  const trial = trialOffer();
  const contactUrl = kitUrl("/contact", "proposal");
  const productDemo = productDemoUrl();
  const demoQrUrl = productDemo ?? kitUrl("/demo", "proposal");

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
              className="mt-1 block min-h-11 w-full rounded-lg border border-border bg-card px-3 text-base text-foreground focus:border-foreground"
            />
          </label>
          <button
            type="submit"
            className="inline-flex min-h-11 items-center justify-center rounded-lg border border-border bg-card px-4 text-sm font-bold text-foreground hover:bg-muted"
          >
            宛名を入れる
          </button>
        </form>
        {!productDemo && (
          <p className="mt-3 rounded-card border border-border bg-card p-3 text-sm leading-relaxed">
            製品のデモの URL（<code className="break-all rounded bg-muted px-1 text-xs">NEXT_PUBLIC_PRODUCT_DEMO_URL</code>
            ）が入っていないため、最後のページの QR は「計算のデモ（ブラウザだけ）」を指します。
          </p>
        )}
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
                {LEAD.question}
                <span className="block">{leadOffer()}</span>
              </h2>
              <p className="mt-3 max-w-3xl leading-relaxed lg:text-lg">{LEAD.what}</p>
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
            ひとつでも当てはまれば、今のExcelを変えずに、先月分で確かめてみませんか。
          </p>
        </Slide>

        {/* 3. 元請の支払通知との突合（いちばんの見せ場） */}
        <Slide id="reconcile" n={3} total={TOTAL} kicker="できること①　元請の支払通知との突合" title="元請の支払通知を、自社の記録で確かめます">
          <p className="-mt-2 mb-3 flex flex-wrap items-center gap-2 text-sm">
            <DemoBadge />
            <span className="text-muted-foreground">
              製品のデモ：{DEMO_COMPANY}・{rec.client}の{DEMO_MONTH_LABEL}（実在の会社ではありません）
            </span>
          </p>
          <div className="grid gap-4 lg:grid-cols-[1.35fr_1fr] print:grid-cols-[1.35fr_1fr]">
            <div className="min-w-0">
              <TableWrap>
                <MiniTable
                  head={[{ label: "案件" }, { label: "自社の記録", num: true }, { label: "お支払通知", num: true }, { label: "差", num: true }]}
                  rows={rec.lines.map((l) => [
                    <span key="p">
                      <span className="block font-bold">{l.project}</span>
                      <span className="block text-xs text-muted-foreground">{l.kind}</span>
                    </span>,
                    <span key="o">
                      <span className="block text-xs text-muted-foreground">
                        {l.ours.qty.toLocaleString("ja-JP")}
                        {l.unit} × {yenText(l.ours.price)}
                      </span>
                      <span className="block">{yenText(l.ourAmount)}</span>
                    </span>,
                    <span key="t">
                      <span className="block text-xs text-muted-foreground">
                        {l.theirs.qty.toLocaleString("ja-JP")}
                        {l.unit} × {yenText(l.theirs.price)}
                      </span>
                      <span className="block">{yenText(l.theirAmount)}</span>
                    </span>,
                    <span key="d" className={cx(l.diff !== 0 && "font-bold")}>
                      {signedYen(l.diff)}
                    </span>,
                  ])}
                />
              </TableWrap>
              <p className="mt-3 rounded-card bg-plate p-3 text-plate-foreground lg:p-4">
                <span className="block text-sm font-bold text-white">受け取りが少ない可能性</span>
                <span className="num text-2xl font-bold lg:text-3xl">{yenText(rec.short)}</span>
                <span className="ml-2 text-sm text-white">（{rec.shortCount}件）</span>
              </p>
            </div>
            <div className="flex min-w-0 flex-col gap-3">
              <section aria-labelledby="letter" className="rounded-card border-2 border-foreground p-3">
                <h3 id="letter" className="text-sm font-bold lg:text-base">
                  問い合わせ文の下書き（抜粋）
                </h3>
                <p className="mt-1 text-sm leading-relaxed">{reconcileLetterLine(recFirst)}。お手数ですが、ご確認をお願いできますでしょうか。</p>
              </section>
              <ul className="space-y-1.5 text-sm leading-snug lg:space-y-2.5 lg:text-[15px]">
                {[
                  "通知のExcel・CSVを置くと、案件ごとに数量・単価の違いを金額で出します",
                  "送るかどうかは御社が決めます。責める言葉は使わず、確認のお願いにします",
                  "問い合わせ済み・解決・了承（理由のメモ）で、返事を追いかけられます",
                  "差がいくらになるかは会社によって違います。だから、御社の先月分で測ります",
                ].map((t) => (
                  <li key={t} className="flex gap-2">
                    <span aria-hidden className="mt-1.5 h-2 w-2 shrink-0 rounded-full bg-accent" />
                    <span>{t}</span>
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </Slide>

        {/* 4. 期限 */}
        <Slide id="deadlines" n={4} total={TOTAL} kicker="今知っておきたい期限" title={`10月からの${ratePct(STEP_70.rate)}と、フリーランス法`}>
          <div className="grid gap-4 lg:grid-cols-2 print:grid-cols-2">
            <section aria-labelledby="d70" className="flex flex-col rounded-card border border-border p-4 lg:p-5">
              <p className="flex flex-wrap items-center gap-2">
                <span className="num font-bold">{STEP_70_DATE}</span>
                <span className="rounded bg-muted px-2 text-xs font-bold leading-5">消費税</span>
              </p>
              <h3 id="d70" className="mt-1 text-lg font-bold leading-snug lg:text-xl">
                免税ドライバーへの支払の{STEP_70_CHANGE}に
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
              <p className="mt-3 text-sm leading-snug lg:text-[15px]">
                しめ日ラボの見張り番は、取引条件の記録・支払期日・免税の方の分の負担を、締める前に記録からお知らせします（6枚目）。
              </p>
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

        {/* 5. Excel をそのまま → 今の Excel と比べてから切り替え */}
        <Slide id="parallel" n={5} total={TOTAL} kicker="できること②　取り込みと並行運用" title="今のExcelのまま置いて、1人ずつ比べてから切り替え">
          <div className="grid gap-4 lg:grid-cols-[1fr_1.25fr] print:grid-cols-[1fr_1.25fr]">
            <section aria-labelledby="import-title">
              <h3 id="import-title" className="text-sm font-bold lg:text-base">
                Excelをそのまま取り込み
              </h3>
              <ul className="mt-2 space-y-1.5 text-sm leading-snug lg:space-y-2.5 lg:text-[15px]">
                {[
                  "今のExcel・CSVを、形を変えずに置くだけ。1人1枚の表や○・休の表も読めます（お試しで実物のファイルを先に確かめます）",
                  "日付が横に並んだ表や、合計の行があっても読みます。ファイルの合計と照らし合わせます",
                  "一度読んだ形と、名前の表記ゆれ（全角・半角・カナ）は覚えます",
                  "同じファイルを2回置いても、数量は倍になりません。締めるまでは取り消せます",
                ].map((t) => (
                  <li key={t} className="flex gap-2">
                    <span aria-hidden className="mt-1.5 h-2 w-2 shrink-0 rounded-full bg-accent" />
                    <span>{t}</span>
                  </li>
                ))}
              </ul>
            </section>
            <section aria-labelledby="parallel-title" className="min-w-0">
              <h3 id="parallel-title" className="flex flex-wrap items-center gap-2 text-sm font-bold lg:text-base">
                今のExcelと1人ずつ比べる
                <DemoBadge>製品のデモ（架空）</DemoBadge>
              </h3>
              <TableWrap>
                <MiniTable
                  className="mt-2"
                  head={[{ label: "ドライバー" }, { label: "Excel", num: true }, { label: "しめ日ラボ", num: true }, { label: "差", num: true }, { label: "原因の候補" }]}
                  rows={PARALLEL_EXAMPLE.map((r) => [
                    r.name,
                    yenText(r.excel),
                    yenText(r.ours),
                    signedYen(r.ours - r.excel),
                    r.reason ?? "一致",
                  ])}
                />
              </TableWrap>
              <p className="mt-2 text-sm leading-snug lg:text-[15px]">
                {par.total}人中{par.matched}人が一致。差には「原因の候補」を付けます（断定はしません。どちらに合わせるかは御社が決めます）。
              </p>
              <p className="mt-3 rounded-card border-l-4 border-accent bg-muted p-3 text-sm font-bold leading-snug lg:text-base">
                全員が一致するか、差のある人の理由が分かるまで、本番に切り替えません。比べた結果は、印刷できる報告1枚になります。
              </p>
            </section>
          </div>
        </Slide>

        {/* 6. ドライバーの明細と、締め前の見張り番 */}
        <Slide id="statements" n={6} total={TOTAL} kicker="できること③　明細と見張り番" title="ドライバーが納得する明細と、締める前の見張り番">
          <div className="grid gap-4 lg:grid-cols-[0.85fr_1.15fr] print:grid-cols-[0.85fr_1.15fr]">
            <section aria-labelledby="phone" className="min-w-0">
              <h3 id="phone" className="flex flex-wrap items-center gap-2 text-sm font-bold lg:text-base">
                ドライバーのスマホに出る明細
                <DemoBadge>架空</DemoBadge>
              </h3>
              <div className="mx-auto mt-2 max-w-[80mm] rounded-[1.25rem] border-2 border-foreground p-3 text-[12px] leading-snug">
                <p className="text-muted-foreground">{STATEMENT_EXAMPLE.driver} 様・10月分</p>
                <p className="mt-0.5 font-bold">
                  振込額 <span className="num text-xl">{yenText(payout)}</span>
                </p>
                <dl className="mt-1.5">
                  {[...STATEMENT_EXAMPLE.lines, ...STATEMENT_EXAMPLE.deductions, ...STATEMENT_EXAMPLE.adjustments].map((l) => (
                    <div key={l.label} className="flex justify-between gap-2 border-b border-border py-0.5">
                      <dt>{l.label}</dt>
                      <dd className="num whitespace-nowrap">{signedYen(l.amount)}</dd>
                    </div>
                  ))}
                </dl>
                <p className="mt-2 rounded-lg bg-foreground py-1.5 text-center font-bold text-background">内容を確認しました</p>
                <p className="mt-1 text-center text-muted-foreground">明細の行ごとに質問できます</p>
              </div>
              <ul className="mt-2 space-y-1 text-xs leading-snug lg:text-sm">
                <li>・リンクを押すだけ。アプリもパスワードも要りません</li>
                <li>・「確認しました」の日時と、行ごとの質問と返事が残ります</li>
                <li>・明細を仕入明細書として使うときの、相手方の確認の記録として使える形です（国税庁 Q&A 問86 の方法に沿う。最終的な判断は税理士と）</li>
              </ul>
            </section>
            <section aria-labelledby="watch" className="min-w-0">
              <h3 id="watch" className="flex flex-wrap items-center gap-2 text-sm font-bold lg:text-base">
                締め前の見張り番（製品のデモの10月分から）
                <DemoBadge>架空</DemoBadge>
              </h3>
              <ul className="mt-2 space-y-2">
                {watch.map((w) => (
                  <li key={w.title} className="flex gap-2 rounded-card border border-border p-2.5 lg:p-3">
                    <LevelTag level={w.level} />
                    <span className="min-w-0 text-sm leading-snug lg:text-[15px]">
                      <span className="block font-bold">{w.title}</span>
                      <span className="block">{w.detail}</span>
                      {w.basis && <span className="block text-xs text-muted-foreground">根拠：{w.basis}</span>}
                    </span>
                  </li>
                ))}
              </ul>
              <p className="mt-3 rounded-card bg-muted p-3 text-sm font-bold leading-snug lg:text-base">
                出すのは、記録から分かる事実と根拠だけです。「違反です」とは言いません。直すかどうかは御社が決め、理由のメモを残せます。
              </p>
            </section>
          </div>
        </Slide>

        {/* 7. 料金 */}
        <Slide id="pricing" n={7} total={TOTAL} kicker="料金（税抜）" title="月額は定額。ドライバーは何人でも同じです">
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
                  <li>サーバー代（置き場所とデータベース）は、御社名義で契約し、御社が直接お支払いください（見積で目安をお示しします）</li>
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

        {/* 8. 今の道具で十分では？ と、導入の流れ */}
        <Slide id="flow" n={8} total={TOTAL} kicker="よくいただくご質問と、導入の流れ" title={ENOUGH.title}>
          <div className="grid gap-4 lg:grid-cols-[1.1fr_1fr] print:grid-cols-[1.1fr_1fr]">
            <section aria-labelledby="enough">
              <h3 id="enough" className="text-sm leading-snug lg:text-base">
                {ENOUGH.lead}
              </h3>
              <ul className="mt-2 grid gap-2 sm:grid-cols-2 lg:gap-3 print:grid-cols-2">
                {ENOUGH.items.map((t) => (
                  <li key={t.title} className="rounded-card bg-muted p-2.5 lg:p-3.5">
                    <p className="text-sm font-bold leading-snug lg:text-base">{t.title}</p>
                    <p className="mt-0.5 text-xs leading-snug lg:mt-1 lg:text-sm">{t.body}</p>
                  </li>
                ))}
              </ul>
              <p className="mt-2 text-sm font-bold leading-snug lg:text-base">{ENOUGH.close}</p>
              <ul className="mt-3 grid gap-x-3 gap-y-1 text-xs leading-snug sm:grid-cols-2 lg:text-sm print:grid-cols-2">
                {TRUST.map((t) => (
                  <li key={t.title}>
                    <span className="font-bold">{t.title}：</span>
                    {t.body}
                  </li>
                ))}
              </ul>
            </section>
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
          </div>
        </Slide>

        {/* 9. 次の一歩：いちばん上は有料の「先月分でお試し」。相談の予約はその下に小さく */}
        <Slide
          id="next"
          n={9}
          total={TOTAL}
          kicker="次の一歩"
          title={trial ? `まずは、${trial.name}（${trial.weeks}）` : "まずは、30分の無料相談から"}
        >
          <div className="grid gap-5 lg:grid-cols-[1.25fr_1fr] print:grid-cols-[1.25fr_1fr]">
            <div className="min-w-0">
              {trial ? (
                <section aria-labelledby="next-trial" className="rounded-card border-2 border-foreground p-3 lg:p-5">
                  <h3 id="next-trial" className="text-lg font-bold leading-snug lg:text-2xl">
                    {trial.name}
                  </h3>
                  <dl className="mt-2 grid grid-cols-2 gap-2">
                    <div className="rounded-card bg-muted p-2 lg:p-3">
                      <dt className="text-xs text-muted-foreground lg:text-sm">費用（1回）</dt>
                      <dd className="num font-bold lg:text-xl">{trial.price}</dd>
                    </div>
                    <div className="rounded-card bg-muted p-2 lg:p-3">
                      <dt className="text-xs text-muted-foreground lg:text-sm">期間の目安</dt>
                      <dd className="num font-bold lg:text-xl">{trial.weeks}</dd>
                    </div>
                  </dl>
                  <p className="mt-2 rounded-card bg-accent px-3 py-2 text-sm font-bold leading-snug text-accent-foreground lg:text-base">
                    {trial.credit}
                  </p>
                  <p className="mt-2 text-sm leading-snug lg:text-base">
                    先月の稼働のExcel・今の振込額・元請の支払通知をお預かりし（ドライバーの名前は番号に）、次の4つをお渡しします。
                  </p>
                  <ul className="mt-1.5 grid gap-1.5 sm:grid-cols-2 print:grid-cols-2">
                    {TRIAL_DELIVERABLES.map((d) => (
                      <li key={d.title} className="rounded-card border border-border p-2 text-xs leading-snug lg:text-sm">
                        <span className="block font-bold">{d.title}</span>
                        {d.body}
                      </li>
                    ))}
                  </ul>
                </section>
              ) : null}
              <p className={cx("text-sm leading-snug lg:text-base", trial && "mt-3")}>
                <span className="font-bold">30分の無料相談</span>
                ：今の締め方をうかがい、合うかどうかを正直にお伝えします。合わなければ、今のままをおすすめします。
              </p>
              <p className="mt-2 text-xs leading-snug text-muted-foreground lg:text-sm">{NOT_ADVICE}</p>
            </div>
            <div className="flex min-w-0 flex-col gap-3">
              <div className="grid grid-cols-2 gap-3">
                <figure className="rounded-card border border-border p-3 text-center">
                  <Qr url={contactUrl} label="お申し込み・相談のページのQRコード" className="mx-auto w-full max-w-[40mm]" />
                  <figcaption className="mt-2 text-xs font-bold leading-snug">
                    {trial ? "お試し・相談の申し込み" : "相談の申し込み"}
                    <span className="block font-normal text-muted-foreground [overflow-wrap:anywhere]">{displayUrl("/contact")}</span>
                  </figcaption>
                </figure>
                <figure className="rounded-card border border-border p-3 text-center">
                  <Qr url={demoQrUrl} label={productDemo ? "製品のデモのQRコード" : "計算のデモのページのQRコード"} className="mx-auto w-full max-w-[40mm]" />
                  <figcaption className="mt-2 text-xs font-bold leading-snug">
                    {productDemo ? "製品のデモを触る（架空の会社）" : "計算のデモ（ブラウザだけ）"}
                    <span className="block font-normal text-muted-foreground [overflow-wrap:anywhere]">
                      {productDemo ? shortUrl(productDemo) : displayUrl("/demo")}
                    </span>
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
