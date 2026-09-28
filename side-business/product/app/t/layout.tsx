import type { Metadata } from "next";

/** ドライバーの取引条件のページ（ログインなし）。検索に出さない・リファラーを送らない */
export const metadata: Metadata = {
  title: { absolute: "取引条件のお知らせ" },
  robots: { index: false, follow: false, nocache: true, googleBot: { index: false, follow: false } },
  referrer: "no-referrer",
};

export const dynamic = "force-dynamic";

export default function DriverTermsLayout({ children }: { children: React.ReactNode }) {
  return <div className="mx-auto min-h-dvh w-full max-w-xl px-4 pb-16 pt-5">{children}</div>;
}
