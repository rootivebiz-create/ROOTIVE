import { Analytics } from "@vercel/analytics/next";
import type { Metadata, Viewport } from "next";
import { SourceCapture } from "@/components/landing/source-capture";
import { SiteFooter } from "@/components/site-footer";
import { SiteHeader } from "@/components/site-header";
import { SHARE_IMAGE, SITE } from "@/site.config";
import "./globals.css";

export const metadata: Metadata = {
  metadataBase: new URL(SITE.url),
  title: { default: `${SITE.name}｜${SITE.tagline}`, template: `%s｜${SITE.name}` },
  description: SITE.description,
  applicationName: SITE.name,
  openGraph: { type: "website", locale: SITE.locale, siteName: SITE.name, images: [SHARE_IMAGE] },
  twitter: { card: "summary_large_image", images: [SHARE_IMAGE] },
  formatDetection: { telephone: false },
  appleWebApp: { capable: true, title: SITE.shortName, statusBarStyle: "black-translucent" },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#f6f6f4" },
    { media: "(prefers-color-scheme: dark)", color: "#0f1012" },
  ],
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ja">
      <body className="min-h-dvh antialiased">
        {/* 流入元はどのページから入っても拾う（FAX の QR は /tools/* に来る） */}
        <SourceCapture />
        <SiteHeader />
        <main id="main" className="mx-auto w-full max-w-5xl scroll-mt-16 px-4 pb-8 pt-6">{children}</main>
        <SiteFooter />
        {/* アクセス解析（Vercel Web Analytics）。Cookie を使わず、個人を特定しない形で数える */}
        <Analytics />
      </body>
    </html>
  );
}
