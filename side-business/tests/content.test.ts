import { describe, expect, it } from "vitest";
import { listArticles, getArticle, parseFrontmatter, renderMarkdown } from "@/lib/content";

describe("記事の読み込み", () => {
  it("見出し情報と本文を分ける", () => {
    const { data, body } = parseFrontmatter("---\ntitle: 題\ndescription: \"説明: コロン入り\"\npublished: 2026-09-23\n---\n本文");
    expect(data).toEqual({ title: "題", description: "説明: コロン入り", published: "2026-09-23" });
    expect(body).toBe("本文");
  });

  it("見出し情報が無ければ全体を本文にする", () => {
    expect(parseFrontmatter("本文だけ")).toEqual({ data: {}, body: "本文だけ" });
  });

  it("h2 に id を振って目次にし、外部リンクは別タブで開く", () => {
    const { html, headings } = renderMarkdown("## 一つ目\n\n本文 [国交省](https://www.mlit.go.jp/)\n\n## 二つ目 **強調**\n\n### 小見出し");
    expect(headings).toEqual([
      { id: "h-1", text: "一つ目" },
      { id: "h-2", text: "二つ目 強調" },
    ]);
    expect(html).toContain('<h2 id="h-1">一つ目</h2>');
    expect(html).toContain('target="_blank" rel="noopener noreferrer"');
    expect(html).toContain("<h3>小見出し</h3>");
  });

  it("すべての記事に題・説明・公開日・出典があり、読み込める", () => {
    const list = listArticles();
    for (const meta of list) {
      expect(meta.title.length).toBeGreaterThan(5);
      expect(meta.description.length).toBeGreaterThan(30);
      expect(meta.published).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(meta.sources.length).toBeGreaterThan(0);
      expect(getArticle(meta.slug)?.html.length).toBeGreaterThan(500);
    }
  });

  it("おかしな slug は読まない", () => {
    expect(getArticle("../package")).toBeNull();
    expect(getArticle("nope")).toBeNull();
  });
});

describe("リンクの属性", () => {
  it("href と title の \" を逃がし、外部リンクは新しいタブで開く", () => {
    const { html } = renderMarkdown('[a](https://example.com/?q=1&r=2 "say \\"hi\\"")');
    expect(html).toContain('href="https://example.com/?q=1&amp;r=2"');
    expect(html).toContain('title="say &quot;hi&quot;"');
    expect(html).toContain('rel="noopener noreferrer"');
  });
});
