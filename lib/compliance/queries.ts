import type { ServerSupabase } from "@/lib/supabase/server";
import type { ComplianceGapRow, DriverRosterRow, RecordRetentionRow } from "@/lib/db/types";
import type { RosterPdfDriver } from "@/lib/pdf/roster";
import { isoToJstDate } from "@/lib/daily/helpers";

/**
 * 法定帳票の読み取り（サーバー専用）。
 *
 * 台帳は v_driver_roster、明細は名前を付けたビュー（v_driver_instruction_list ほか）から読む。
 * 埋め込みリソースは使わない（§ supabase-js の制約）。
 */

export interface ComplianceOverview {
  gaps: ComplianceGapRow[];
  retention: RecordRetentionRow[];
  roster: DriverRosterRow[];
}

/** 監査対応の画面（不足・保存期間・台帳）を 3 往復で読む */
export async function loadComplianceOverview(supabase: ServerSupabase, companyId: string): Promise<ComplianceOverview> {
  const [gapsRes, retentionRes, rosterRes] = await Promise.all([
    supabase.from("v_compliance_gaps").select("*").eq("company_id", companyId),
    supabase.from("v_record_retention").select("*").eq("company_id", companyId),
    supabase.from("v_driver_roster").select("*").eq("company_id", companyId).order("sort_order").order("name"),
  ]);
  if (gapsRes.error) throw gapsRes.error;
  if (retentionRes.error) throw retentionRes.error;
  if (rosterRes.error) throw rosterRes.error;
  return { gaps: gapsRes.data ?? [], retention: retentionRes.data ?? [], roster: rosterRes.data ?? [] };
}

/** 運転者台帳 PDF に渡すデータ（台帳 ＋ 指導・診断・事故の明細） */
export async function loadRosterForPdf(
  supabase: ServerSupabase,
  companyId: string,
  opts: { includeRetired?: boolean } = {},
): Promise<RosterPdfDriver[]> {
  const rosterQuery = supabase.from("v_driver_roster").select("*").eq("company_id", companyId).order("sort_order").order("name");
  const [rosterRes, insRes, aptRes, incRes] = await Promise.all([
    opts.includeRetired ? rosterQuery : rosterQuery.is("retired_on", null),
    supabase.from("v_driver_instruction_list").select("*").eq("company_id", companyId).order("instructed_on"),
    supabase.from("v_aptitude_list").select("*").eq("company_id", companyId).order("taken_on"),
    supabase.from("v_incident_list").select("*").eq("company_id", companyId).order("occurred_at"),
  ]);
  if (rosterRes.error) throw rosterRes.error;
  if (insRes.error) throw insRes.error;
  if (aptRes.error) throw aptRes.error;
  if (incRes.error) throw incRes.error;

  return (rosterRes.data ?? []).map((r) => ({
    rosterNo: r.roster_no ?? "",
    name: r.name ?? "",
    kana: r.kana ?? "",
    birthDate: r.birth_date,
    age: r.age,
    address: r.address ?? "",
    phone: r.phone ?? "",
    hiredOn: r.hired_on,
    appointedOn: r.appointed_on,
    retiredOn: r.retired_on,
    licenseNo: r.license_no ?? "",
    licenseKinds: r.license_kinds ?? "",
    licenseConditions: r.license_conditions ?? "",
    licenseIssuedOn: r.license_issued_on,
    licenseExpiresOn: r.license_expires_on,
    healthCheckOn: r.health_check_on,
    keepUntil: r.keep_until,
    instructions: (insRes.data ?? [])
      .filter((i) => i.driver_id === r.driver_id)
      .map((i) => ({
        on: i.instructed_on ?? "",
        kind: i.kind ?? "",
        hours: Number(i.hours ?? 0),
        topics: i.topics ?? "",
        instructor: i.instructor ?? "",
      })),
    aptitudes: (aptRes.data ?? [])
      .filter((a) => a.driver_id === r.driver_id)
      .map((a) => ({ on: a.taken_on ?? "", kind: a.kind ?? "", institution: a.institution ?? "", result: a.result ?? "" })),
    incidents: (incRes.data ?? [])
      .filter((n) => n.driver_id === r.driver_id)
      .map((n) => ({
        on: isoToJstDate(n.occurred_at),
        kind: n.kind ?? "",
        place: n.place ?? "",
        description: n.description ?? "",
        prevention: n.prevention ?? "",
      })),
  }));
}
