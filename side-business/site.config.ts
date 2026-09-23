/**
 * サイト全体の設定。名前・連絡先・料金を変えるときはここだけを直す。
 *
 * 個人の情報は Git に入れず、Vercel の環境変数から読む：
 *   OWNER_NAME                 事業者名（個人の氏名。屋号があれば「屋号（氏名）」）
 *   NEXT_PUBLIC_CONTACT_EMAIL  問い合わせ先のメール（フォームが使えないときの予備）
 *   NEXT_PUBLIC_BOOKING_URL    オンライン相談の予約ページ（Google カレンダーの予約スケジュールなど）
 * この事業は個人事業で、どの会社の事業でもない。会社名・会社のロゴ・会社のシステムの画面は載せない。
 */

export const SITE = {
  name: "運送しくみ工房",
  shortName: "しくみ工房",
  tagline: "運送会社の月末を、30分で終わらせる。",
  description:
    "業務委託ドライバーの支払明細・振込データ・案件ごとの利益を、御社のやり方のまま自動にする仕組みを作ります。作るのは現役の運送会社経営者。インボイスの経過措置（2026年10月から70%）にも合わせます。",
  locale: "ja_JP",
  /** 本番の URL（環境変数 NEXT_PUBLIC_SITE_URL で上書き） */
  url: (process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3200").replace(/\/+$/, ""),
} as const;

export const CONTACT = {
  email: process.env.NEXT_PUBLIC_CONTACT_EMAIL?.trim() || null,
  bookingUrl: process.env.NEXT_PUBLIC_BOOKING_URL?.trim() || null,
} as const;

/** 事業者名（プライバシーポリシーなどに出す）。未設定なら null */
export function ownerName(): string | null {
  return process.env.OWNER_NAME?.trim() || null;
}
