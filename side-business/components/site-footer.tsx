import Link from "next/link";
import { SITE } from "@/site.config";

export function SiteFooter() {
  return (
    <footer className="no-print mt-16 border-t border-border bg-card">
      <div className="mx-auto max-w-5xl px-4 py-8 text-sm text-muted-foreground">
        <nav aria-label="フッター" className="flex flex-wrap gap-x-4 gap-y-2">
          <Link href="/pro">Pro について</Link>
          <Link href="/legal/tokushoho">特定商取引法に基づく表記</Link>
          <Link href="/legal/privacy">プライバシーポリシー</Link>
          <Link href="/legal/terms">利用規約</Link>
          <Link href="/legal/ads">広告の表示について</Link>
        </nav>
        <p className="mt-4 leading-relaxed">
          このサイトの記事と計算結果は一般的な情報です。個別の税務・法令の判断は、税理士・行政書士・運輸支局などの専門家や窓口に確かめてください。
        </p>
        <p className="mt-2">© {SITE.name}</p>
      </div>
    </footer>
  );
}
