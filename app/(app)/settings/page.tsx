import Link from "next/link";
import { ChevronRight, Users, Briefcase, BadgeJapaneseYen, Lock, Building2, UserCog, Database, ScrollText, UserCircle } from "lucide-react";
import { requireStaff } from "@/lib/auth/session";
import { PageHeader } from "@/components/ui/page-header";
import { Card } from "@/components/ui/card";

export default async function SettingsIndexPage() {
  const { profile } = await requireStaff();
  const role = profile.role;
  const items = [
    { href: "/settings/drivers", label: "ドライバー", desc: "名前・ロイヤリティ率・管理費・個別単価・固定控除", icon: Users },
    { href: "/settings/projects", label: "案件・単価", desc: "案件と内容（区分・受注単価・支払単価）", icon: Briefcase },
    { href: "/settings/rates", label: "ドライバー別単価", desc: "ドライバー × 案件内容ごとの受注単価・支払単価", icon: BadgeJapaneseYen },
    { href: "/settings/months", label: "月締め", desc: "月の確定・ロック・締め時バックアップ", icon: Lock },
    ...(role === "owner" ? [{ href: "/settings/company", label: "会社設定", desc: "端数処理・標準値・振込日・弥生の勘定科目", icon: Building2 }] : []),
    ...(role === "owner" ? [{ href: "/settings/users", label: "ユーザー管理", desc: "招待・権限・無効化", icon: UserCog }] : []),
    { href: "/settings/data", label: "データ", desc: "CSV・バックアップ・取り込み・復元", icon: Database },
    ...(role !== "viewer" ? [{ href: "/settings/audit", label: "監査ログ", desc: "誰が・いつ・何を変更したか", icon: ScrollText }] : []),
    { href: "/settings/account", label: "アカウント", desc: "表示名・パスワード", icon: UserCircle },
  ];
  return (
    <div>
      <PageHeader title="設定" />
      <div className="grid gap-3 md:grid-cols-2">
        {items.map((i) => (
          <Link key={i.href} href={i.href}>
            <Card className="flex items-center gap-3 p-4 hover:bg-muted">
              <i.icon className="h-6 w-6 text-primary" />
              <div className="min-w-0 flex-1">
                <p className="font-medium">{i.label}</p>
                <p className="truncate text-sm text-muted-foreground">{i.desc}</p>
              </div>
              <ChevronRight className="h-5 w-5 text-muted-foreground" />
            </Card>
          </Link>
        ))}
      </div>
    </div>
  );
}
