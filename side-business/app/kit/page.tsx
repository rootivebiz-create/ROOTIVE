import type { Metadata } from "next";
import Link from "next/link";
import type { ReactNode } from "react";
import { leadOffer, LEAD } from "@/components/kit/content";
import { FAX_HOOK_IDS, faxHook, faxHookHref } from "@/components/kit/fax-hooks";
import { displayUrl, productDemoUrl, shortUrl } from "@/components/kit/format";
import { SetupWarning, setupIssues } from "@/components/kit/sender";
import { Card, buttonClass } from "@/components/ui";
import { cx } from "@/lib/cx";

export const metadata: Metadata = {
  title: "営業資料（印刷用）",
  robots: { index: false, follow: false },
};

const linkButton = (variant: Parameters<typeof buttonClass>[0], className?: string) =>
  cx(buttonClass(variant), variant === "accent" ? "text-accent-foreground!" : variant === "primary" ? "text-primary-foreground!" : "text-foreground!", className);

function Material({
  id,
  name,
  spec,
  uses,
  qr,
  children,
}: {
  id: string;
  name: string;
  spec: string;
  uses: string[];
  qr: string;
  children: ReactNode;
}) {
  return (
    <Card className="p-5">
      <h2 id={id} className="scroll-mt-20 text-lg font-bold leading-snug">
        {name}
      </h2>
      <p className="mt-1 text-sm font-bold text-muted-foreground">{spec}</p>
      <ul className="mt-3 list-disc space-y-1 pl-5 text-sm leading-relaxed">
        {uses.map((u) => (
          <li key={u}>{u}</li>
        ))}
      </ul>
      <p className="mt-2 text-sm leading-relaxed text-muted-foreground">QRコードの行き先：{qr}</p>
      <div className="mt-4">{children}</div>
    </Card>
  );
}

const PDF_STEPS: { device: string; steps: string[]; note?: string }[] = [
  {
    device: "パソコン（Chrome・Edge）",
    steps: [
      "資料を開いて「印刷する・PDFにする」を押す",
      "送信先（プリンタ）で「PDFに保存」を選ぶ",
      "「詳細設定」で、用紙サイズ A4・余白「なし」・倍率 100%（既定）にする",
      "「ヘッダーとフッター」のチェックを外し、「背景のグラフィック」にチェックを入れる",
      "「保存」を押す",
    ],
    note: "向き（提案書は横、FAXとチラシは縦）は自動で決まります。Mac の Safari では、印刷の画面で向きを確かめ、「背景をプリント」にチェックを入れて、左下の「PDF」→「PDFとして保存」を選びます。",
  },
  {
    device: "iPhone（Safari）",
    steps: [
      "資料を開いて「印刷する・PDFにする」を押す（または、共有ボタン →「プリント」）",
      "プリントの画面の上にある共有ボタンを押す",
      "「“ファイル”に保存」を選んで保存する（LINEやメールに直接送ることもできます）",
    ],
    note: "iOS の版によって、ボタンの場所が少し違います。提案書が縦向きになったり、ページ数が9枚にならなかったりするときは、パソコンの Chrome で作るのが確実です。",
  },
  {
    device: "Android（Chrome）",
    steps: [
      "資料を開いて「印刷する・PDFにする」を押す（または、右上の︙ →「共有」→「印刷」）",
      "上のプリンタの欄で「PDF形式で保存」を選ぶ",
      "用紙サイズを A4 にして、PDF のボタンを押す",
    ],
  },
];

const FAX_CHECKS = [
  "上の赤い警告が出ていない（差出人の情報がすべて入っている）",
  "自分あてに1枚送って、文字とQRコードが読めるか確かめた",
  "QRコードをスマホで読んで、正しいページが開くか確かめた",
  "送付先は会社（法人）に絞っている。個人事業主あてに送るかは、弁護士に確かめてから決める",
  "「営業お断り」「FAX不要」と書いてある会社は、リストから外した",
  "停止の申し出は、その日のうちにリストから外し、日付と会社名を記録する",
  "本業の会社の取引先（元請・お客様）には送らない",
  "1回のFAXに入れるきっかけは1つだけ（見出しを混ぜない）",
  "文面を書き足していない。書き足すときも、差は「少ない可能性」、指摘は事実と根拠だけにする（言わないことの一覧は sales-kit/README.md）",
] as const;

export default function KitIndexPage() {
  const ready = setupIssues().every((i) => i.optional);
  const productDemo = productDemoUrl();
  return (
    <div className="mx-auto max-w-3xl">
      <p className="text-sm font-bold text-muted-foreground">自分用（検索には出ません）</p>
      <h1 className="mt-1 text-2xl font-bold leading-snug sm:text-3xl">営業資料（印刷用）</h1>
      <p className="mt-3 leading-relaxed">
        提案書・FAX DM・紹介チラシの3つです。料金は site.config.ts、差出人は環境変数から自動で入ります。開いて「印刷する・PDFにする」を押せば、PDFにできます。
      </p>
      <p className="mt-2 rounded-card border-l-4 border-accent bg-card p-3 text-sm leading-relaxed">
        <span className="font-bold">どの資料も同じ順番で話します：</span>
        {LEAD.question}
        {leadOffer()}。そのあとに、10月からの70%・Excelをそのまま取り込み・今のExcelと比べてから切り替え・ドライバーの確認の記録・締め前の見張り番・データは御社のもの。
      </p>
      <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
        このページと資料は、URLを知っていれば誰でも見られます（検索には出しません）。お客様には、URLではなくPDFにして送ってください。
      </p>

      {ready ? (
        <p className="mt-4 rounded-card border-2 border-success bg-card p-3 text-sm font-bold text-success">
          差出人の情報は入っています。このまま送れます。
        </p>
      ) : null}
      <SetupWarning className="mt-4" />

      <div className="mt-6 grid gap-4">
        <Material
          id="proposal"
          name="1. 提案書"
          spec="A4横・9枚・カラー"
          uses={["商談の前にPDFで送る", "オンライン相談で画面共有して見せる", "印刷して、会って渡す"]}
          qr={`お試し・相談の申し込み（${displayUrl("/contact")}。utm_source=proposal 付き）と、製品のデモ（${
            productDemo ? shortUrl(productDemo) : `未設定のため計算のデモ ${displayUrl("/demo")}`
          }）`}
        >
          <form action="/kit/proposal" method="get" className="flex flex-col gap-2 sm:flex-row sm:items-end">
            <label className="block flex-1">
              <span className="block text-sm font-bold">表紙の宛名（任意）</span>
              <input
                name="company"
                maxLength={40}
                placeholder="例：サンプル運送株式会社"
                className="mt-1 block min-h-11 w-full rounded-lg border border-border bg-card px-3 text-base text-foreground focus:border-foreground"
              />
            </label>
            <button type="submit" className={buttonClass("accent")}>
              提案書を開く
            </button>
          </form>
          <p className="mt-2 text-xs leading-relaxed text-muted-foreground">
            宛名を入れると、表紙に「◯◯ 御中」と出ます。空のままでも開けます。
          </p>
        </Material>

        <Material
          id="fax"
          name="2. FAX DM"
          spec="A4縦・1枚・白黒"
          uses={["FAX DM の業者にPDFで入稿する", "日付のあるきっかけを1つだけ入れて、会社あてに送る"]}
          qr="きっかけごとに、製品の紹介・計算ツール・明示書のツール・相談のページ。utm_source=fax と utm_campaign=きっかけ 付き"
        >
          <ul className="grid gap-2">
            {FAX_HOOK_IDS.map((id) => {
              const h = faxHook(id);
              return (
                <li key={id} className="rounded-lg border border-border p-3">
                  <Link href={faxHookHref(id)} className="inline-flex min-h-11 items-center font-bold">
                    {h.name}
                  </Link>
                  <p className="text-sm leading-relaxed">見出し：{h.headline}</p>
                  <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
                    送るとよい時期：{h.when}／QR：{displayUrl(h.qrPath)}（utm_campaign={id}）
                  </p>
                </li>
              );
            })}
          </ul>
          <details className="mt-3 rounded-lg border border-border p-3">
            <summary className="flex min-h-11 cursor-pointer items-center font-bold">送る前のチェック</summary>
            <ul className="mt-2 space-y-1.5 text-sm leading-relaxed">
              {FAX_CHECKS.map((c) => (
                <li key={c} className="flex gap-2">
                  <span aria-hidden>□</span>
                  <span>{c}</span>
                </li>
              ))}
            </ul>
          </details>
        </Material>

        <Material
          id="flyer"
          name="3. 紹介チラシ"
          spec="A4縦・1枚・カラー"
          uses={["同業の知り合いに渡す", "LINEでPDFを送る", "知り合いから、さらにその知り合いへ回してもらう"]}
          qr={`トップページ（${displayUrl("/")}）。utm_source=flyer 付き。製品のデモの URL は${productDemo ? "文字で載ります" : "未設定のため載りません"}`}
        >
          <Link href="/kit/flyer" className={linkButton("accent")}>
            チラシを開く
          </Link>
        </Material>

        <Card className="p-5">
          <h2 id="product-demo" className="scroll-mt-20 text-lg font-bold leading-snug">
            4. 製品のデモ（架空の会社・来た人ごと・24時間で消える）
          </h2>
          {productDemo ? (
            <>
              <p className="mt-2 text-sm leading-relaxed">商談の5分のデモはここを使います（台本は sales-kit/07）。提案書の最後のQRと、チラシの1行もここを指します。</p>
              <p className="mt-2 break-all rounded-lg bg-muted p-3 font-mono text-sm">{productDemo}</p>
              <a href={productDemo} target="_blank" rel="noopener noreferrer nofollow" className={cx(linkButton("secondary"), "mt-3")}>
                製品のデモを開く
              </a>
            </>
          ) : (
            <p className="mt-2 text-sm leading-relaxed">
              まだ入っていません。製品のデモを公開したら（product/README.md の「デモを公開する」）、Vercel の環境変数{" "}
              <code className="break-all rounded bg-muted px-1 text-xs">NEXT_PUBLIC_PRODUCT_DEMO_URL</code>{" "}
              にその URL を入れて、もう一度デプロイしてください。入るまでは、提案書の QR は計算のデモ（{displayUrl("/demo")}）を指し、チラシには載りません。
            </p>
          )}
        </Card>
      </div>

      <section aria-labelledby="pdf" className="mt-10">
        <h2 id="pdf" className="scroll-mt-20 text-xl font-bold">
          PDFにする方法
        </h2>
        <div className="mt-4 grid gap-4">
          {PDF_STEPS.map((d) => (
            <Card key={d.device}>
              <h3 className="font-bold">{d.device}</h3>
              <ol className="mt-2 list-decimal space-y-1 pl-5 text-sm leading-relaxed">
                {d.steps.map((s) => (
                  <li key={s}>{s}</li>
                ))}
              </ol>
              {d.note && <p className="mt-2 text-sm leading-relaxed text-muted-foreground">{d.note}</p>}
            </Card>
          ))}
        </div>
        <p className="mt-4 text-sm leading-relaxed">
          できたPDFのページ数を確かめてください。提案書は9ページ、FAXとチラシは1ページです。多いときは、用紙がA4か・倍率が100%か・余白が「なし」かを見直してください。
        </p>
      </section>

      <section aria-labelledby="notes" className="mt-10">
        <h2 id="notes" className="text-xl font-bold">
          使うときの注意
        </h2>
        <ul className="mt-3 list-disc space-y-1.5 pl-5 text-sm leading-relaxed">
          <li>
            QRコードには utm_source（fax・flyer・proposal）が付いています。FAXには、きっかけ（notice・70・freelance・safety）の utm_campaign も付きます。Vercel の Web Analytics で、ページの表示回数を utm
            の値ごとに見られます（使えるかは Vercel のプランしだい）。相談フォームから届く知らせには「流入元」（どの資料から来たか）が入るので、問い合わせがどの資料から来たかはそこで分かります。
          </li>
          <li>料金を変えたら site.config.ts だけを直せば、3つの資料すべてに反映されます。</li>
          <li>期限の話題（10月からの70%など）は時間がたつと古くなります。送る前に、日付と出典の最新の情報を確かめてください。</li>
          <li>資料に「導入◯社」や、測っていない時間の短縮の数字は書いていません。足すときは、実際にあったことだけにしてください。</li>
          <li>
            提案書の突合・並行運用・見張り番の数字は、製品のデモ（架空の会社）の10月分です。製品のデモのデータを変えたら、components/kit/content.ts
            の例も直してください。
          </li>
          <li>ほかの製品の名前は、資料にも口頭でも出しません。比べて悪く言わず、「ほかには無い」とも言いません。</li>
        </ul>
      </section>
    </div>
  );
}
