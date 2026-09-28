import "server-only";
import fs from "node:fs";
import path from "node:path";
import { Marked } from "marked";

/**
 * 記事は content/articles/<slug>.md。先頭に次の形の見出し情報を書く：
 *
 * ---
 * title: 記事の題
 * description: 検索結果に出る説明（120 字前後）
 * published: 2026-09-23
 * updated: 2026-09-23
 * category: 法令 | 税金 | お金 | 開業 | 仕事
 * sources: https://... , https://...
 * ---
 */

export type ArticleMeta = {
  slug: string;
  title: string;
  description: string;
  published: string;
  updated: string;
  category: string;
  sources: string[];
  /** 並び順（小さいほど上。無ければ 100） */
  order: number;
};

export type Article = ArticleMeta & { html: string; headings: { id: string; text: string }[] };

const DIR = path.join(process.cwd(), "content", "articles");

export function parseFrontmatter(raw: string): { data: Record<string, string>; body: string } {
  const text = raw.replace(/^﻿/, "");
  const m = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/.exec(text);
  if (!m) return { data: {}, body: text };
  const data: Record<string, string> = {};
  for (const line of m[1].split(/\r?\n/)) {
    const i = line.indexOf(":");
    if (i < 1) continue;
    data[line.slice(0, i).trim()] = line.slice(i + 1).trim().replace(/^["']|["']$/g, "");
  }
  return { data, body: text.slice(m[0].length) };
}

function toMeta(slug: string, data: Record<string, string>): ArticleMeta {
  const required = ["title", "description", "published"] as const;
  for (const key of required) {
    if (!data[key]) throw new Error(`content/articles/${slug}.md に ${key} がありません`);
  }
  return {
    slug,
    title: data.title,
    description: data.description,
    published: data.published,
    updated: data.updated || data.published,
    category: data.category || "その他",
    sources: (data.sources ?? "")
      .split(/[,\s]+/)
      .map((s) => s.trim())
      .filter((s) => /^https?:\/\//.test(s)),
    order: data.order ? Number(data.order) : 100,
  };
}

/** 属性の値に入れる文字を逃がす（" で属性が閉じないように） */
const attr = (v: string) => v.replace(/&(?!(?:[a-z]+|#\d+|#x[\da-f]+);)/gi, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;");

/** 見出し（h2）に id を振り、目次を作る */
export function renderMarkdown(body: string): { html: string; headings: { id: string; text: string }[] } {
  const headings: { id: string; text: string }[] = [];
  const marked = new Marked({ gfm: true, breaks: false });
  marked.use({
    renderer: {
      heading({ tokens, depth }) {
        const text = this.parser.parseInline(tokens);
        if (depth === 2) {
          const id = `h-${headings.length + 1}`;
          headings.push({ id, text: text.replace(/<[^>]+>/g, "") });
          return `<h2 id="${id}">${text}</h2>\n`;
        }
        return `<h${depth}>${text}</h${depth}>\n`;
      },
      link({ href, title, tokens }) {
        const text = this.parser.parseInline(tokens);
        const external = /^https?:\/\//.test(href);
        const t = title ? ` title="${attr(title)}"` : "";
        return external
          ? `<a href="${attr(href)}"${t} target="_blank" rel="noopener noreferrer">${text}</a>`
          : `<a href="${attr(href)}"${t}>${text}</a>`;
      },
    },
  });
  const html = marked.parse(body, { async: false }) as string;
  return { html, headings };
}

export function listArticles(): ArticleMeta[] {
  if (!fs.existsSync(DIR)) return [];
  return fs
    .readdirSync(DIR)
    .filter((f) => f.endsWith(".md"))
    .map((f) => {
      const slug = f.replace(/\.md$/, "");
      const { data } = parseFrontmatter(fs.readFileSync(path.join(DIR, f), "utf8"));
      return toMeta(slug, data);
    })
    .sort((a, b) => a.order - b.order || b.updated.localeCompare(a.updated) || a.slug.localeCompare(b.slug));
}

export function getArticle(slug: string): Article | null {
  if (!/^[a-z0-9-]+$/.test(slug)) return null;
  const file = path.join(DIR, `${slug}.md`);
  if (!fs.existsSync(file)) return null;
  const { data, body } = parseFrontmatter(fs.readFileSync(file, "utf8"));
  return { ...toMeta(slug, data), ...renderMarkdown(body) };
}
