import { SettingsTabs } from "@/components/layout/settings-tabs";
import { requireStaff } from "@/lib/auth/session";

export default async function SettingsLayout({ children }: { children: React.ReactNode }) {
  const { profile } = await requireStaff();
  return (
    <div>
      <SettingsTabs role={profile.role} />
      {children}
    </div>
  );
}
