/** 構造化データ（JSON-LD）。どのページもここから出す */

/** <script type="application/ld+json">。</script> で閉じられないよう < を逃がす */
export function JsonLd({ data }: { data: unknown }) {
  return <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(data).replace(/</g, "\\u003c") }} />;
}

/** よくある質問（FAQPage）。画面に出している質問と答えをそのまま渡す */
export function faqPageLd(items: readonly { q: string; a: string }[]) {
  return {
    "@context": "https://schema.org",
    "@type": "FAQPage",
    mainEntity: items.map((f) => ({ "@type": "Question", name: f.q, acceptedAnswer: { "@type": "Answer", text: f.a } })),
  };
}
