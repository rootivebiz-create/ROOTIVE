import type { Metadata } from "next";
import Link from "next/link";
import type { ReactNode } from "react";
import { CONTACT, SITE, businessInfo } from "@/site.config";

const PATH = "/legal/privacy";
const TITLE = "プライバシーポリシー";
const DESCRIPTION = `${SITE.name}が、相談フォームなどでお預かりする個人情報をどう扱うかをまとめています。`;

export const metadata: Metadata = {
  title: TITLE,
  description: DESCRIPTION,
  alternates: { canonical: PATH },
  openGraph: { type: "website", title: TITLE, description: DESCRIPTION, url: PATH },
};

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section>
      <h2>{title}</h2>
      {children}
    </section>
  );
}

export default function PrivacyPage() {
  const info = businessInfo();
  const contactLine = CONTACT.email ? (
    <>
      メール（
      <a href={`mailto:${CONTACT.email}`} className="break-all">
        {CONTACT.email}
      </a>
      ）
    </>
  ) : (
    <>
      <Link href="/contact">相談・問い合わせのフォーム</Link>
    </>
  );

  return (
    <div className="mx-auto max-w-3xl">
      <h1 className="text-2xl font-bold leading-snug sm:text-3xl">プライバシーポリシー</h1>
      <p className="mt-3">
        {SITE.name}（以下「当方」）は、お預かりする個人情報を、次のとおり扱います。
      </p>

      <div className="prose-ja mt-2">
        <Section title="1. 事業者">
          <ul>
            <li>屋号：{SITE.name}（個人事業）</li>
            <li>事業者名：{info.ownerName ?? "（事業者名は準備中です）"}</li>
            {info.address && <li>所在地：{info.address}</li>}
            <li>連絡先：{contactLine}</li>
          </ul>
          {(!info.ownerName || !info.address) && (
            <p>
              {info.ownerName ? "所在地" : "事業者の氏名・住所"}は、{CONTACT.email ? "メールで" : "上の連絡先から"}
              お求めいただければ、遅滞なくお知らせします。
            </p>
          )}
        </Section>

        <Section title="2. お預かりする情報">
          <ul>
            <li>
              <strong>相談フォームに入力された内容</strong>
              ：会社名、お名前、メールアドレス、電話番号、ドライバーの人数、相談したいこと、ご相談の内容
            </li>
            <li>
              <strong>アクセスの記録</strong>
              ：IPアドレス、ブラウザの種類、見たページ、日時など。サイトを配信するサービスが自動で記録します。
            </li>
            <li>ご相談やご契約のやりとりの中で、お知らせいただいた情報</li>
          </ul>
        </Section>

        <Section title="3. 使う目的">
          <ul>
            <li>お問い合わせ・ご相談へのお返事</li>
            <li>見積もり・ご提案</li>
            <li>ご契約いただいた仕事を行うこと</li>
            <li>サイトとサービスの改善</li>
            <li>いたずらや大量の送信を防ぐこと（送信の回数の制限など）</li>
          </ul>
          <p>これ以外の目的には使いません。</p>
        </Section>

        <Section title="4. ほかの人・会社に渡すこと（第三者提供）">
          <p>法令にもとづく場合を除き、ご本人の同意なく、個人情報をほかの人や会社に渡すことはありません。</p>
        </Section>

        <Section title="5. 外部のサービスの利用（委託）">
          <p>メールの送信やサイトの配信などに、次のような外部のサービスを使います。</p>
          <ul>
            <li>Vercel Inc.（米国）：このサイトの配信</li>
            <li>Resend（米国）：相談フォームの内容をメールで受け取るため</li>
            <li>受け付けの知らせを受け取るチャットのサービス、オンライン相談の予約・ビデオ通話のサービスなど</li>
          </ul>
          <p>
            これらのサービスを通じて、お預かりした情報が<strong>米国など日本の外のサーバーに保存されることがあります</strong>
            。外国の個人情報の保護の制度については、
            <a href="https://www.ppc.go.jp/" target="_blank" rel="noopener noreferrer">
              個人情報保護委員会のウェブサイト
            </a>
            で公表されています。
          </p>
        </Section>

        <Section title="6. 安全の管理">
          <ul>
            <li>フォームの内容は、暗号化された通信（HTTPS）で送られます。</li>
            <li>受け取った内容は、当方だけが見られる場所で管理します。</li>
            <li>使う外部のサービスのアカウントは、当方だけが使えるように管理します。</li>
            <li>必要がなくなった情報は、消します。</li>
          </ul>
        </Section>

        <Section title="7. ご契約後に扱うデータ">
          <p>
            ご契約後に仕組みの中で扱うデータ（ドライバーの情報や支払の金額など）は、御社のアカウント（クラウド）に置くのが基本です。当方は、作業に必要な範囲だけ、御社の許可を得て見ます。細かい扱いは、ご契約のときに決めます。
          </p>
        </Section>

        <Section title="8. デモと計算ツールに入れた内容">
          <p>
            <Link href="/demo">デモ</Link>に入れた内容は、お使いの端末（ブラウザ）の中だけに保存され、当方には送られません。
            <Link href="/tools/invoice-cost">計算ツール</Link>
            に入れた金額も、画面の中だけで計算し、送信しません。
          </p>
          <p>デモの内容を消したいときは、ブラウザの「サイトのデータ」を消してください。</p>
        </Section>

        <Section title="9. Cookie とアクセス解析">
          <p>
            現在、アクセス解析のツールや、広告のための Cookie は使っていません。使い始めるときは、このページを改定してお知らせします。
          </p>
        </Section>

        <Section title="10. ご本人からの求め（開示・訂正・削除など）">
          <p>
            当方がお預かりしているご自身の情報について、使う目的のお知らせ、開示、訂正・追加・削除、使うのをやめること、ほかの人・会社に渡すのをやめることを求められます。
          </p>
          <p>
            {contactLine}
            からご連絡ください。ご本人であることを確かめたうえで、遅滞なく対応します。
          </p>
        </Section>

        <Section title="11. 改定">
          <p>法令や、サービスの内容が変わったときなどに、このページを改定することがあります。大事な変更は、このページでお知らせします。</p>
        </Section>

        <p className="text-sm text-muted-foreground">制定：2026年9月</p>
      </div>
    </div>
  );
}
