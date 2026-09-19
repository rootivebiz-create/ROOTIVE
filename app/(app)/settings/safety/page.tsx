import { canEdit, requirePageRole } from "@/lib/auth/session";
import { loadDriverInstructions, loadIncidents, loadMasters, loadSafetyManagers, loadVehicles } from "@/lib/db/queries";
import { todayJST } from "@/lib/fleet/helpers";
import { SafetyView } from "@/components/fleet/safety-view";

export const metadata = { title: "安全管理" };

/**
 * 安全管理（/settings/safety・admin 以上）
 * 貨物軽自動車安全管理者の選任・指導監督の記録・事故の記録。稼動月には依存しない。
 */
export default async function SafetySettingsPage() {
  const { supabase, profile, company } = await requirePageRole(["owner", "admin"]);
  const today = todayJST();

  const [managers, instructions, incidents, masters, vehicles] = await Promise.all([
    loadSafetyManagers(supabase, company.id),
    loadDriverInstructions(supabase, company.id, { limit: 300 }),
    loadIncidents(supabase, company.id, { limit: 300 }),
    loadMasters(supabase, company.id),
    loadVehicles(supabase, company.id),
  ]);

  return (
    <SafetyView
      managers={managers}
      instructions={instructions}
      incidents={incidents}
      drivers={masters.drivers.map((d) => ({ id: d.id, name: d.name, is_active: d.is_active }))}
      vehicles={vehicles.map((v) => ({ id: v.id ?? "", name: v.plate ?? "", is_active: v.is_active !== false }))}
      today={today}
      editable={canEdit(profile.role)}
    />
  );
}
