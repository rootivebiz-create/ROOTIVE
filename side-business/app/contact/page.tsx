import type { Metadata } from "next";
import Link from "next/link";
import { ContactForm } from "@/components/contact-form";
import { buttonClass, Card } from "@/components/ui";
import { hasDelivery, readDeliveryConfig } from "@/lib/contact";
import { CONTACT, SITE } from "@/site.config";

const PATH = "/contact";
const TITLE = "相談する（無料・30分・オンライン）";
const DESCRIPTION = `${SITE.name}への無料相談（30分・オンライン）の申し込み。業務委託ドライバーの支払明細・振込データ・利益の出し方など、いまの月末の作業を聞かせてください。相談だけでも歓迎です。`;

export const metadata: Metadata = {
  title: TITLE,
  description: DESCRIPTION,
  alternates: { canonical: PATH },
  // openGraph はレイアウトの値を丸ごと置きかえるので、locale と siteName もここで入れる
  openGraph: { type: "website", locale: SITE.locale, siteName: SITE.name, title: TITLE, description: DESCRIPTION, url: PATH },
};

export default function ContactPage() {
  const bookingUrl = CONTACT.bookingUrl;
  const formReady = hasDelivery(readDeliveryConfig(process.env));

  const steps = [
    {
      title: bookingUrl ? "フォームかカレンダーで予約" : "フォームで予約",
      body: bookingUrl
        ? "下のフォームに書くか、カレンダーから空いている日時を選んでください。"
        : "下のフォームからお申し込みください。日時はメールで相談して決めます。",
    },
    {
      title: "30分のオンライン相談で、今の月末の作業を聞かせてください",
      body: "支払明細・振込・請求を、いま誰が、何を使って、どれくらいの時間で作っているかを伺います。",
    },
    {
      title: "御社用のデモと見積もりをお送りします",
      body: "御社の案件や単価の決め方に合わせた動く見本と、見積もりをお送りします。決めるのは、それを見てからで大丈夫です。",
    },
  ];

  return (
    <div className="mx-auto max-w-3xl">
      <p className="text-sm font-bold text-muted-foreground">相談・問い合わせ</p>
      <h1 className="mt-1 text-2xl font-bold leading-snug sm:text-3xl">相談する（無料・30分・オンライン）</h1>
      <p className="mt-3">
        業務委託ドライバーの支払明細・振込データ・案件ごとの利益など、月末の作業で困っていることを聞かせてください。
      </p>

      <section aria-labelledby="flow" className="mt-8">
        <h2 id="flow" className="text-lg font-bold">
          相談の流れ
        </h2>
        <ol className="mt-4 space-y-4">
          {steps.map((s, i) => (
            <li key={s.title} className="flex gap-3">
              <span
                aria-hidden="true"
                className="num flex size-8 shrink-0 items-center justify-center rounded-full bg-accent font-bold text-accent-foreground"
              >
                {i + 1}
              </span>
              <div className="min-w-0">
                <p className="font-bold leading-snug">
                  <span className="sr-only">{i + 1}. </span>
                  {s.title}
                </p>
                <p className="mt-1 text-sm text-muted-foreground">{s.body}</p>
              </div>
            </li>
          ))}
        </ol>
        <p className="mt-5 rounded-card border-l-4 border-accent bg-card px-4 py-3 font-bold">
          相談だけでも歓迎です。売り込みはしません。
        </p>
      </section>

      {bookingUrl && (
        <Card className="mt-8 border-2 border-foreground">
          <h2 className="text-lg font-bold">日時をすぐ決めたいとき</h2>
          <p className="mt-1 text-sm text-muted-foreground">予約のページが別のタブで開きます。空いている30分を選んでください。</p>
          <a
            href={bookingUrl}
            target="_blank"
            rel="noopener noreferrer"
            className={buttonClass("accent", "mt-4 w-full text-base sm:w-auto sm:min-w-64")}
          >
            カレンダーから日時を選ぶ
          </a>
        </Card>
      )}

      <p className="mt-8 rounded-card bg-muted px-4 py-3 text-sm">
        いま使っている Excel や明細の見本があれば、当日画面で見せていただくのがいちばん早いです。
      </p>

      <section aria-labelledby="form" className="mt-10">
        <h2 id="form" className="text-lg font-bold">
          フォームで申し込む
        </h2>
        {!formReady && (
          <p role="note" className="mt-3 rounded-lg border border-warning bg-card px-3 py-2 text-sm">
            ただいまフォームの準備中です。
            {CONTACT.email ? (
              <>
                お手数ですが、メール（
                <a href={`mailto:${CONTACT.email}`} className="break-all">
                  {CONTACT.email}
                </a>
                ）でご連絡ください。
              </>
            ) : bookingUrl ? (
              "お手数ですが、上のカレンダーから日時を選んでください。"
            ) : (
              "しばらくしてから、もう一度お試しください。"
            )}
          </p>
        )}
        <p className="mt-2 text-sm text-muted-foreground">
          入力いただいた内容は、ご相談へのお返事と見積もりのために使います（<Link href="/legal/privacy">プライバシーポリシー</Link>）。
        </p>
        <Card className="mt-4 sm:p-6">
          <ContactForm fallbackEmail={CONTACT.email} bookingUrl={bookingUrl} />
        </Card>
        {CONTACT.email && formReady && (
          <p className="mt-4 text-sm text-muted-foreground">
            メールでも受け付けています：
            <a href={`mailto:${CONTACT.email}`} className="break-all">
              {CONTACT.email}
            </a>
          </p>
        )}
      </section>
    </div>
  );
}
