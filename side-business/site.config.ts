/**
 * サイト全体の設定。名前や価格を変えるときはここだけを直す。
 *
 * 販売者の情報（特定商取引法の表記）は Git に入れず、Vercel の環境変数から読む：
 *   SELLER_NAME     必須  販売事業者（個人の氏名。屋号があれば「屋号（氏名）」）
 *   SELLER_EMAIL    必須  問い合わせ先のメール
 *   SELLER_ADDRESS  任意  無ければ「請求があれば遅滞なく開示」と表示する
 *   SELLER_PHONE    任意  同上
 * この事業は個人事業で、どの会社の事業でもない。会社名・会社のロゴは載せない。
 */

export const SITE = {
  name: "黒ナンバー手帳",
  shortName: "黒ナンバー手帳",
  tagline: "軽貨物ドライバーの記録と手取りを、スマホひとつで。",
  description:
    "軽貨物（黒ナンバー）の個人事業主ドライバー向け。2025年4月から義務になった業務記録・点呼・事故記録をスマホで付けて印刷でき、売上と経費から手取りと確定申告の数字まで出せる無料ツールと記事。",
  locale: "ja_JP",
  /** 本番の URL（環境変数 NEXT_PUBLIC_SITE_URL で上書き） */
  url: (process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3200").replace(/\/+$/, ""),
} as const;

export const PRODUCT = {
  /** Stripe の metadata.product とライセンスの p に入る識別子 */
  id: "pro",
  name: "黒ナンバー手帳 Pro",
  /** 税込の価格（円）。Stripe の Price の金額と必ず一致させる（違うと購入に進ませない） */
  priceYen: 1980,
  priceLabel: "1,980円（税込）・買い切り",
} as const;

export type Seller = {
  name: string | null;
  email: string | null;
  address: string | null;
  phone: string | null;
};

export function seller(): Seller {
  const v = (key: string) => {
    const raw = process.env[key]?.trim();
    return raw ? raw : null;
  };
  return { name: v("SELLER_NAME"), email: v("SELLER_EMAIL"), address: v("SELLER_ADDRESS"), phone: v("SELLER_PHONE") };
}
