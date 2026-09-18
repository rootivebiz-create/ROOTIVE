"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useMonth } from "@/lib/hooks/use-month";
import { cn } from "@/lib/utils";
import type { Role } from "@/lib/db/types";

const ITEMS: { href: string; label: string; roles?: Role[] }[] = [
  { href: "/settings/drivers", label: "ドライバー" },
  { href: "/settings/projects", label: "案件・単価" },
  { href: "/settings/rates", label: "ドライバー別単価" },
  { href: "/settings/clients", label: "取引先" },
  { href: "/settings/expenses", label: "経費カテゴリ" },
  { href: "/settings/months", label: "月締め" },
  { href: "/settings/company", label: "会社設定", roles: ["owner"] },
  { href: "/settings/users", label: "ユーザー管理", roles: ["owner"] },
  { href: "/settings/data", label: "データ" },
  { href: "/settings/audit", label: "監査ログ", roles: ["owner", "admin"] },
  { href: "/settings/account", label: "アカウント" },
];

/** 設定のサブナビ（スマホ：横スクロールのタブ／PC：非表示。サイドナビに出す） */
export function SettingsTabs({ role }: { role: Role }) {
  const pathname = usePathname();
  const { href } = useMonth();
  const items = ITEMS.filter((i) => !i.roles || i.roles.includes(role));
  if (pathname === "/settings") return null;
  return (
    <div className="-mx-4 mb-4 overflow-x-auto border-b px-4 md:hidden no-print">
      <div className="flex gap-1 whitespace-nowrap">
        {items.map((i) => {
          const active = pathname === i.href || pathname.startsWith(i.href + "/");
          return (
            <Link
              key={i.href}
              href={href(i.href)}
              className={cn("border-b-2 px-3 py-2 text-sm", active ? "border-primary font-semibold text-primary" : "border-transparent text-muted-foreground")}
            >
              {i.label}
            </Link>
          );
        })}
      </div>
    </div>
  );
}
