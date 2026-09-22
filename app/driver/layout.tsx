import { AppShell } from "@/components/layout/app-shell";
import { buildId } from "@/lib/env";
import { requireDriver } from "@/lib/auth/session";

export const dynamic = "force-dynamic";

export default async function DriverLayout({ children }: { children: React.ReactNode }) {
  const { profile, company } = await requireDriver();
  return (
    <AppShell
      build={buildId()}
      companyName={company.name}
      displayName={profile.display_name}
      email={profile.email}
      role={profile.role}
      months={[]}
      showMonthSelector={false}
      homeHref="/driver"
      navVariant="driver"
    >
      {children}
    </AppShell>
  );
}
