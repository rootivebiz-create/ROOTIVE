import type { Metadata } from "next";
import { PlateLogo } from "@/components/plate-logo";
import { BENEFITS, FEATURES, FREE_CHECK, FREELANCE, STEP_70_DATE } from "@/components/kit/content";
import { displayUrl, kitUrl } from "@/components/kit/format";
import { KitToolbar, PaperStyle } from "@/components/kit/paper";
import { Qr } from "@/components/kit/qr";
import { SenderBlock, SetupWarning } from "@/components/kit/sender";
import { yenText } from "@/lib/format";
import { buildPlans, trialPlan } from "@/lib/plans";
import { OPTIONS, PLANS, SITE } from "@/site.config";

export const metadata: Metadata = {
  title: "ご案内チラシ",
  robots: { index: false, follow: false },
};

const FLYER_CSS = `
@media print {
  .kit-sheet {
    width: auto !important;
    max-width: none !important;
    height: calc(297mm - 1px);
    min-height: 0 !important;
    margin: 0 !important;
    padding: 0 !important;
    border: 0 !important;
    border-radius: 0 !important;
    box-shadow: none !important;
    overflow: hidden;
    break-inside: avoid;
  }
}
`;

function Check() {
  return (
    <svg aria-hidden viewBox="0 0 20 20" className="mt-0.5 h-5 w-5 shrink-0" fill="none">
      <circle cx="10" cy="10" r="9" className="fill-accent" />
      <path d="M6 10.2l2.6 2.6L14 7.4" stroke="#16171a" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export default function FlyerPage() {
  const qrUrl = kitUrl("/", "flyer");
  const trial = trialPlan();
  const hasPacks = buildPlans().length > 0;
  const tagline = SITE.tagline.replace(/。$/, "");

  return (
    <div>
      <PaperStyle orientation="portrait" css={FLYER_CSS} />
      <KitToolbar
        title="紹介チラシ（A4縦・カラー・1枚）"
        hint="同業の知り合いに渡す・LINEでPDFを送る、に使います。印刷の画面で「PDFに保存」、余白はなし、背景のグラフィックはオンにしてください。"
      >
        <SetupWarning className="mt-3" />
      </KitToolbar>

      <div className="kit-paper kit-desk -mx-4 bg-[#e6e6e1] px-3 py-4 sm:mx-0 sm:rounded-card sm:p-5">
        <article
          aria-label="紹介チラシ"
          className="kit-sheet mx-auto flex w-full max-w-[210mm] flex-col overflow-hidden rounded-card bg-white text-foreground shadow-sm md:min-h-[297mm] print:rounded-none"
        >
          {/* 上の帯（黒ナンバーの色） */}
          <header className="bg-plate px-5 py-5 text-white sm:px-8 md:px-[12mm] md:py-[6mm] print:px-[12mm] print:py-[6mm]">
            <p className="flex items-center gap-2 font-bold text-plate-foreground">
              <PlateLogo />
              <span className="text-lg">{SITE.name}</span>
              <span className="ml-auto text-xs font-bold text-white/80">軽貨物・運送会社の社長さんへ</span>
            </p>
            <h2 className="mt-3 text-[1.6rem] font-bold leading-tight tracking-tight text-plate-foreground [word-break:auto-phrase] sm:text-[2rem] md:text-[2.2rem] print:text-[2.2rem]">
              {tagline}
            </h2>
            <p className="mt-2 leading-snug text-white md:text-[17px] print:text-[17px]">
              支払明細・振込データ・案件別の利益を、今のExcelのルールのまま、御社のアカウントに作ります。
            </p>
            <p className="mt-2 text-sm leading-snug text-white/85">
              作っているのは、同じ軽貨物の運送会社を経営している本人です。自分の会社でも同じような仕組みを毎月使っています。その経験をもとに、御社のやり方に合わせて作ります。
            </p>
          </header>

          <div className="flex flex-1 flex-col px-5 py-5 sm:px-8 md:px-[12mm] md:py-[6mm] print:px-[12mm] print:py-[6mm]">
            {/* できること */}
            <section aria-labelledby="fl-features">
              <h3 id="fl-features" className="text-base font-bold md:text-lg print:text-lg">
                できること
              </h3>
              <ul className="mt-1.5 grid gap-x-4 gap-y-2 sm:grid-cols-2 print:grid-cols-2">
                {FEATURES.map((f) => (
                  <li key={f.title} className="flex gap-2 leading-snug">
                    <Check />
                    <span>
                      <span className="block font-bold">{f.title}</span>
                      <span className="block text-xs text-muted-foreground">{f.short}</span>
                    </span>
                  </li>
                ))}
              </ul>
            </section>

            {/* 3 つのよいところ */}
            <section aria-labelledby="fl-benefits" className="mt-3">
              <h3 id="fl-benefits" className="text-base font-bold md:text-lg print:text-lg">
                3つの特長
              </h3>
              <ol className="mt-1.5 grid gap-2 sm:grid-cols-3 print:grid-cols-3">
                {BENEFITS.map((b, i) => (
                  <li key={b.title} className="rounded-card border-2 border-plate p-2.5">
                    <p className="flex items-center gap-2 font-bold leading-snug">
                      <span
                        aria-hidden
                        className="num inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-accent text-sm font-bold text-accent-foreground"
                      >
                        {i + 1}
                      </span>
                      {/* 「、」のあとで折り返す（「御社のも／の」のように途中で切れないように） */}
                      <span className="min-w-0">
                        {b.title.split(/(?<=、)/).map((part) => (
                          <span key={part} className="inline-block">
                            {part}
                          </span>
                        ))}
                      </span>
                    </p>
                    <p className="mt-1 text-xs leading-snug text-muted-foreground">{b.short}</p>
                  </li>
                ))}
              </ol>
            </section>

            {/* 料金 */}
            <section aria-labelledby="fl-price" className="mt-3">
              <h3 id="fl-price" className="text-base font-bold md:text-lg print:text-lg">
                料金（税抜）
              </h3>
              <div className="mt-1 overflow-x-auto">
                <table className="w-full border-collapse text-sm">
                  <thead>
                    <tr className="text-xs text-muted-foreground">
                      <th scope="col" className="border-b-2 border-plate py-1 pr-2 text-left font-bold">
                        メニュー
                      </th>
                      <th scope="col" className="border-b-2 border-plate px-2 py-1 text-right font-bold whitespace-nowrap">
                        初期費用
                      </th>
                      <th scope="col" className="border-b-2 border-plate px-2 py-1 text-right font-bold">
                        月額
                      </th>
                      <th scope="col" className="border-b-2 border-plate py-1 pl-2 text-right font-bold whitespace-nowrap">
                        期間
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {PLANS.map((p) => (
                      <tr key={p.id} className={p.featured ? "bg-accent/25" : undefined}>
                        <th scope="row" className="border-b border-border py-1 pr-2 text-left font-bold leading-snug">
                          {p.name}
                          {p.featured && <span className="ml-1 text-xs font-bold">（おすすめ）</span>}
                        </th>
                        <td className="num border-b border-border px-2 py-1 text-right whitespace-nowrap">{yenText(p.initialYen)}</td>
                        <td className="num border-b border-border px-2 py-1 text-right whitespace-nowrap">
                          {p.monthlyYen > 0 ? yenText(p.monthlyYen) : "なし"}
                        </td>
                        <td className="border-b border-border py-1 pl-2 text-right whitespace-nowrap">{p.weeks}</td>
                      </tr>
                    ))}
                    {OPTIONS.map((o) => (
                      <tr key={o.id}>
                        <th scope="row" className="border-b border-border py-1 pr-2 text-left text-xs font-bold leading-snug">
                          {o.name}
                        </th>
                        <td className="num border-b border-border px-2 py-1 text-right whitespace-nowrap">{yenText(o.initialYen)}</td>
                        <td className="num border-b border-border px-2 py-1 text-right whitespace-nowrap">{yenText(o.monthlyYen)}</td>
                        <td className="border-b border-border py-1 pl-2 text-right text-xs">追加</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <p className="mt-1 text-xs leading-snug text-muted-foreground">
                {hasPacks ? "月額はドライバーが何人でも同じ。" : ""}
                サーバー代は御社が直接お支払いください（見積で目安をお示しします）。
                {trial?.note ? trial.note : ""}
              </p>
            </section>

            {/* 期限 */}
            <p className="mt-3 rounded-card bg-plate px-3 py-2 text-[13px] font-bold leading-snug text-white">
              <span className="text-plate-foreground">{STEP_70_DATE}から</span>、免税ドライバーへの支払の控除は80%→70%。
              <span className="text-plate-foreground">{FREELANCE.recommendedOn}</span>には、日本郵便がフリーランス法で勧告を受けました。
            </p>

            {/* 相談と差出人 */}
            <footer className="mt-3 grid gap-4 sm:grid-cols-[auto_1fr] md:mt-auto print:mt-auto print:grid-cols-[auto_1fr]">
              <figure className="mx-auto flex w-[32mm] flex-col items-center sm:mx-0 print:mx-0">
                <Qr url={qrUrl} label={`${SITE.name}のサイトのQRコード`} className="w-full" />
                <figcaption className="mt-1 text-center text-[11px] leading-tight [overflow-wrap:anywhere]">{displayUrl("/")}</figcaption>
              </figure>
              <div className="min-w-0">
                <p className="font-bold leading-snug">まずは30分の無料相談と、{FREE_CHECK.title}から</p>
                <p className="mt-1 text-xs leading-snug text-muted-foreground">
                  QRコードからデモも触れます。無理にすすめることはしません。お知り合いの会社にも、このチラシを渡していただけるとうれしいです。
                </p>
                <div className="mt-2 rounded-card border border-border p-2.5 text-xs leading-snug">
                  <SenderBlock wide />
                </div>
              </div>
            </footer>
            <p className="mt-2 text-[10px] leading-snug text-muted-foreground">
              税務・法律の最終的な判断は、税理士・弁護士・社労士にご確認ください。
            </p>
          </div>
        </article>
      </div>
    </div>
  );
}
