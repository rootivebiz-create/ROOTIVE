import { AppShell } from "@/components/layout/app-shell";
import { requireDriver } from "@/lib/auth/session";
import { FileText, UserCircle } from "lucide-react";

export const dynamic = "force-dynamic";

export default async function DriverLayout({ children }: { children: React.ReactNode }) {
  const { profile, company } = await requireDriver();
  return (
    <AppShell
      companyName={company.name}
      displayName={profile.display_name}
      email={profile.email}
      role={profile.role}
      months={[]}
      showMonthSelector={false}
      homeHref="/driver"
      navItems={[
        { href: "/driver", label: "支払明細", icon: FileText },
        { href: "/driver/account", label: "アカウント", icon: UserCircle },
      ]}
    >
      {children}
    </AppShell>
  );
}
