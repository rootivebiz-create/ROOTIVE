import Link from "next/link";
import { SITE } from "@/site.config";

export function SiteFooter() {
  return (
    <footer className="no-print mt-16 border-t border-border bg-card">
      <div className="mx-auto max-w-5xl px-4 py-8 text-sm text-muted-foreground">
        <nav aria-label="フッター" className="flex flex-wrap gap-x-4 gap-y-2">
          <Link href="/demo">デモ</Link>
          <Link href="/tools/invoice-cost">インボイスの負担の計算</Link>
          <Link href="/articles">記事</Link>
          <Link href="/about">運営者について</Link>
          <Link href="/contact">相談・問い合わせ</Link>
          <Link href="/legal/privacy">プライバシーポリシー</Link>
        </nav>
        <p className="mt-4 leading-relaxed">
          このサイトの記事と計算結果は一般的な情報です。個別の税務・法令の判断は、税理士・社会保険労務士・運輸支局などの専門家や窓口に確かめてください。
        </p>
        <p className="mt-2">© {SITE.name}</p>
      </div>
    </footer>
  );
}
