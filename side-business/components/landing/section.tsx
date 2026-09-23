/** トップページ（/）の共通の部品：見出し付きの区切り・リンクのボタン・金額の書式・構造化データ */
import type { ReactNode } from "react";
import { buttonClass } from "@/components/ui";

export const cx = (...c: (string | false | null | undefined)[]) => c.filter(Boolean).join(" ");

type Variant = NonNullable<Parameters<typeof buttonClass>[0]>;

/**
 * リンクをボタンの見た目にするクラス。globals.css の `a { color: var(--link) }` は `@layer base` の中にあり、
 * Tailwind の文字色で上書きできるので、buttonClass をそのまま使う（業種別のページもここから読む）。
 */
export function ctaClass(variant: Variant, className?: string) {
  return buttonClass(variant, className);
}

const yenFormat = new Intl.NumberFormat("ja-JP");

/** 250000 → 250,000円 */
export function yenText(value: number): string {
  return `${yenFormat.format(Math.round(value))}円`;
}

/** 250000 → 25万円、18000 → 1.8万円（千円単位で割り切れないときは 12,345円 のまま） */
export function compactYen(value: number): string {
  if (value >= 10_000 && value % 1_000 === 0) return `${value / 10_000}万円`;
  return yenText(value);
}

/** 250000, 480000 → 25万〜48万円 */
export function rangeYen(min: number, max: number): string {
  if (min === max) return compactYen(min);
  return `${compactYen(min).replace(/円$/, "")}〜${compactYen(max)}`;
}

/** インボイスの登録番号。数字だけで入っていたら頭に T を付ける（T1234567890123） */
export function regNoText(value: string): string {
  const v = value.replace(/\s+/g, "");
  return /^\d{13}$/.test(v) ? `T${v}` : v;
}

/** 別のタブで開くリンクに添える、読み上げ用のひとこと */
export function NewTabNote() {
  return <span className="sr-only">（新しいタブで開きます）</span>;
}

/** 区切り（見出し ＋ ひとこと ＋ 中身） */
export function Section({
  id,
  title,
  lead,
  children,
  className,
}: {
  id: string;
  title: ReactNode;
  lead?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  const headingId = `${id}-title`;
  return (
    <section id={id} aria-labelledby={headingId} className={cx("scroll-mt-20 pt-16 sm:pt-24", className)}>
      <span aria-hidden className="block h-1 w-10 rounded-full bg-accent" />
      <h2 id={headingId} className="mt-3 text-[1.35rem] font-bold leading-snug [word-break:auto-phrase] sm:text-2xl">
        {title}
      </h2>
      {lead && <div className="mt-3 max-w-3xl leading-relaxed text-muted-foreground">{lead}</div>}
      <div className="mt-6">{children}</div>
    </section>
  );
}

/** 構造化データ（JSON-LD）。</script> を閉じられないよう < を逃がす */
export function JsonLd({ data }: { data: unknown }) {
  return <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(data).replace(/</g, "\\u003c") }} />;
}

/** チェックの印（飾り） */
export function CheckIcon({ className, small }: { className?: string; small?: boolean }) {
  return (
    <svg aria-hidden viewBox="0 0 20 20" className={cx(small ? "h-4 w-4" : "h-5 w-5", "shrink-0", className)} fill="none">
      <circle cx="10" cy="10" r="9" className="fill-accent" />
      <path d="M6 10.2l2.6 2.6L14 7.4" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-accent-foreground" />
    </svg>
  );
}

/** 右向きの矢印（飾り） */
export function ArrowIcon({ className }: { className?: string }) {
  return (
    <svg aria-hidden viewBox="0 0 20 20" className={cx("h-4 w-4 shrink-0", className)} fill="none">
      <path d="M4 10h11m-4-4.5L15.5 10 11 14.5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
