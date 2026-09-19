import { canEdit, requireStaff } from "@/lib/auth/session";
import { loadApplicants, loadContracts, loadMasters } from "@/lib/db/queries";
import { hrTabFromParam } from "@/lib/schemas/hr";
import { toApplicantView, toContractView, todayJST, type ApplicantEventView } from "@/lib/hr/helpers";
import { HrView } from "@/components/hr/hr-view";

export const metadata = { title: "採用と契約" };

/** 一覧の上限（応募者はふつう数十人まで） */
const APPLICANT_LIMIT = 500;
/** やりとりの読み込み上限（応募者ごとにダイアログで絞り込む） */
const EVENT_LIMIT = 1000;

/**
 * 採用と契約（/hr）
 * 稼動月には依存しない。タブは ?tab=applicants|contracts。
 * 閲覧者（viewer）は一覧の確認のみ（編集の UI は出さず、Server Action と RLS でも拒否される）。
 */
export default async function HrPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const sp = await searchParams;
  const tab = hrTabFromParam(sp.tab);
  const { supabase, profile, company } = await requireStaff();

  const [applicants, contracts, masters, eventsRes] = await Promise.all([
    loadApplicants(supabase, company.id, { stage: "all", limit: APPLICANT_LIMIT }),
    loadContracts(supabase, company.id),
    loadMasters(supabase, company.id),
    supabase
      .from("applicant_events")
      .select("id, applicant_id, happened_on, stage, note, created_at")
      .eq("company_id", company.id)
      .order("happened_on", { ascending: false })
      .order("created_at", { ascending: false })
      .limit(EVENT_LIMIT),
  ]);
  if (eventsRes.error) throw eventsRes.error;

  const events: ApplicantEventView[] = (eventsRes.data ?? []).map((e) => ({
    id: e.id,
    applicantId: e.applicant_id,
    happenedOn: e.happened_on,
    stage: e.stage,
    note: e.note,
  }));

  return (
    <HrView
      tab={tab}
      applicants={applicants.map(toApplicantView)}
      events={events}
      contracts={contracts.map(toContractView)}
      drivers={masters.drivers.map((d) => ({ id: d.id, name: d.name, is_active: d.is_active }))}
      today={todayJST()}
      canEdit={canEdit(profile.role)}
    />
  );
}
