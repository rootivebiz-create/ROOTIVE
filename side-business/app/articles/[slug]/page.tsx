import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { JsonLd } from "@/components/json-ld";
import { getArticle, listArticles } from "@/lib/content";
import { SHARE_IMAGE, SITE } from "@/site.config";

export const dynamicParams = false;

export function generateStaticParams() {
  return listArticles().map((a) => ({ slug: a.slug }));
}

type Props = { params: Promise<{ slug: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { slug } = await params;
  const a = getArticle(slug);
  if (!a) return {};
  return {
    title: a.title,
    description: a.description,
    alternates: { canonical: `/articles/${a.slug}` },
    // openGraph はレイアウトの値を丸ごと置きかえるので、locale と siteName もここで入れる
    openGraph: {
      images: [SHARE_IMAGE],
      type: "article",
      locale: SITE.locale,
      siteName: SITE.name,
      title: a.title,
      description: a.description,
      url: `/articles/${a.slug}`,
      publishedTime: a.published,
      modifiedTime: a.updated,
    },
  };
}

export default async function ArticlePage({ params }: Props) {
  const { slug } = await params;
  const a = getArticle(slug);
  if (!a) notFound();
  const related = listArticles()
    .filter((x) => x.slug !== a.slug && x.category === a.category)
    .slice(0, 4);
  const jsonLd = {
    "@context": "https://schema.org",
    "@type": "Article",
    headline: a.title,
    description: a.description,
    datePublished: a.published,
    dateModified: a.updated,
    inLanguage: "ja",
    mainEntityOfPage: `${SITE.url}/articles/${a.slug}`,
    author: { "@type": "Organization", name: SITE.name, url: `${SITE.url}/` },
    publisher: { "@type": "Organization", name: SITE.name, url: `${SITE.url}/` },
  };
  return (
    <article className="mx-auto max-w-3xl">
      <JsonLd data={jsonLd} />
      <nav className="text-sm text-muted-foreground" aria-label="パンくず">
        <Link href="/articles">記事</Link> <span aria-hidden>›</span> {a.category}
      </nav>
      <h1 className="mt-2 text-2xl font-bold leading-snug sm:text-3xl">{a.title}</h1>
      <p className="mt-2 text-sm text-muted-foreground">
        公開 {a.published}・更新 {a.updated}
      </p>
      {a.headings.length > 2 && (
        <nav aria-label="目次" className="mt-6 rounded-card border border-border bg-card p-4 text-sm">
          <p className="font-bold">目次</p>
          <ol className="mt-2 list-decimal space-y-1 pl-5">
            {a.headings.map((h) => (
              <li key={h.id}>
                <a href={`#${h.id}`}>{h.text}</a>
              </li>
            ))}
          </ol>
        </nav>
      )}
      <div className="prose-ja mt-6" dangerouslySetInnerHTML={{ __html: a.html }} />
      {a.sources.length > 0 && (
        <section className="mt-10 rounded-card border border-border bg-card p-4 text-sm">
          <h2 className="font-bold">出典・参考</h2>
          <ul className="mt-2 space-y-1 break-all">
            {a.sources.map((s) => (
              <li key={s}>
                <a href={s} target="_blank" rel="noopener noreferrer">
                  {s}
                </a>
              </li>
            ))}
          </ul>
          <p className="mt-3 text-muted-foreground">
            記事の内容は {a.updated} 時点のものです。制度は変わることがあるので、手続きの前に出典の最新の情報を確かめてください。
          </p>
        </section>
      )}
      {related.length > 0 && (
        <section className="mt-10">
          <h2 className="text-lg font-bold">関連する記事</h2>
          <ul className="mt-3 space-y-2">
            {related.map((r) => (
              <li key={r.slug}>
                <Link href={`/articles/${r.slug}`}>{r.title}</Link>
              </li>
            ))}
          </ul>
        </section>
      )}
    </article>
  );
}
