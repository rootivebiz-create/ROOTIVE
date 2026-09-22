import { canEdit, requireStaff } from "@/lib/auth/session";
import { loadComplianceOverview } from "@/lib/compliance/queries";
import { ComplianceView } from "@/components/compliance/compliance-view";
import { todayJST, addDays } from "@/lib/daily/helpers";
import type { GapSeverity } from "@/lib/compliance/helpers";

export const metadata = { title: "法令対応" };

/**
 * 法令対応（/compliance）
 * 「監査で聞かれたときに何が足りないか」を 1 画面にまとめ、記録を一式で出せるようにします。
 * 稼動月には依存しません（記録は日付で持つため）。
 */
export default async function CompliancePage() {
  const { supabase, company, profile } = await requireStaff();
  const { gaps, retention, roster } = await loadComplianceOverview(supabase, company.id);
  const today = todayJST();

  return (
    <ComplianceView
      editable={canEdit(profile.role)}
      today={today}
      defaultFrom={addDays(today, -365)}
      gaps={gaps.map((g) => ({
        kind: g.kind ?? "",
        severity: (g.severity ?? "medium") as GapSeverity,
        driverId: g.driver_id ?? "",
        driverName: g.driver_name ?? "",
        title: g.title ?? "",
        detail: g.detail ?? "",
        onDate: g.on_date,
      }))}
      retention={retention.map((r) => ({
        kind: r.kind ?? "",
        label: r.label ?? "",
        years: Number(r.years ?? 0),
        basis: r.basis ?? "",
        recordCount: Number(r.record_count ?? 0),
        oldestOn: r.oldest_on,
        expiredCount: Number(r.expired_count ?? 0),
      }))}
      roster={roster.map((r) => ({
        driverId: r.driver_id ?? "",
        name: r.name ?? "",
        isActive: Boolean(r.is_active),
        retiredOn: r.retired_on,
        birthDate: r.birth_date,
        address: r.address ?? "",
        hiredOn: r.hired_on,
        appointedOn: r.appointed_on,
        licenseNo: r.license_no ?? "",
        licenseExpiresOn: r.license_expires_on,
        healthCheckOn: r.health_check_on,
        instructionLastOn: r.instruction_last_on,
        aptitudeLastOn: r.aptitude_last_on,
        keepUntil: r.keep_until,
      }))}
    />
  );
}
