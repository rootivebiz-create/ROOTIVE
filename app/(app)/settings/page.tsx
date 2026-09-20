import Link from "next/link";
import { ChevronRight, Users, Briefcase, BadgeJapaneseYen, Store, Tags, Lock, ShieldCheck, Plug, Building2, UserCog, Database, ScrollText, UserCircle } from "lucide-react";
import { requireStaff } from "@/lib/auth/session";
import { visibleForRole, type RoleVisibility } from "@/lib/nav/visibility";
import { PageHeader } from "@/components/ui/page-header";
import { Card } from "@/components/ui/card";

export default async function SettingsIndexPage() {
  const { profile } = await requireStaff();
  const role = profile.role;
  // 出し分けはナビ・コマンドパレットと同じ判定（lib/nav/visibility.ts）を使う
  const items = visibleForRole<{ href: string; label: string; desc: string; icon: typeof Users } & RoleVisibility>(
    [
      { href: "/settings/drivers", label: "ドライバー", desc: "名前・ロイヤリティ率・管理費・個別単価・固定控除", icon: Users },
      { href: "/settings/projects", label: "案件・単価", desc: "案件と内容（区分・受注単価・支払単価）", icon: Briefcase },
      { href: "/settings/rates", label: "ドライバー別単価", desc: "ドライバー × 案件内容ごとの受注単価・支払単価", icon: BadgeJapaneseYen },
      { href: "/settings/clients", label: "取引先", desc: "請求書の宛先・支払サイト", icon: Store },
      { href: "/settings/expenses", label: "経費カテゴリ", desc: "経費の分類（固定費・変動費）と毎月かかる経費", icon: Tags },
      { href: "/settings/months", label: "月締め", desc: "月の確定・ロック・締め時バックアップ", icon: Lock },
      { href: "/settings/safety", label: "安全管理", desc: "貨物軽自動車安全管理者・指導監督の記録・事故の記録", icon: ShieldCheck, adminOnly: true },
      { href: "/settings/integrations", label: "外部連携", desc: "LINE 公式アカウント・Google ドライブへの自動保存", icon: Plug, adminOnly: true },
      { href: "/settings/company", label: "会社設定", desc: "端数処理・標準値・振込日・弥生の勘定科目", icon: Building2, ownerOnly: true },
      { href: "/settings/users", label: "ユーザー管理", desc: "招待・権限・無効化", icon: UserCog, ownerOnly: true },
      { href: "/settings/data", label: "データ", desc: "CSV・バックアップ・取り込み・復元", icon: Database },
      { href: "/settings/audit", label: "監査ログ", desc: "誰が・いつ・何を変更したか", icon: ScrollText, adminOnly: true },
      { href: "/settings/account", label: "アカウント", desc: "表示名・パスワード", icon: UserCircle },
    ],
    role,
  );
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
