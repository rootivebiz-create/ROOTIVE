import { canEdit, requireStaff } from "@/lib/auth/session";
import { isMonthClosed, loadMasters } from "@/lib/db/queries";
import { monthFromParam, monthToDate } from "@/lib/month";
import { BulkForm } from "@/components/entries/bulk-form";
import { toEntryRow } from "@/components/entries/helpers";

export const metadata = { title: "一括入力" };

export default async function BulkEntriesPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const sp = await searchParams;
  const month = monthFromParam(sp.m);
  const { supabase, profile, company } = await requireStaff();

  const [entriesRes, closed, masters] = await Promise.all([
    supabase.from("v_work_entry_calc").select("*").eq("company_id", company.id).eq("month", monthToDate(month)).order("created_at"),
    isMonthClosed(supabase, company.id, month),
    loadMasters(supabase, company.id, { activeOnly: true }),
  ]);
  if (entriesRes.error) throw entriesRes.error;

  const editable = canEdit(profile.role) && !closed;

  return (
    <BulkForm
      month={month}
      masters={masters}
      rows={(entriesRes.data ?? []).map(toEntryRow)}
      editable={editable}
      closed={closed}
      initialItemId={typeof sp.item === "string" ? sp.item : ""}
    />
  );
}
