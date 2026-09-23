/**
 * 印刷用の紙面の共通部分：用紙の向き（@page）・紙の色（ダークモードでも白い紙）・印刷の余白の打ち消し・操作の帯。
 * <PaperStyle> はそのページを開いている間だけ効く（ページを離れると <style> ごと消える）。
 */
import Link from "next/link";
import type { ReactNode } from "react";
import { buttonClass } from "@/components/ui";
import { cx } from "./format";
import { PrintButton } from "./print-button";

/**
 * 紙の色。サイトのダークモードに関係なく、白い紙に黒い文字で見せる。
 * .kit-desk は紙を置く机（画面だけ薄い灰色。印刷では白・余白なし）
 */
const PAPER_TOKENS = `
.kit-paper {
  --background: #ffffff;
  --foreground: #16171a;
  --card: #ffffff;
  --muted: #f1f1ec;
  --muted-foreground: #4f525a;
  --border: #d4d4cc;
  --plate: #16171a;
  --plate-foreground: #f5c400;
  --primary: #16171a;
  --primary-foreground: #ffffff;
  --accent: #f5c400;
  --accent-foreground: #16171a;
  --link: #0b57d0;
  --danger: #c62828;
  --success: #1b7f47;
  --warning: #9a6200;
  color-scheme: light;
  color: var(--foreground);
  -webkit-print-color-adjust: exact;
  print-color-adjust: exact;
}
.kit-paper a { color: inherit; }
.kit-missing { outline: 2px dashed currentColor; outline-offset: 1px; padding: 0 2px; }
.kit-qr svg { display: block; width: 100%; height: auto; }
@media print {
  html, body { background: #ffffff !important; }
  body { line-height: 1.6; }
  body > main { padding: 0 !important; margin: 0 !important; max-width: none !important; width: auto !important; }
  .kit-desk { background: #ffffff !important; padding: 0 !important; margin: 0 !important; border-radius: 0 !important; }
  .kit-missing { outline: none; padding: 0; }
}
`;

export function PaperStyle({ orientation, css = "" }: { orientation: "portrait" | "landscape"; css?: string }) {
  const page = `@media print { @page { size: A4 ${orientation}; margin: 0; } }`;
  return <style dangerouslySetInnerHTML={{ __html: `${page}\n${PAPER_TOKENS}\n${css}` }} />;
}

/** 画面の上の操作の帯（印刷しない）：資料の一覧へ戻る・印刷する・ひとこと */
export function KitToolbar({ title, hint, children }: { title: string; hint: string; children?: ReactNode }) {
  return (
    <div className="no-print mb-6">
      <nav aria-label="営業資料" className="text-sm">
        <Link href="/kit" className="inline-flex min-h-11 items-center">
          ← 営業資料の一覧
        </Link>
      </nav>
      <h1 className="text-xl font-bold leading-snug sm:text-2xl">{title}</h1>
      <p className="mt-1 text-sm leading-relaxed text-muted-foreground">{hint}</p>
      {children}
      <div className="mt-3 flex flex-col gap-2 sm:flex-row sm:flex-wrap">
        <PrintButton />
        <Link href="/kit#pdf" className={cx(buttonClass("secondary"), "text-foreground!")}>
          PDFにする方法
        </Link>
      </div>
    </div>
  );
}
