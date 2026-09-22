import { canEdit, requirePageRole } from "@/lib/auth/session";
import { loadAptitudeTests, loadDriverInstructions, loadIncidents, loadMasters, loadSafetyManagers, loadVehicles } from "@/lib/db/queries";
import { todayJST } from "@/lib/fleet/helpers";
import { SafetyView } from "@/components/fleet/safety-view";
import { LaborStandardsCard } from "@/components/settings/safety/labor-standards-card";
import { RetentionCard } from "@/components/settings/safety/retention-card";
import { isOwner } from "@/lib/auth/session";
import { laborSettingsToForm, retentionSettingsToForm } from "@/lib/schemas/company";

export const metadata = { title: "安全管理" };

/**
 * 安全管理（/settings/safety・admin 以上）
 * 貨物軽自動車安全管理者の選任・指導監督の記録・事故の記録と、労務の基準。稼動月には依存しない。
 */
export default async function SafetySettingsPage() {
  const { supabase, profile, company } = await requirePageRole(["owner", "admin"]);
  const today = todayJST();

  const [managers, instructions, aptitudes, incidents, masters, vehicles] = await Promise.all([
    loadSafetyManagers(supabase, company.id),
    loadDriverInstructions(supabase, company.id, { limit: 300 }),
    loadAptitudeTests(supabase, company.id, { limit: 300 }),
    loadIncidents(supabase, company.id, { limit: 300 }),
    loadMasters(supabase, company.id),
    loadVehicles(supabase, company.id),
  ]);

  return (
    <div className="space-y-6">
      <SafetyView
        managers={managers}
        instructions={instructions}
        aptitudes={aptitudes}
        incidents={incidents}
        drivers={masters.drivers.map((d) => ({ id: d.id, name: d.name, is_active: d.is_active }))}
        vehicles={vehicles.map((v) => ({ id: v.id ?? "", name: v.plate ?? "", is_active: v.is_active !== false }))}
        today={today}
        editable={canEdit(profile.role)}
      />
      {/* 労務の基準（/daily?tab=labor の判定に使う。時間で入力して分で保存する） */}
      <LaborStandardsCard initial={laborSettingsToForm(company)} editable={canEdit(profile.role)} />
      {/* 法定帳票の保存期間（0024）。会社設定なのでオーナーだけが変えられる */}
      <RetentionCard initial={retentionSettingsToForm(company)} editable={isOwner(profile.role)} />
    </div>
  );
}
