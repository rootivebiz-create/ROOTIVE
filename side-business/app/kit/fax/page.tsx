import type { Metadata } from "next";
import Link from "next/link";
import type { ReactNode } from "react";
import { LEAD, shortSource } from "@/components/kit/content";
import { makerCopy } from "@/components/kit/maker";
import { FAX_HOOK_IDS, faxHook, faxHookHref, parseFaxHook } from "@/components/kit/fax-hooks";
import { displayUrl, kitUrl } from "@/components/kit/format";
import { KitToolbar, PaperStyle } from "@/components/kit/paper";
import { Qr } from "@/components/kit/qr";
import { SenderBlock, SetupWarning, stopContact } from "@/components/kit/sender";
import { cx } from "@/lib/cx";
import { priceSummary } from "@/lib/plans";
import { SITE } from "@/site.config";

type Props = { searchParams: Promise<Record<string, string | string[] | undefined>> };

/** タイトルは「PDFに保存」したときのファイル名にもなるので、きっかけを入れる */
export async function generateMetadata({ searchParams }: Props): Promise<Metadata> {
  const hook = faxHook(parseFaxHook((await searchParams).hook));
  return {
    title: `FAXのご案内（${hook.name}）`,
    robots: { index: false, follow: false },
  };
}

/** 印刷では A4 縦 1 枚ちょうど。はみ出した分は切れる（2 枚目を作らない） */
const FAX_CSS = `
@media print {
  .kit-sheet {
    width: auto !important;
    max-width: none !important;
    height: calc(297mm - 1px);
    min-height: 0 !important;
    margin: 0 !important;
    padding: 10mm 12mm 8mm !important;
    border: 0 !important;
    box-shadow: none !important;
    overflow: hidden;
    break-inside: avoid;
  }
}
`;

/** 見出しの日付（2027年3月31日・9月2日）と（控除80%→70%）は、途中で折り返さない */
function keepTogether(text: string): ReactNode[] {
  return text
    .split(/(\d{4}年\d{1,2}月\d{1,2}日|\d{1,2}月\d{1,2}日|（[^）]{1,16}）)/)
    .map((part, i) => (i % 2 === 1 ? <span key={i} className="whitespace-nowrap">{part}</span> : part));
}

export default async function FaxPage({ searchParams }: Props) {
  const sp = await searchParams;
  const hook = faxHook(parseFaxHook(sp.hook));
  const qrUrl = kitUrl(hook.qrPath, "fax", undefined, hook.id);
  const stop = stopContact();
  const price = priceSummary();

  return (
    <div>
      <PaperStyle orientation="portrait" css={FAX_CSS} />
      <KitToolbar
        title="FAX DM（A4縦・白黒・1枚）"
        hint="FAX DM の業者にPDFで入稿するか、そのまま印刷して送ります。白と黒だけで作ってあります。送る前に、自分あてに1枚送って、文字とQRコードが読めるか確かめてください。"
      >
        <nav aria-label="きっかけを選ぶ" className="mt-3">
          <p className="text-sm font-bold">きっかけ（見出し）を選ぶ</p>
          <ul className="mt-1 flex flex-col gap-2 sm:flex-row sm:flex-wrap">
            {FAX_HOOK_IDS.map((id) => {
              const h = faxHook(id);
              const current = id === hook.id;
              return (
                <li key={id}>
                  <Link
                    href={faxHookHref(id)}
                    aria-current={current ? "page" : undefined}
                    className={cx(
                      "flex min-h-11 items-center rounded-lg border px-3 text-sm font-bold no-underline",
                      current ? "border-foreground bg-foreground text-background!" : "border-border bg-card text-foreground!",
                    )}
                  >
                    {h.name}
                  </Link>
                </li>
              );
            })}
          </ul>
          <p className="mt-2 text-sm text-muted-foreground">送るとよい時期：{hook.when}</p>
        </nav>
        <SetupWarning className="mt-3" />
      </KitToolbar>

      <div className="kit-paper kit-desk -mx-4 bg-[#e6e6e1] px-3 py-4 sm:mx-0 sm:rounded-card sm:p-5">
        <article
          aria-label="FAX DM の原稿"
          className="kit-sheet mx-auto flex w-full max-w-[210mm] flex-col border border-black bg-white p-4 text-[15px] leading-normal text-black shadow-sm sm:p-8 md:min-h-[297mm] md:p-[12mm]"
        >
          {/* 宛先と差出人 */}
          <header className="flex flex-col-reverse gap-2 border-b-2 border-black pb-2 sm:flex-row sm:items-start sm:justify-between sm:gap-3 print:flex-row print:items-start print:justify-between">
            <p className="text-sm font-bold leading-snug [word-break:auto-phrase]">
              業務委託ドライバーを使っている
              <br className="hidden sm:inline print:inline" />
              軽貨物・運送会社の社長さまへ
            </p>
            <p className="flex shrink-0 items-center gap-1.5 text-base font-bold">
              <span aria-hidden className="inline-flex h-7 min-w-9 items-center justify-center rounded border-2 border-black bg-black px-1 text-sm text-white">
                締
              </span>
              {SITE.name}
            </p>
          </header>

          {/* 見出し */}
          <p className="mt-4">
            <span className="inline-block bg-black px-2 py-0.5 text-sm font-bold text-white">{hook.badge}</span>
          </p>
          <h2 className="mt-2 text-[24px] font-bold leading-tight tracking-tight [word-break:auto-phrase] sm:text-[30px] md:text-[34px] print:text-[34px]">
            {keepTogether(hook.headline)}
          </h2>

          {/* 3 つの要点 */}
          <ol className="mt-4 space-y-2.5 md:mt-5 md:space-y-3">
            {hook.bullets.map((b, i) => (
              <li key={b} className="flex gap-2.5 leading-snug md:text-[17px] print:text-[17px]">
                <span
                  aria-hidden
                  className="num mt-0.5 inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-black text-sm font-bold text-white"
                >
                  {i + 1}
                </span>
                <span>{b}</span>
              </li>
            ))}
          </ol>

          {/* 無料のご案内と QR */}
          <section
            aria-labelledby="fax-offer"
            className="mt-5 grid gap-4 border-[3px] border-black p-4 sm:grid-cols-[1fr_auto] md:mt-6 print:grid-cols-[1fr_auto]"
          >
            <div>
              <h3 id="fax-offer" className="text-lg font-bold leading-snug md:text-xl print:text-xl">
                {hook.offerHeading}
              </h3>
              <ul className="mt-2 space-y-2 leading-snug">
                {hook.offers.map((o) => (
                  <li key={o.title}>
                    <span className="font-bold">■ {o.title}</span>
                    <span className="mt-0.5 block text-[14px] md:text-[15px]">{o.body}</span>
                  </li>
                ))}
              </ul>
            </div>
            <figure className="mx-auto flex w-[46mm] flex-col items-center sm:mx-0 print:mx-0">
              <Qr url={qrUrl} label={`${hook.qrTitle}のQRコード`} className="w-[44mm]" />
              <figcaption className="mt-0.5 text-center text-[12px] font-bold leading-tight [overflow-wrap:anywhere]">
                スマホで読み取り
                <span className="block font-normal">{displayUrl(hook.qrPath)}</span>
              </figcaption>
            </figure>
          </section>

          {/* 何をしているか */}
          <section aria-labelledby="fax-about" className="mt-4 leading-snug">
            <h3 id="fax-about" className="font-bold">
              {SITE.name}とは
            </h3>
            <p className="mt-1 text-[14px]">
              {LEAD.what}データは御社のサーバーに置きます。月額は定額で、ドライバーは何人でも同じです
              {price ? `（${price.replace(/（税抜）$/, "・税抜")}）` : ""}。{makerCopy().fax}
            </p>
            <p className="mt-1 text-[12px]">
              差や指摘は記録から分かることで、判断ではありません。税務・法律の最終的な判断は、税理士・弁護士・社労士にご確認ください。
            </p>
          </section>

          {/* 差出人と送付停止 */}
          <footer className="mt-4 grid gap-3 sm:grid-cols-[1.15fr_1fr] md:mt-auto print:mt-auto print:grid-cols-[1.15fr_1fr]">
            <div className="border-2 border-black p-3 text-[13px] leading-snug">
              <p className="mb-1 font-bold">差出人</p>
              <SenderBlock tone="fax" />
            </div>
            <div className="border-[3px] border-dashed border-black p-3 text-[14px] font-bold leading-snug">
              <p>送付停止のご連絡先</p>
              <p className="mt-1">
                今後このご案内が不要な方は、お手数ですが
                <span className={cx(stop.missing && "kit-missing")}>{stop.text}</span>
                でお知らせください。すぐに送付を止めます。
              </p>
            </div>
          </footer>
          <p className="mt-2 text-[11px] leading-tight [overflow-wrap:anywhere]">
            出典：
            {hook.sources.map((s) => `${s.label} ${shortSource(s.url)}`).join(" ／ ")}
            （2026年9月時点）
          </p>
        </article>
      </div>
    </div>
  );
}
