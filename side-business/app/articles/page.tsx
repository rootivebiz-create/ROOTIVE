import type { Metadata } from "next";
import Link from "next/link";
import { listArticles } from "@/lib/content";
import { SITE } from "@/site.config";

const TITLE = "記事一覧";
const DESCRIPTION = "軽貨物（黒ナンバー）の個人事業主ドライバー向けに、法令対応・確定申告・インボイス・手取りをわかりやすくまとめた記事。";

export const metadata: Metadata = {
  title: TITLE,
  description: DESCRIPTION,
  alternates: { canonical: "/articles" },
  // openGraph はレイアウトの値を丸ごと置きかえるので、locale と siteName もここで入れる
  openGraph: { type: "website", locale: SITE.locale, siteName: SITE.name, title: TITLE, description: DESCRIPTION, url: "/articles" },
};

export default function ArticlesPage() {
  const articles = listArticles();
  const categories = [...new Set(articles.map((a) => a.category))];
  return (
    <div>
      <h1 className="text-2xl font-bold">記事</h1>
      <p className="mt-2 text-muted-foreground">制度の一次情報（国土交通省・国税庁など）を確かめて書いています。出典は各記事の最後にあります。</p>
      {categories.map((cat) => (
        <section key={cat} className="mt-8">
          <h2 className="text-lg font-bold">{cat}</h2>
          <ul className="mt-3 grid gap-3 sm:grid-cols-2">
            {articles
              .filter((a) => a.category === cat)
              .map((a) => (
                <li key={a.slug}>
                  <Link
                    href={`/articles/${a.slug}`}
                    className="block h-full rounded-card border border-border bg-card p-4 text-foreground no-underline hover:border-foreground"
                  >
                    <span className="block font-bold leading-snug">{a.title}</span>
                    <span className="mt-2 line-clamp-3 block text-sm text-muted-foreground">{a.description}</span>
                    <span className="mt-2 block text-xs text-muted-foreground">更新 {a.updated}</span>
                  </Link>
                </li>
              ))}
          </ul>
        </section>
      ))}
    </div>
  );
}
