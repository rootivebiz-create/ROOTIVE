import type { Metadata, Viewport } from "next";
import { ThemeProvider } from "next-themes";
import { Toaster } from "sonner";
import { OfflineProvider } from "@/components/offline/offline-provider";
import { buildId } from "@/lib/env";
import "./globals.css";

export const metadata: Metadata = {
  title: { default: "ROOTIVE 利益管理", template: "%s | ROOTIVE 利益管理" },
  description: "株式会社ROOTIVE 利益管理システム",
  manifest: "/manifest.webmanifest",
  appleWebApp: { capable: true, statusBarStyle: "default", title: "ROOTIVE" },
  icons: { icon: "/icons/icon-192.png", apple: "/icons/icon-192.png" },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#f7f7f8" },
    { media: "(prefers-color-scheme: dark)", color: "#0f1115" },
  ],
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ja" suppressHydrationWarning>
      <body className="antialiased">
        <ThemeProvider attribute="class" defaultTheme="system" enableSystem disableTransitionOnChange>
          {children}
          <Toaster position="top-center" richColors closeButton />
          {/* オフラインの帯・未送信の自動送信・Service Worker の登録 */}
          <OfflineProvider build={buildId()} />
        </ThemeProvider>
      </body>
    </html>
  );
}
