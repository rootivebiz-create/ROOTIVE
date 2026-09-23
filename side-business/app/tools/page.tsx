import type { Metadata } from "next";
import Link from "next/link";
import { SITE } from "@/site.config";

const TITLE = "無料の計算ツール";
const DESCRIPTION =
  "業務委託の支払で使える無料ツール。免税の方への支払で会社が負担する消費税（2026年10月から控除70%）、取引条件明示書と支払期日の60日チェック、業種別の報酬・源泉徴収・振込額の計算。入力はどこにも送られません。";

export const metadata: Metadata = {
  title: TITLE,
  description: DESCRIPTION,
  alternates: { canonical: "/tools" },
  openGraph: { type: "website", locale: SITE.locale, siteName: SITE.name, title: TITLE, description: DESCRIPTION, url: "/tools" },
};

const TOOLS = [
  {
    href: "/tools/invoice-cost",
    name: "免税の方への支払で、会社が負担する消費税",
    what: "2026年10月から控除できる割合が80%から70%に下がります。月の支払額を入れると、負担が月・年でいくら増えるかが分かります。",
  },
  {
    href: "/tools/torihiki-joken",
    name: "取引条件明示書と、支払期日の60日チェック",
    what: "フリーランス法で渡す取引条件明示書を、単価・差し引き・締め日と支払日から作ります。印刷と、LINE・メールで送る文面のコピーができます。",
  },
  {
    href: "/tools/payout",
    name: "業種別：報酬・源泉徴収・振込額の計算",
    what: "数量×単価・歩合・段階歩合・最低保証・精算幅から選んで、消費税・源泉徴収・差し引き・振込額までを出します。運送・出版・IT・美容・講師の見本つき。",
  },
] as const;

export default function ToolsPage() {
  return (
    <div className="mx-auto max-w-3xl">
      <h1 className="text-2xl font-bold">{TITLE}</h1>
      <p className="mt-2 text-muted-foreground">
        どれも無料で、登録は要りません。入力した数字は端末の中で計算し、どこにも送りません。
      </p>
      <ul className="mt-6 grid gap-3">
        {TOOLS.map((t) => (
          <li key={t.href}>
            <Link
              href={t.href}
              className="block rounded-card border border-border bg-card p-4 text-foreground no-underline hover:border-foreground"
            >
              <span className="block font-bold leading-snug">{t.name}</span>
              <span className="mt-1 block text-sm text-muted-foreground">{t.what}</span>
            </Link>
          </li>
        ))}
      </ul>
      <p className="mt-8 text-sm text-muted-foreground">
        計算の結果は一般的な目安です。税務・法律の最終的な判断は、税理士・弁護士などの専門家にご確認ください。
      </p>
    </div>
  );
}
