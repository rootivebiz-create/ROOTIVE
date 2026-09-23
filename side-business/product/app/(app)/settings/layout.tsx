import Link from "next/link";
import type { ReactNode } from "react";
import { SettingsTabs, type SettingsTab } from "~/components/settings/settings-tabs";
import { requirePageUser, roleAtLeast } from "~/server/auth";

/** 設定の中の共通の枠：項目の切り替え（利用者はオーナーだけに出す）と、下の「困ったとき」 */
export default async function SettingsLayout({ children }: { children: ReactNode }) {
  const user = await requirePageUser("viewer");
  const tabs: SettingsTab[] = [
    { href: "/settings", label: "はじめに" },
    { href: "/settings/company", label: "会社" },
    { href: "/settings/drivers", label: "ドライバー" },
    { href: "/settings/clients", label: "元請" },
    { href: "/settings/projects", label: "案件と単価" },
    { href: "/settings/rates", label: "人ごとの単価" },
    { href: "/settings/rules", label: "控除" },
    ...(roleAtLeast(user.role, "owner") ? [{ href: "/settings/users", label: "利用者" }] : []),
    { href: "/settings/ai", label: "AI の同意" },
    { href: "/settings/account", label: "自分のアカウント" },
  ];
  return (
    <div>
      <SettingsTabs tabs={tabs} />
      {children}
      <footer className="mt-10 max-w-4xl border-t border-border pt-4 text-sm text-muted-foreground">
        <p>
          使い方で困ったときは{" "}
          <Link href="/help" className="inline-flex min-h-11 items-center font-bold">
            ヘルプ（月末の流れ・よくある質問・連絡先）
          </Link>
          。パスワードの変更は{" "}
          <Link href="/settings/account" className="inline-flex min-h-11 items-center">
            自分のアカウント
          </Link>
          から。
        </p>
      </footer>
    </div>
  );
}
