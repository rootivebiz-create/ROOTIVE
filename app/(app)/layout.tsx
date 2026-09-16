import { AppShell } from "@/components/layout/app-shell";
import { requireStaff } from "@/lib/auth/session";
import { loadMonthList } from "@/lib/db/queries";
import { dateToMonth } from "@/lib/month";

export const dynamic = "force-dynamic";

const SETTINGS_SUBNAV = [
  { href: "/settings/drivers", label: "ドライバー" },
  { href: "/settings/projects", label: "案件・単価" },
  { href: "/settings/months", label: "月締め" },
  { href: "/settings/company", label: "会社設定", ownerOnly: true },
  { href: "/settings/users", label: "ユーザー管理", ownerOnly: true },
  { href: "/settings/data", label: "データ" },
  { href: "/settings/audit", label: "監査ログ", adminOnly: true },
  { href: "/settings/account", label: "アカウント" },
];

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const { supabase, profile, company } = await requireStaff();
  const months = await loadMonthList(supabase, company.id);
  const subItems = SETTINGS_SUBNAV.filter((s) => (s.ownerOnly ? profile.role === "owner" : s.adminOnly ? profile.role !== "viewer" : true)).map(
    ({ href, label }) => ({ href, label }),
  );
  return (
    <AppShell
      companyName={company.name}
      displayName={profile.display_name}
      email={profile.email}
      role={profile.role}
      months={months.map((m) => ({ month: dateToMonth(m.month ?? ""), status: (m.status ?? "open") as "open" | "closed", bill: m.bill, entry_count: m.entry_count }))}
      subNav={{ parent: "/settings", items: subItems }}
    >
      {children}
    </AppShell>
  );
}
