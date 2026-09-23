import Link from "next/link";
import { PRODUCT, SITE } from "@/site.config";

export function SiteFooter() {
  return (
    <footer className="no-print mt-16 border-t border-border bg-card">
      <div className="mx-auto max-w-5xl px-4 py-8 text-sm text-muted-foreground">
        <nav aria-label="フッター" className="flex flex-wrap gap-x-4 gap-y-2">
          <Link href="/product">製品のご紹介</Link>
          {PRODUCT.demoUrl && (
            <a href={PRODUCT.demoUrl} target="_blank" rel="noopener">
              製品のデモ
              <span className="sr-only">（新しいタブで開きます）</span>
            </a>
          )}
          <Link href="/demo">計算のデモ</Link>
          <Link href="/tools/invoice-cost">インボイスの負担の計算</Link>
          <Link href="/tools/torihiki-joken">取引条件明示書</Link>
          <Link href="/tools/payout">業種別の報酬の計算</Link>
          <Link href="/for">業種別のまとめ</Link>
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
