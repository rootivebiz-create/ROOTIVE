import type { Metadata } from "next";
import Link from "next/link";
import type { ReactNode } from "react";
import { makerCopy } from "@/components/kit/maker";
import { buttonClass, Card } from "@/components/ui";
import { CONTACT, PLANS, SHARE_IMAGE, SITE, businessInfo } from "@/site.config";

const PATH = "/about";
const TITLE = "運営者について";
/** 作り手の書き方は SITE.makerIsOperator で変わる（components/kit/maker.ts） */
const MAKER = makerCopy();
const DESCRIPTION = MAKER.aboutDescription;

export const metadata: Metadata = {
  title: TITLE,
  description: DESCRIPTION,
  alternates: { canonical: PATH },
  // openGraph はレイアウトの値を丸ごと置きかえるので、locale・siteName・共有の画像もここで入れる
  openGraph: {
    type: "website",
    locale: SITE.locale,
    siteName: SITE.name,
    title: TITLE,
    description: DESCRIPTION,
    url: PATH,
    images: [SHARE_IMAGE],
  },
};

/**
 * 立ち上げの期間はパックで違うので、料金（site.config.ts の PLANS）の目安をそのまま出す。
 * 並行運用（1〜2か月）はこの期間のあと。トップページの「導入の流れ」と同じ数え方。
 */
const BUILD_WEEKS = PLANS.filter((p) => p.monthlyYen > 0)
  .map((p) => `${p.name}が${p.weeks}`)
  .join("、");

const STEPS = [
  {
    title: "御社のやり方を聞く",
    body: "30分のオンライン相談で、いまの締めのやり方（Excel・元請の支払通知・単価や控除の決まり）を伺います。",
  },
  {
    title: "先月分でお試し",
    body: "御社の先月分の Excel で明細を計算し、今の振込額と 1 円単位で比べます。元請の支払通知があれば突き合わせます。決めるのは、その結果を見てからで大丈夫です。",
  },
  {
    title: "立ち上げ",
    body: `製品を御社の Vercel と Postgres に置き、最初の午後に一緒に画面を見ながら、先月の Excel で並行運用レポートまで作ります。${
      BUILD_WEEKS ? `立ち上げの期間の目安は、${BUILD_WEEKS}です。` : ""
    }そのあと1〜2か月、今の Excel と並べて締め、1 人ずつ 1 円まで比べます。全員が合うか、差の理由が分かってから本番に切り替えます。`,
  },
  {
    title: "保守",
    body: "製品の直しと改良、税率・経過措置など制度が変わったときの手直しを続けます。新しい版は御社の画面に自動で届きます。",
  },
] as const;

export default function AboutPage() {
  const info = businessInfo();
  const rows: { label: string; value: ReactNode }[] = [
    { label: "屋号", value: SITE.name },
    { label: "事業の形", value: "個人事業" },
  ];
  if (info.ownerName) rows.push({ label: "事業者名", value: info.ownerName });
  if (info.address) rows.push({ label: "所在地", value: info.address });
  if (info.invoiceRegNo) rows.push({ label: "インボイスの登録番号", value: <span className="num">{info.invoiceRegNo}</span> });
  rows.push({
    label: "連絡先",
    value: CONTACT.email ? (
      <a href={`mailto:${CONTACT.email}`} className="break-all">
        {CONTACT.email}
      </a>
    ) : (
      <Link href="/contact">相談・問い合わせのフォーム</Link>
    ),
  });

  return (
    <div className="mx-auto max-w-3xl">
      <h1 className="text-2xl font-bold leading-snug sm:text-3xl">運営者について</h1>

      <p className="mt-4 rounded-card border-l-4 border-accent bg-card px-4 py-4 text-lg font-bold leading-relaxed">
        {MAKER.aboutLead}
      </p>
      <p className="mt-4">{MAKER.aboutBody}</p>

      <section aria-labelledby="how" className="mt-10">
        <h2 id="how" className="text-lg font-bold">
          進め方
        </h2>
        <ol className="mt-4 space-y-4">
          {STEPS.map((s, i) => (
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
      </section>

      <section aria-labelledby="not" className="mt-10">
        <h2 id="not" className="text-lg font-bold">
          やらないこと
        </h2>
        <ul className="mt-3 space-y-3">
          <li>
            <Card>
              <p className="font-bold">税務・法律・社会保険の判断</p>
              <p className="mt-1 text-sm">
                税理士・弁護士・社労士の領分なので、行いません。製品の見張り番も、記録から分かる事実と根拠を出すところまでです。計算は、御社と顧問の先生が決めたルールのとおりに動かします。
              </p>
            </Card>
          </li>
          <li>
            <Card>
              <p className="font-bold">お金の振込</p>
              <p className="mt-1 text-sm">作るのは銀行に出す振込データまでです。振込は御社が行い、当方はお金に触れません。</p>
            </Card>
          </li>
          <li>
            <Card>
              <p className="font-bold">元請とのやりとり</p>
              <p className="mt-1 text-sm">
                元請の支払通知との差は、問い合わせ文の下書きまで作ります。送るかどうか、どう話すかは御社が決めます。
              </p>
            </Card>
          </li>
        </ul>
      </section>

      <section aria-labelledby="data" className="mt-10">
        <h2 id="data" className="text-lg font-bold">
          データの扱い
        </h2>
        <div className="mt-3 space-y-2">
          <p>
            製品もデータも、<strong>御社の Vercel（サーバー）と Postgres（データベース）に置きます</strong>
            。当方の都合で、御社がデータを使えなくなることがないようにするためです。全データは、いつでも書き出せます。
          </p>
          <p>当方は、立ち上げと保守に必要な範囲だけ、御社の許可を得て見ます。</p>
          <p className="text-sm text-muted-foreground">
            くわしくは<Link href="/legal/privacy">プライバシーポリシー</Link>をご覧ください。
          </p>
        </div>
      </section>

      <section aria-labelledby="profile" className="mt-10">
        <h2 id="profile" className="text-lg font-bold">
          事業者の情報
        </h2>
        <dl className="mt-3 divide-y divide-border rounded-card border border-border bg-card">
          {rows.map((r) => (
            <div key={r.label} className="grid gap-1 px-4 py-3 sm:grid-cols-[10rem_1fr] sm:gap-4">
              <dt className="text-sm font-bold text-muted-foreground">{r.label}</dt>
              <dd className="min-w-0 break-words">{r.value}</dd>
            </div>
          ))}
        </dl>
        {(!info.ownerName || !info.address) && (
          <p className="mt-2 text-sm text-muted-foreground">
            {info.ownerName ? "所在地" : "事業者の氏名・住所"}は、お求めいただければお知らせします。
          </p>
        )}
      </section>

      <Card className="mt-10 border-2 border-foreground">
        <h2 className="text-lg font-bold leading-snug">まずは30分、いまの月末の作業を聞かせてください</h2>
        <p className="mt-2 text-sm">相談は無料・オンラインです。相談だけでも歓迎です。売り込みはしません。</p>
        <div className="mt-4 flex flex-col gap-2 sm:flex-row">
          <Link href="/contact" className={buttonClass("accent")}>
            相談する（無料・30分）
          </Link>
          <Link href="/product" className={buttonClass("secondary")}>
            製品のご紹介を見る
          </Link>
        </div>
      </Card>
    </div>
  );
}
